import { readHealthDataPoints } from "../../db/health-cache.server";
import {
	GOOGLE_HEALTH_DATA_POINT_TYPES,
	type GoogleHealthDataPointType,
} from "../google-health-api.gen";
import { canonicalJson } from "../google-health-cache-record.server";
import {
	type GoogleHealthRollupType,
	googleHealthRollupType,
	rollupSlices,
} from "../google-health-rollup";
import { createLogger } from "../logger.server";
import {
	type AggregatablePoint,
	type AggregateGranularity,
	type AggregateWindow,
	aggregatePoints,
	alignAggregateWindow,
	DEFAULT_AGGREGATE_SPAN_MS,
	formatWithOffset,
	MAX_AGGREGATE_BUCKETS,
	reconciliationSlotMs,
	startAggregateWindowAt,
	summarizeRollupPoint,
} from "./aggregate";
import type { McpIdentity } from "./credential";
import {
	clampHistoryWindow,
	HISTORY_LIMIT_DAYS,
	summarizeDataPoint,
} from "./health";
import {
	type CacheLookup,
	clampNote,
	clientFor,
	json,
	missingScope,
	parseReadRange,
	readHealthDataFailure,
	resolveCacheLookup,
	text,
} from "./tool-support.server";

/**
 * The `aggregate_health_data` tool: where an aggregate comes from.
 *
 * Three paths, chosen in this order.
 *
 * 1. **Stored history**, when the user keeps one and it covers the window
 *    completely — the same rule `read_health_data` applies, for the same
 *    reason. It reaches back years and costs Google nothing.
 * 2. **Google's `rollUp`**, when the type has one. Google reconciles across
 *    devices before it sums, and it aggregates server-side: a fortnight of
 *    heart rate is some thirty thousand points that never have to cross the
 *    wire, which is the difference between answering and timing out on a
 *    ten-second serverless function.
 * 3. **Raw points, aggregated here**, for the rest of the catalog — sleep,
 *    daily summaries, most clinical samples. These are the sparse types, which
 *    is what makes reading them raw affordable.
 *
 * The arithmetic lives in `aggregate.ts`; this module only moves data to it.
 */

const log = createLogger("mcp:aggregate");

const TOOL = "aggregate_health_data";

/**
 * The most stored points one aggregate will read.
 *
 * About a month of heart rate. Hitting it is refused rather than truncated: an
 * aggregate over the first fifty thousand points of a window is a confident
 * wrong answer about the rest of it.
 */
const MAX_CACHED_POINTS = 50_000;

/**
 * The most raw points fetched from Google for a computed aggregate — four
 * sequential pages. Only the types Google cannot roll up take this path, and
 * they are sparse; a window that exceeds it is one to narrow, not to wait for.
 */
const MAX_LIVE_POINTS = 5000;

const COMPUTED_NOTE =
	"Computed by this server from raw points. Every numeric field gets " +
	"sum/avg/min/max; use the one that fits the field — sum for counts and " +
	"durations, avg/min/max for rates and levels. Durations are in seconds. " +
	"Where several devices reported the same period, only the one that " +
	"recorded the most in each slot was counted, so totals are not doubled. " +
	"Buckets with no data are omitted.";

const ROLLUP_NOTE =
	"Aggregated by Google Health and reconciled across the user's devices. " +
	"Field names carry the statistic, e.g. `countSum`, `beatsPerMinuteAvg`. " +
	"Buckets with no data are omitted.";

export interface AggregateHealthDataInput {
	dataType: string;
	granularity: AggregateGranularity;
	from?: string;
	to?: string;
	utcOffsetMinutes?: number;
}

const CATALOG_BY_ID = new Map<string, GoogleHealthDataPointType>(
	GOOGLE_HEALTH_DATA_POINT_TYPES.map((type) => [type.id, type]),
);

