/** User-facing reason new stored-history opt-ins are refused. */
export const HEALTH_SYNC_OPT_IN_DISABLED_MESSAGE =
	"Stored health history is unavailable for new opt-ins.";

/** Keep the server function boundary strict for direct RPC callers. */
export function validateHealthSyncPreferenceChange(value: unknown): boolean {
	if (typeof value !== "boolean") {
		throw new Error("Health sync preference must be a boolean.");
	}
	return value;
}

/**
 * The deployment may keep serving existing stored-history accounts, but users
 * cannot create a new opt-in. Disabling remains allowed so an existing user can
 * delete the copy held for them.
 */
export function assertHealthSyncPreferenceChangeAllowed(
	enabled: boolean,
): void {
	if (enabled) {
		throw new Error(HEALTH_SYNC_OPT_IN_DISABLED_MESSAGE);
	}
}
