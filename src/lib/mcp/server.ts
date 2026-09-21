import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readHealthDataPoints } from "../../db/health-cache.server";
import type { GoogleHealthDataTypeId } from "../google-health-api.gen";
import { LEGAL } from "../legal";
import { createLogger } from "../logger.server";
import {
	DEFAULT_AGGREGATE_SPAN_MS,
	MAX_AGGREGATE_BUCKETS,
	MAX_UTC_OFFSET_MINUTES,
	MIN_UTC_OFFSET_MINUTES,
} from "./aggregate";
import { aggregateHealthData } from "./aggregate-tool.server";
import type { McpIdentity } from "./credential";
import {
	clampHistoryWindow,
	describeAggregateOnlyTypes,
	describeDataTypes,
	HISTORY_LIMIT_DAYS,
	readableCategories,
	summarizeDataPoint,
} from "./health";
import { MCP_OAUTH_SCOPE } from "./oauth-scopes";
import {
	type CacheLookup,
	clampNote,
	clientFor,
	DAY_MS,
	describeApiError,
	json,
	missingScope,
	parseReadRange,
	readHealthDataFailure,
	resolveCacheLookup,
	text,
} from "./tool-support.server";

/**
 * Assembly of the MCP server: what tools this app exposes to an MCP client.
 *
 * Everything lives behind a factory rather than a module-level singleton on
 * purpose. `McpServer` keeps a reference to the single transport it is
 * connected to, and the HTTP transport runs in stateless mode (one transport
 * per request), so a shared instance would have concurrent requests overwrite
 * each other's transport and cross-deliver responses. Building a server is
 * cheap — it is just a handful of handler registrations.
 *
 * The caller's identity is an argument for the same reason: it belongs to one
 * request, so the handlers close over that request's identity rather than
 * reaching for something ambient.
 *
 * Authentication is complete before this factory is called. The HTTP boundary
 * requires either an API key or a scoped OAuth token even for `initialize` and
 * `tools/list`, so every handler can close over one verified user.
 */

const log = createLogger("mcp:server");

/**
 * Advertised to clients during `initialize`.
 *
 * `version` is written out rather than imported from `package.json`, which is
 * not a module this bundle should pull in; it tracks the package version by
 * hand, so bump both together.
 *
 * `name` is the programmatic identifier and `title` the display name. A client
 * older than the `title` field falls back to rendering `name`, so the two are
 * kept as the same brand rather than left to drift. Reading the display name
 * from `LEGAL` means a product rename stays one edit, in the one place the
 * Google consent screen and the legal documents already read from.
 */
export const MCP_SERVER_INFO = {
	name: "ghealth-connector",
	title: LEGAL.appName,
	version: "0.0.1",
	websiteUrl: LEGAL.siteUrl,
} as const;

/** How many points a read returns when the caller does not say. */
const DEFAULT_LIMIT = 50;

/**
 * The most a single read will return.
 *
 * A day of heart-rate samples is thousands of points, and every one of them
 * lands in the model's context. The cap is a limit on how much of a caller's
 * budget one tool call can spend, not on how much data exists — the reply says
 * when it truncated, and a narrower window is the way to get the rest.
 */
const MAX_LIMIT = 500;

interface ReadHealthDataInput {
	dataType: string;
	from?: string;
	to?: string;
	limit?: number;
}

async function readHealthData(
	identity: McpIdentity,
	{ dataType, from, to, limit }: ReadHealthDataInput,
) {
	const refusal = missingScope(identity, "read_health_data");
	if (refusal !== null) return refusal;
	const parsedRange = parseReadRange(from, to);
	if (!parsedRange.ok) return parsedRange.response;

	const now = new Date();
	const wanted = limit ?? DEFAULT_LIMIT;

	// Decided against a *provisional* window so the clamp and the source cannot
	// disagree: the cache is asked about the window the caller actually named,
	// and only then is the entitled limit applied.
	const lookup = await resolveCacheLookup(identity.userId, dataType, {
		fromMs: (
			parsedRange.from ?? new Date(now.getTime() - HISTORY_LIMIT_DAYS * DAY_MS)
		).getTime(),
		toMs: parsedRange.to?.getTime(),
	});

	const window = clampHistoryWindow(
		{ from: parsedRange.from, to: parsedRange.to },
		now,
		lookup.limitDays,
	);

	const upperBound = window.to;
	if (lookup.source === "cache" && upperBound !== undefined) {
		return readFromCache({
			dataType,
			identity,
			lookup,
			wanted,
			window: { ...window, to: upperBound },
		});
	}

	const client = clientFor(identity);
	try {
		const points = await client.collectDataPoints(
			dataType as GoogleHealthDataTypeId,
			{ from: window.from, to: window.to, limit: wanted },
		);

		log.debug("read health data", {
			clamped: window.clamped,
			dataType,
			points: points.length,
			source: "live",
			userId: identity.userId,
		});

		return json({
			count: points.length,
			dataPoints: points.map(summarizeDataPoint).filter(Boolean),
			dataType,
			from: window.from.toISOString(),
			historyClamped: clampNote(window),
			source: "live",
			to: window.to?.toISOString() ?? null,
			truncated: points.length >= wanted,
		});
	} catch (error) {
		return readHealthDataFailure(error, client, dataType);
	}
}

