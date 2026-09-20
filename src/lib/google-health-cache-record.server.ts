import { createHash } from "node:crypto";
import type {
	DataPoint,
	GoogleHealthDataTypeId,
	GoogleHealthTimeShape,
} from "./google-health-api.gen";
import { googleHealthDataType } from "./google-health-filter";
import { summarizeDataPoint } from "./mcp/health";

/**
 * Turning a Google `DataPoint` into a cacheable row.
 *
 * The whole point of this module is the identity it computes. A cached point is
 * keyed by a digest rather than by an auto-increment, because the daily sync
 * deliberately re-reads the last few days every night — late device backfill is
 * the normal case — and re-reading has to be an upsert, not a second copy of
 * the same observation.
 *
 * This is the piece of the cache most likely to be wrong in a way nobody
 * notices for a month: a key that is too coarse silently merges two
 * observations, and one that is too fine silently duplicates them. So it lives
 * here, pure, under the coverage gate — `.server.ts` only because it reaches
 * for `node:crypto` and must not land in a browser bundle, the same way
 * `logger.server.ts` and `env.server.ts` are.
 */

/** A day, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 128 bits, hex. Collisions over 10^9 rows sit around 10^-21. */
const KEY_HEX_LENGTH = 32;

/**
 * A digest over parts that cannot be confused with one another.
 *
 * Each part is length-prefixed, so `("ab", "c")` and `("a", "bc")` cannot
 * produce the same key — which they would under plain concatenation, and which
 * would merge two users' points into one row.
 */
function digest(...parts: readonly string[]): string {
	const hash = createHash("sha256");
	for (const part of parts) {
		hash.update(`${part.length}\u0000${part}`);
	}
	return hash.digest("hex").slice(0, KEY_HEX_LENGTH);
}

function compareKeys(left: string, right: string): number {
	if (left < right) return -1;
	return left > right ? 1 : 0;
}

/**
 * JSON with object keys sorted and `undefined` members dropped, recursively.
 *
 * `JSON.stringify` preserves insertion order, and Google has no obligation to
 * serialise a payload's fields in the same order twice. Hashing its output
 * directly would read a reordered response as a different observation.
 */