/**
 * What can be aggregated under an id: a catalog type that may also have a
 * rollup, or one of the two types Google derives and serves only as rollups.
 */
type AggregateTarget =
	| {
			type: GoogleHealthDataPointType;
			rollup: GoogleHealthRollupType | undefined;
	  }
	| { type: undefined; rollup: GoogleHealthRollupType };

function resolveTarget(dataType: string): AggregateTarget | undefined {
	const type = CATALOG_BY_ID.get(dataType);
	const rollup = googleHealthRollupType(dataType);
	if (type !== undefined) return { rollup, type };
	return rollup === undefined ? undefined : { rollup, type };
}

interface AggregateRequest {
	identity: McpIdentity;
	dataType: string;
	granularity: AggregateGranularity;
	window: AggregateWindow;
	utcOffsetMinutes: number;
	historyClamped: string | undefined;
}

/** The fields every path's reply shares, so the three cannot drift apart. */
function replyEnvelope(request: AggregateRequest) {
	const { window } = request;
	return {
		dataType: request.dataType,
		from: formatWithOffset(window.fromMs, window.offsetMs),
		granularity: request.granularity,
		historyClamped: request.historyClamped,
		to: formatWithOffset(window.toMs, window.offsetMs),
		utcOffsetMinutes: request.utcOffsetMinutes,
	};
}

function tooManyPoints(limit: number) {
	return text(
		`This window holds more than ${limit} raw points, which is more than one ` +
			"aggregate will read. Narrow `from`/`to` and call again; the results " +
			"can be combined, since every bucket is whole.",
		true,
	);
}

/** Sleep belongs to the day it ended on, as it does in a filter and a read. */
function anchorsOnEnd(dataType: string): boolean {
	return dataType === "sleep";
}

function computedReply(
	request: AggregateRequest,
	type: GoogleHealthDataPointType,
	points: readonly AggregatablePoint[],
) {
	const result = aggregatePoints(
		points,
		request.window,
		reconciliationSlotMs(type, request.window.bucketMs),
	);
	return {
		...replyEnvelope(request),
		bucketCount: result.buckets.length,
		buckets: result.buckets,
		dataSources: result.sources,
		method: "computed",
		note: COMPUTED_NOTE,
		pointsInWindow: result.pointsInWindow,
	};
}

async function aggregateFromCache(
	request: AggregateRequest,
	type: GoogleHealthDataPointType,
	lookup: CacheLookup,
) {
	const { dataType, identity, window } = request;
	const onEnd = anchorsOnEnd(dataType);
	const rows = await readHealthDataPoints({
		anchor: onEnd ? "overlap" : "start",
		dataType,
		fromMs: window.fromMs,
		limit: MAX_CACHED_POINTS + 1,
		toMs: window.toMs,
		userId: identity.userId,
	});
	if (rows.length > MAX_CACHED_POINTS) {
		log.warn("refused aggregate: too many stored points", {
			dataType,
			limit: MAX_CACHED_POINTS,
			userId: identity.userId,
		});
		return tooManyPoints(MAX_CACHED_POINTS);
	}

	const reply = computedReply(
		request,
		type,
		rows.map((row) => ({
			atMs: onEnd ? row.observedEndMs : row.observedAtMs,
			sourceKey: row.sourceKey,
			value: row.value,
		})),
	);
	log.debug("aggregated health data", {
		buckets: reply.bucketCount,
		dataType,
		granularity: request.granularity,
		points: rows.length,
		source: "cache",
		userId: identity.userId,
	});
	return json({
		...reply,
		cachedThrough: lookup.coveredThrough,
		source: "cache",
	});
}