/**
 * Serves a fully covered window from the stored history.
 *
 * `anchor: "overlap"` for sleep, matching what `google-health-filter.ts` does
 * for a live read of the same type: a night that began before the window is the
 * normal case, and anchoring on the start would drop exactly the night that was
 * asked about.
 */
interface CacheReadRequest {
	identity: McpIdentity;
	dataType: string;
	window: ReturnType<typeof clampHistoryWindow> & { to: Date };
	wanted: number;
	lookup: CacheLookup;
}

async function readFromCache(request: CacheReadRequest) {
	const { dataType, identity, lookup, wanted, window } = request;
	const rows = await readHealthDataPoints({
		anchor: dataType === "sleep" ? "overlap" : "start",
		dataType,
		fromMs: window.from.getTime(),
		limit: wanted,
		toMs: window.to.getTime(),
		userId: identity.userId,
	});

	log.debug("read health data", {
		clamped: window.clamped,
		dataType,
		points: rows.length,
		source: "cache",
		userId: identity.userId,
	});

	return json({
		cachedThrough: lookup.coveredThrough,
		count: rows.length,
		dataPoints: rows.map((row) => ({
			end:
				row.observedEndMs === row.observedAtMs
					? undefined
					: new Date(row.observedEndMs).toISOString(),
			name: row.resourceName ?? undefined,
			start: new Date(row.observedAtMs).toISOString(),
			type: row.dataType,
			value: row.value,
		})),
		dataType,
		from: window.from.toISOString(),
		historyClamped: clampNote(window),
		note: "Served from this account's stored history. The same measurement reported by two devices is two points; group by `source` before summing.",
		source: "cache",
		to: window.to.toISOString(),
		truncated: rows.length >= wanted,
	});
}

