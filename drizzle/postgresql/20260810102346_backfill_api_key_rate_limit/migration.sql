-- Hand-written data migration: no schema change, so there is no snapshot.json
-- beside this file. drizzle-orm's migrator only needs `migration.sql`, and
-- drizzle-kit keeps diffing against the previous folder's snapshot, which still
-- describes this schema exactly.
--
-- better-auth's api-key plugin copies `rateLimit.timeWindow` / `maxRequests`
-- onto each key row when the key is issued, and reads them back off the row at
-- verification time. Raising the plugin's limits therefore leaves every key
-- already in the database on the limit it was born with, and the earlier
-- migrations only moved the column DEFAULT, which applies to inserts alone.
--
-- The values below must match `API_KEY_RATE_LIMIT` in
-- `src/lib/api-key-config.ts` at the time this migration was written.
UPDATE "apikey"
SET "rate_limit_time_window" = 1000,
	"rate_limit_max" = 10000,
	"request_count" = 0,
	"last_request" = NULL;