async function aggregateFromRollup(
	request: AggregateRequest,
	rollup: GoogleHealthRollupType,
	now: Date,
) {
	const { dataType, identity, window } = request;
	const client = clientFor(identity);
	try {
		// Google has nothing to say about the future, and a range that ends in it
		// is one more way for a request to be refused. The last bucket is still
		// labelled whole; it simply has less in it, as today always does.
		const slices = rollupSlices(
			rollup,
			{ fromMs: window.fromMs, toMs: Math.min(window.toMs, now.getTime()) },
			window.bucketMs,
		);
		const pages = await Promise.all(
			slices.map((slice) =>
				client.rollUpDataPoints(rollup.id, {
					from: new Date(slice.fromMs),
					to: new Date(slice.toMs),
					windowMs: window.bucketMs,
				}),
			),
		);
		const buckets = pages
			.flat()
			.map((point) =>
				summarizeRollupPoint(point, rollup.field, window.offsetMs),
			)
			.filter((bucket) => bucket !== null)
			.sort((left, right) => left.start.localeCompare(right.start));

		log.debug("aggregated health data", {
			buckets: buckets.length,
			dataType,
			granularity: request.granularity,
			requests: slices.length,
			source: "live",
			userId: identity.userId,
		});
		return json({
			...replyEnvelope(request),
			bucketCount: buckets.length,
			buckets,
			method: "google-rollup",
			note: ROLLUP_NOTE,
			source: "live",
		});
	} catch (error) {
		return readHealthDataFailure(error, client, dataType);
	}
}

async function aggregateFromLivePoints(
	request: AggregateRequest,
	type: GoogleHealthDataPointType,
) {
	const { dataType, identity, window } = request;
	const client = clientFor(identity);
	try {
		const points = await client.collectDataPoints(type.id, {
			from: new Date(window.fromMs),
			limit: MAX_LIVE_POINTS + 1,
			to: new Date(window.toMs),
		});
		if (points.length > MAX_LIVE_POINTS) {
			log.warn("refused aggregate: too many live points", {
				dataType,
				limit: MAX_LIVE_POINTS,
				userId: identity.userId,
			});
			return tooManyPoints(MAX_LIVE_POINTS);
		}

		const onEnd = anchorsOnEnd(dataType);
		const aggregatable: AggregatablePoint[] = [];
		for (const point of points) {
			const summary = summarizeDataPoint(point);
			const at = onEnd ? (summary?.end ?? summary?.start) : summary?.start;
			const atMs = Date.parse(at ?? "");
			if (summary === null || Number.isNaN(atMs)) continue;
			aggregatable.push({
				atMs,
				sourceKey:
					point.dataSource === undefined
						? null
						: canonicalJson(point.dataSource),
				value: summary.value,
			});
		}

		const reply = computedReply(request, type, aggregatable);
		log.debug("aggregated health data", {
			buckets: reply.bucketCount,
			dataType,
			granularity: request.granularity,
			points: points.length,
			source: "live",
			userId: identity.userId,
		});
		return json({ ...reply, source: "live" });
	} catch (error) {
		return readHealthDataFailure(error, client, dataType);
	}
}

type ResolvedWindow =
	| { ok: true; window: AggregateWindow }
	| { ok: false; response: ReturnType<typeof text> };

/** The requested range as whole buckets, or why it cannot be one. */
function resolveWindow(
	input: AggregateHealthDataInput,
	range: { from?: Date; to?: Date },
	utcOffsetMinutes: number,
	now: Date,
): ResolvedWindow {
	const toMs = (range.to ?? now).getTime();
	const fromMs =
		range.from?.getTime() ??
		toMs - DEFAULT_AGGREGATE_SPAN_MS[input.granularity];
	if (fromMs >= toMs) {
		return {
			ok: false,
			response: text("`from` must be earlier than `to`.", true),
		};
	}
	return {
		ok: true,
		window: alignAggregateWindow({
			fromMs,
			granularity: input.granularity,
			toMs,
			utcOffsetMinutes,
		}),
	};
}