export function createMcpServer(identity: McpIdentity): McpServer {
	const server = new McpServer(MCP_SERVER_INFO, {
		// This copy is returned on every initialize response. Name both supported
		// credentials so a model does not tell its user that an API key is the only
		// way to connect after an OAuth client has already completed consent.
		instructions:
			`Read the signed-in user's Google Health data for ${LEGAL.appName}. ` +
			"Call `list_health_data_types` first to see what can be queried. For " +
			"totals, trends and anything spanning more than a few hours, use " +
			"`aggregate_health_data`, which returns hourly or daily buckets " +
			"instead of thousands of raw points; use `read_health_data` when the " +
			"individual points matter. Every request must " +
			"use either an API key or an OAuth access token with the " +
			`\`${MCP_OAUTH_SCOPE}\` scope. A live read reaches back at most ` +
			`${HISTORY_LIMIT_DAYS} days; if the user stores their history, a read ` +
			"with both `from` and `to` can reach back years instead.",
	});

	server.registerTool(
		"list_health_data_types",
		{
			title: "List health data types",
			description:
				"List every Google Health data type that can be queried, with how " +
				"each one is timed. Call this before `read_health_data` rather than " +
				"guessing an id. Requires authentication, but reaches nothing outside " +
				"this server.",
			inputSchema: {},
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		() => {
			const refusal = missingScope(identity, "list_health_data_types");
			if (refusal !== null) return refusal;

			return json({
				aggregateOnlyDataTypes: describeAggregateOnlyTypes(),
				dataTypes: describeDataTypes(),
				readableCategories: readableCategories(),
				note:
					"A data type can only be read if the user granted its consent " +
					"category. Categories outside `readableCategories` are write-only " +
					"in this API version and can never be read back.",
			});
		},
	);

	server.registerTool(
		"read_health_data",
		{
			title: "Read health data",
			description:
				"Read the user's data points for one data type over a time range. " +
				"Use an id from `list_health_data_types`. Times are RFC 3339, e.g. " +
				"`2026-08-01T00:00:00Z`; omit them to get the most recent data. " +
				"Give both `from` and `to` for anything historical: a bounded range " +
				"can be answered from this account's stored history, which reaches " +
				"much further back than a live read, and the reply says which was " +
				"used in `source`.",
			inputSchema: {
				dataType: z
					.string()
					.describe("Data type id, e.g. `steps`, `sleep`, `heart-rate`."),
				from: z
					.string()
					.optional()
					.describe(
						"Inclusive start, RFC 3339. Defaults to the oldest readable.",
					),
				to: z
					.string()
					.optional()
					.describe("Exclusive end, RFC 3339. Defaults to now."),
				limit: z
					.number()
					.int()
					.positive()
					.max(MAX_LIMIT)
					.optional()
					.describe(
						`How many points to return. Defaults to ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}.`,
					),
			},
			// Reaches Google, so not a closed world — but it only ever reads.
			annotations: { readOnlyHint: true, openWorldHint: true },
		},
		async (input) => readHealthData(identity, input),
	);

	server.registerTool(
		"aggregate_health_data",
		{
			title: "Aggregate health data",
			description:
				"Summarise one data type into hourly or daily buckets over a time " +
				"range — daily step totals, hourly heart-rate averages, minutes " +
				"asleep per night. Prefer this to `read_health_data` for totals and " +
				"trends: raw data is minute-level, and a week of it is thousands of " +
				"points. Use an id from `list_health_data_types`, including its " +
				"`aggregateOnlyDataTypes` such as `total-calories`. The window is " +
				"widened outward to whole buckets, so every bucket returned is " +
				`complete; one call returns at most ${MAX_AGGREGATE_BUCKETS} buckets. ` +
				"The reply's `method` says whether Google reconciled the numbers " +
				"across devices (`google-rollup`) or this server computed them " +
				"from raw points (`computed`), and the `values` differ accordingly.",
			inputSchema: {
				dataType: z
					.string()
					.describe("Data type id, e.g. `steps`, `heart-rate`, `sleep`."),
				granularity: z
					.enum(["hour", "day"])
					.describe(
						"Bucket size. Daily summary types only support `day`. Sleep is " +
							"counted on the day it ended.",
					),
				from: z
					.string()
					.optional()
					.describe(
						"Start, RFC 3339. Defaults to " +
							`${DEFAULT_AGGREGATE_SPAN_MS.day / DAY_MS} days before \`to\` for ` +
							`\`day\`, ${DEFAULT_AGGREGATE_SPAN_MS.hour / DAY_MS} day for \`hour\`.`,
					),
				to: z.string().optional().describe("End, RFC 3339. Defaults to now."),
				utcOffsetMinutes: z
					.number()
					.int()
					.min(MIN_UTC_OFFSET_MINUTES)
					.max(MAX_UTC_OFFSET_MINUTES)
					.optional()
					.describe(
						"The user's UTC offset in minutes, e.g. 480 for UTC+8, -300 for " +
							"UTC-5. Bucket boundaries are drawn on this clock, so set it " +
							"for days to mean the user's days. Defaults to 0 (UTC).",
					),
			},
			annotations: { readOnlyHint: true, openWorldHint: true },
		},
		async (input) => aggregateHealthData(identity, input),
	);

	server.registerTool(
		"get_health_profile",
		{
			title: "Get health profile",
			description:
				"The user's Google Health profile and app settings — date of birth, " +
				"height, biological sex, unit preferences. Useful for interpreting " +
				"the numbers `read_health_data` returns.",
			inputSchema: {},
			annotations: { readOnlyHint: true, openWorldHint: true },
		},
		async () => {
			const refusal = missingScope(identity, "get_health_profile");
			if (refusal !== null) return refusal;
			const client = clientFor(identity);

			try {
				// Settings are a separate grant from the profile, so a user may have
				// one and not the other. Failing the whole tool over the optional
				// half would be worse than reporting what was readable.
				const [profile, settings] = await Promise.all([
					client.getProfile(),
					client.getSettings().catch(() => null),
				]);

				return json({ profile, settings });
			} catch (error) {
				log.warn("profile read failed", {
					error: error instanceof Error ? error.message : String(error),
				});
				return text(describeApiError(error, []), true);
			}
		},
	);

	return server;
}