export function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value) ?? "null";
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalJson).join(",")}]`;
	}
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, member]) => member !== undefined)
		.sort(([left], [right]) => compareKeys(left, right));
	return `{${entries
		.map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`)
		.join(",")}}`;
}

/** Digest of a point's `dataSource`, or `null` when it carries none. */
export function healthSourceKey(source: unknown): string | null {
	return source === undefined || source === null
		? null
		: digest(canonicalJson(source));
}

export interface HealthPointIdentityInput {
	resourceName: string | null;
	dataType: string;
	grain: HealthCacheGrain;
	observedAtMs: number;
	observedEndMs: number;
	sourceKey: string | null;
}

/**
 * What makes this point *this* point, within one user and data type.
 *
 * Google's `name` wins whenever it exists: it is Google's own identity for the
 * point, and it survives an edit to the measurement.
 *
 * Where there is no `name`, identity is the normalized time plus the source —
 * deliberately *not* the measurement. Keying on the measurement would turn a
 * corrected value into a second row, and two rows for one observation
 * double-count in every sum anything downstream ever writes. The opposite risk,
 * collapsing two genuinely distinct observations that share a type, an instant
 * and a device, is confined to the types where that can happen — logs, sessions,
 * symptoms — and those are exactly the identifiable ones that carry a `name`.
 *
 * The *normalized* instants are used rather than the raw envelope because
 * Google may start or stop sending `civilStartTime` and `startUtcOffset`
 * alongside `startTime` without the observation having changed; hashing the raw
 * envelope would read that as a new point.
 */
export function healthPointIdentity(input: HealthPointIdentityInput): string {
	if (input.resourceName !== null) return `name:${input.resourceName}`;
	return `derived:${canonicalJson({
		a: input.observedAtMs,
		e: input.observedEndMs,
		g: input.grain,
		s: input.sourceKey,
		t: input.dataType,
	})}`;
}

/** The row's primary key. The only unique key on `health_data_point`. */
export function healthPointId(
	userId: string,
	dataType: string,
	identity: string,
): string {
	return digest(userId, dataType, identity);
}

/**
 * Changes when the observation does, so a caller can tell a rewrite from a
 * no-op without diffing JSON.
 */
export function healthContentHash(record: {
	value: unknown;
	observedTime: unknown;
	source: unknown;
}): string {
	return digest(
		canonicalJson({
			observedTime: record.observedTime,
			source: record.source,
			value: record.value,
		}),
	);
}

/** `health_sync_state`'s primary key: deterministic, so a write needs no read. */
export function healthSyncStateId(userId: string, dataType: string): string {
	return digest(userId, dataType);
}

/** `point` is a stored observation; `day` is a rollup of many. */
export type HealthCacheGrain = "point" | "day";

/** One row of `health_data_point`, ready for any of the three dialects. */
export interface HealthCacheRecord {
	id: string;
	userId: string;
	dataType: string;
	grain: HealthCacheGrain;
	timeShape: GoogleHealthTimeShape;
	observedAtMs: number;
	observedEndMs: number;
	observedTime: Record<string, unknown>;
	value: Record<string, unknown>;
	source: Record<string, unknown> | null;
	sourceKey: string | null;
	resourceName: string | null;
	contentHash: string;
	syncedAt: Date;
}

export type HealthCacheMappingFailure =
	/** The envelope carried no measurement at all. */
	| "not-a-data-point"
	/** Google answered with a different type than the one requested. */
	| "wrong-data-type"
	/** No usable instant — the point cannot be placed on a timeline. */
	| "untimed"
	/** The interval ends before it starts, which breaks the overlap query. */
	| "inverted-interval";

export type HealthCacheMapping =
	| { ok: true; record: HealthCacheRecord }
	| { ok: false; reason: HealthCacheMappingFailure };

export interface HealthCacheContext {
	userId: string;
	dataType: GoogleHealthDataTypeId;
	/** The run's start, stamped on every row it writes. Drives the prune sweep. */
	syncedAt: Date;
	grain?: HealthCacheGrain;
}

interface NormalizedTime {
	observedAtMs: number;
	observedEndMs: number;
}

/**
 * The two comparable instants, from the shape the data type is timed by.
 *
 * A daily summary's `YYYY-MM-DD` is parsed as UTC midnight, which is what
 * `Date.parse` does for a date-only form by spec — and it matches how
 * `dateLiteral()` in `google-health-filter.ts` renders the same day into a
 * filter, so a cached row and a live query agree on where the day sits.
 *
 * The invariant every caller downstream relies on is `observedEndMs >=
 * observedAtMs`: it is what lets one overlap predicate serve all three shapes.
 */
function normalizeTime(
	shape: GoogleHealthTimeShape,
	start: string | undefined,
	end: string | undefined,
): NormalizedTime | HealthCacheMappingFailure {
	if (start === undefined) return "untimed";
	const observedAtMs = Date.parse(start);
	if (Number.isNaN(observedAtMs)) return "untimed";

	if (shape === "daily") {
		return { observedAtMs, observedEndMs: observedAtMs + DAY_MS };
	}
	if (shape === "sample" || end === undefined) {
		return { observedAtMs, observedEndMs: observedAtMs };
	}

	const observedEndMs = Date.parse(end);
	if (Number.isNaN(observedEndMs)) {
		return { observedAtMs, observedEndMs: observedAtMs };
	}
	// Clamping instead would hide the fault and leave a row that the overlap
	// predicate cannot match. Counting it is more useful than storing it.
	if (observedEndMs < observedAtMs) return "inverted-interval";

	return { observedAtMs, observedEndMs };
}

/**
 * Which member of a payload carries its time, by the shape it is timed with.
 *
 * Derived from the shape rather than found by scanning the payload, for the
 * same reason the filter module resolves its field that way: the catalog is the
 * authority on how a type is timed, and a scan would quietly pick a different
 * member if Google ever added one.
 */
const TIME_FIELD_BY_SHAPE = {
	daily: "date",
	interval: "interval",
	sample: "sampleTime",
} as const satisfies Record<GoogleHealthTimeShape, string>;

/**
 * The raw time envelope, kept verbatim.
 *
 * This is the one thing `summarizeDataPoint` throws away that the cache needs:
 * the summary keeps only `startTime` / `endTime` / `physicalTime`, while
 * `civilStartTime`, `civilTime` and the UTC offsets live here. Storing them is
 * what lets the original `DataPoint` be reconstructed from a row, without
 * storing the point a second time alongside its own summary.
 */
function observedTimeOf(
	payload: Record<string, unknown>,
	shape: GoogleHealthTimeShape,
): Record<string, unknown> {
	const field = TIME_FIELD_BY_SHAPE[shape];
	return { [field]: payload[field] };
}

/**
 * Maps one `DataPoint` onto a cache row, or says why it cannot.
 *
 * Reuses `summarizeDataPoint` for the measurement and the normalized instants
 * rather than re-deriving them, so a cached row and an MCP reply cannot drift
 * apart. The two things it needs that the summary does not give are the raw
 * time envelope — the summary drops `civilStartTime` and the UTC offsets, and
 * the cache keeps them so the original point can be reconstructed — and the
 * check that Google answered about the type that was asked for. That check is
 * worth failing loudly: storing a response under the wrong type is a silent
 * corruption that every later read inherits.
 *
 * Returns a result rather than throwing. A single malformed point in a page of
 * two thousand should be counted and skipped, not abort the window.
 */
export function toHealthCacheRecord(
	point: DataPoint,
	context: HealthCacheContext,
): HealthCacheMapping {
	const summary = summarizeDataPoint(point);
	if (summary === null) return { ok: false, reason: "not-a-data-point" };

	const type = googleHealthDataType(context.dataType);
	if (type.field !== summary.type) {
		return { ok: false, reason: "wrong-data-type" };
	}

	const time = normalizeTime(type.shape, summary.start, summary.end);
	if (typeof time === "string") return { ok: false, reason: time };

	const payload = (point as Record<string, unknown>)[type.field] as Record<
		string,
		unknown
	>;
	const source = point.dataSource ?? null;
	const grain = context.grain ?? "point";
	const observedTime = observedTimeOf(payload, type.shape);
	const sourceKey = healthSourceKey(source);
	const resourceName = point.name ?? null;

	const identity = healthPointIdentity({
		dataType: context.dataType,
		grain,
		observedAtMs: time.observedAtMs,
		observedEndMs: time.observedEndMs,
		resourceName,
		sourceKey,
	});

	return {
		ok: true,
		record: {
			contentHash: healthContentHash({
				observedTime,
				source,
				value: summary.value,
			}),
			dataType: context.dataType,
			grain,
			id: healthPointId(context.userId, context.dataType, identity),
			observedAtMs: time.observedAtMs,
			observedEndMs: time.observedEndMs,
			observedTime,
			resourceName,
			source: source as Record<string, unknown> | null,
			sourceKey,
			syncedAt: context.syncedAt,
			timeShape: type.shape,
			userId: context.userId,
			value: summary.value,
		},
	};
}