function tooManyBuckets(window: AggregateWindow, granularity: string) {
	return text(
		`That window is ${window.buckets} ${granularity} buckets; one call returns ` +
			`at most ${MAX_AGGREGATE_BUCKETS}. Narrow \`from\`/\`to\`` +
			`${granularity === "hour" ? ", or use `day` granularity" : ""}.`,
		true,
	);
}

type PlannedAggregate =
	| { ok: true; request: AggregateRequest; lookup: CacheLookup; now: Date }
	| { ok: false; response: ReturnType<typeof text> };

function refuse(message: string): PlannedAggregate {
	return { ok: false, response: text(message, true) };
}

/**
 * Everything that can be decided before any data is fetched: the window, the
 * clock it is drawn on, how far back it may reach, and where it will be read
 * from.
 */
async function planAggregate(
	identity: McpIdentity,
	input: AggregateHealthDataInput,
	target: AggregateTarget,
): Promise<PlannedAggregate> {
	const parsedRange = parseReadRange(input.from, input.to);
	if (!parsedRange.ok) return parsedRange;

	const { dataType, granularity } = input;
	const daily = target.type?.shape === "daily";
	if (daily && granularity === "hour") {
		return refuse(
			`\`${dataType}\` is one value per calendar day, so it has no hourly ` +
				"breakdown. Use `day` granularity.",
		);
	}

	// A daily summary is already keyed by the user's own calendar date, which
	// reaches this server as UTC midnight. Shifting it by an offset would move
	// every western-hemisphere day onto the one before it.
	const utcOffsetMinutes = daily ? 0 : (input.utcOffsetMinutes ?? 0);

	const now = new Date();
	const resolved = resolveWindow(input, parsedRange, utcOffsetMinutes, now);
	if (!resolved.ok) return resolved;
	const requested = resolved.window;

	// Decided against the window as asked, then clamped — the same order
	// `read_health_data` uses, so the source and the limit cannot disagree. A
	// rollup-only type has no raw points, so there is nothing stored to find.
	const lookup: CacheLookup =
		target.type === undefined
			? {
					coveredThrough: undefined,
					limitDays: HISTORY_LIMIT_DAYS,
					source: "live",
				}
			: await resolveCacheLookup(identity.userId, dataType, {
					fromMs: requested.fromMs,
					toMs: requested.toMs,
				});

	const clamped = clampHistoryWindow(
		{ from: new Date(requested.fromMs), to: new Date(requested.toMs) },
		now,
		lookup.limitDays,
	);
	const window = startAggregateWindowAt(requested, clamped.from.getTime());
	if (window.buckets === 0) {
		return refuse(
			`That window is entirely older than this account's ${clamped.limitDays}-day ` +
				"history window, so there is nothing to aggregate.",
		);
	}
	if (window.buckets > MAX_AGGREGATE_BUCKETS) {
		return { ok: false, response: tooManyBuckets(window, granularity) };
	}

	return {
		lookup,
		now,
		ok: true,
		request: {
			dataType,
			granularity,
			historyClamped: clampNote(clamped),
			identity,
			utcOffsetMinutes,
			window,
		},
	};
}

export async function aggregateHealthData(
	identity: McpIdentity,
	input: AggregateHealthDataInput,
) {
	const refusal = missingScope(identity, TOOL);
	if (refusal !== null) return refusal;

	const target = resolveTarget(input.dataType);
	if (target === undefined) {
		return text(
			`\`${input.dataType}\` is not a data type this server knows. Call ` +
				"`list_health_data_types` for the ids.",
			true,
		);
	}

	const plan = await planAggregate(identity, input, target);
	if (!plan.ok) return plan.response;
	const { lookup, now, request } = plan;

	if (target.type === undefined) {
		return aggregateFromRollup(request, target.rollup, now);
	}
	if (lookup.source === "cache") {
		return aggregateFromCache(request, target.type, lookup);
	}
	if (target.rollup !== undefined) {
		return aggregateFromRollup(request, target.rollup, now);
	}
	return aggregateFromLivePoints(request, target.type);
}
