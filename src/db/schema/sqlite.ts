import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./sqlite-auth";

/**
 * SQLite schema — Turso (`libsql://`) and a local `file:` database alike.
 *
 * Re-exporting the generated better-auth tables here is what makes
 * `drizzle-kit generate` pick them up — `drizzle.config.ts` points at this file
 * — and it keeps `pnpm auth:generate:sqlite` free to overwrite `./sqlite-auth.ts`
 * without touching this module.
 *
 * The application tables below are the health data cache. They exist in all
 * three dialect modules under the same table and column *names*; only the types
 * differ. They move as a set — editing one alone is what produces an app that
 * works on SQLite and falls over on Postgres.
 */
export * from "./sqlite-auth";

/**
 * Cached Google Health data points, one row per observation.
 *
 * `id` is not random: it is a digest of (user, data type, the point's identity)
 * computed by `src/lib/google-health-cache-record.server.ts`, which is what
 * makes re-fetching the same day an upsert rather than a duplicate. It is also
 * the *only* unique key on the table — MySQL's `ON DUPLICATE KEY UPDATE` fires
 * on any unique key, so a second one would silently change what an upsert
 * means. Do not add one.
 *
 * Observation instants are epoch milliseconds rather than a timestamp type.
 * They are compared against caller-supplied bounds and have to sort identically
 * on three engines, and MySQL's `TIMESTAMP` is both 2038-bound and converted by
 * session time zone on read. The `_ms` suffix is what stops someone passing a
 * `Date` into `observedAtMs`. Bookkeeping timestamps such as `syncedAt` follow
 * the generated auth schema's convention instead, because they are read by
 * humans and bound by drizzle as dates.
 */
export const healthDataPoint = sqliteTable(
	"health_data_point",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** The kebab-case path id, e.g. `steps` — never the camel-case field. */
		dataType: text("data_type").notNull(),
		/** `point` for a stored observation, `day` for a rollup of many. */
		grain: text("grain").default("point").notNull(),
		/** `interval` | `sample` | `daily`, from the generated catalog. */
		timeShape: text("time_shape").notNull(),
		observedAtMs: integer("observed_at_ms").notNull(),
		/** Equal to `observed_at_ms` for a sample, or an interval with no end. */
		observedEndMs: integer("observed_end_ms").notNull(),
		/** The raw `interval` / `sampleTime` / `date` envelope, verbatim. */
		observedTime: text("observed_time", { mode: "json" })
			.$type<Record<string, unknown>>()
			.notNull(),
		/** The payload with its time removed — `summarizeDataPoint`'s `value`. */
		value: text("value", { mode: "json" })
			.$type<Record<string, unknown>>()
			.notNull(),
		source: text("source", { mode: "json" }).$type<Record<string, unknown>>(),
		/** Digest of `source`. Part of the identity, and what an aggregate groups by. */
		sourceKey: text("source_key"),
		/** Google's `name`, present only for identifiable data types. */
		resourceName: text("resource_name"),
		/** Digest of the measurement: tells a rewrite from a no-op. */
		contentHash: text("content_hash").notNull(),
		/** The sync run that last wrote this row. Drives the prune sweep. */
		syncedAt: integer("synced_at", { mode: "timestamp_ms" }).notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
	},
	(table) => [
		index("healthDataPoint_userId_dataType_observedAtMs_idx").on(
			table.userId,
			table.dataType,
			table.observedAtMs,
		),
	],
);

/**
 * One row per (user, data type): what has been synced, and what stopped.
 *
 * Coverage is a single contiguous half-open range — `covered_from_ms` to
 * `covered_through_ms` — rather than a set of ranges, because coverage only
 * ever grows by two monotone motions from one anchor: the daily job extends the
 * top, the backfill extends the bottom. Both windows are computed from the
 * current watermarks, so a gap cannot arise unless a job fetches a window it
 * was not told to — and `mergeCoverage` refuses that case outright instead of
 * recording a lie. See `src/lib/google-health-sync-window.ts`.
 *
 * Failure lives here rather than in its own table because it has the same key
 * and the same lifetime, and because clearing a failure must not be able to
 * lose the watermarks.
 */
export const healthSyncState = sqliteTable(
	"health_sync_state",
	{
		/** Digest of (user, data type), so a write needs no prior read. */
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		dataType: text("data_type").notNull(),
		coveredFromMs: integer("covered_from_ms"),
		coveredThroughMs: integer("covered_through_ms"),
		/** The backfill reached the floor; there is nothing older to ask for. */
		backfillComplete: integer("backfill_complete", { mode: "boolean" })
			.default(false)
			.notNull(),
		lastSyncAt: integer("last_sync_at", { mode: "timestamp_ms" }),
		lastAttemptAt: integer("last_attempt_at", { mode: "timestamp_ms" }),
		lastPointCount: integer("last_point_count").default(0).notNull(),
		failureStatus: integer("failure_status"),
		failureCode: text("failure_code"),
		failureMessage: text("failure_message"),
		failureCount: integer("failure_count").default(0).notNull(),
		failedAt: integer("failed_at", { mode: "timestamp_ms" }),
		/** Set once the failure is permanent. Non-null means "stop asking". */
		disabledAt: integer("disabled_at", { mode: "timestamp_ms" }),
		/** When a disabled pair may be probed again — a later grant should take effect. */
		retryAfter: integer("retry_after", { mode: "timestamp_ms" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("healthSyncState_userId_idx").on(table.userId),
		index("healthSyncState_disabledAt_lastSyncAt_idx").on(
			table.disabledAt,
			table.lastSyncAt,
		),
	],
);

/**
 * One row per user: whether they opted into caching, and what the sync needs to
 * know about them.
 *
 * `enabled` defaults to false and nothing turns it on but the user, on
 * `/dashboard`. The privacy policy says we hold no copy until you ask for one,
 * and this column is what makes that true rather than a claim.
 *
 * The timezone is cached here because resolving it costs a Google call against
 * a *separate* consent category (`settings.readonly`), which many users will
 * not have granted. `time_zone_source` records which of the three answers was
 * used so an operator can tell "the user is in UTC" from "we never found out".
 */
export const healthSyncAccount = sqliteTable("health_sync_account", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	enabled: integer("enabled", { mode: "boolean" }).default(false).notNull(),
	enabledAt: integer("enabled_at", { mode: "timestamp_ms" }),
	disabledAt: integer("disabled_at", { mode: "timestamp_ms" }),
	/** IANA zone from `Settings.timeZone`, e.g. `Asia/Shanghai`. */
	timeZone: text("time_zone"),
	/** `settings` | `observed` | `default`. */
	timeZoneSource: text("time_zone_source"),
	/** From `Profile.membershipStartDate` — the backfill's natural floor. */
	membershipStartDateMs: integer("membership_start_date_ms"),
	lastProbedAt: integer("last_probed_at", { mode: "timestamp_ms" }),
	createdAt: integer("created_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.$onUpdate(() => /* @__PURE__ */ new Date())
		.notNull(),
});
