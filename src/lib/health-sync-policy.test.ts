import { describe, expect, it } from "vitest";
import {
	assertHealthSyncPreferenceChangeAllowed,
	HEALTH_SYNC_OPT_IN_DISABLED_MESSAGE,
	validateHealthSyncPreferenceChange,
} from "./health-sync-policy";

describe("health sync opt-in policy", () => {
	it("allows existing users to disable stored history", () => {
		expect(() => assertHealthSyncPreferenceChangeAllowed(false)).not.toThrow();
	});

	it("rejects new stored-history opt-ins", () => {
		expect(() => assertHealthSyncPreferenceChangeAllowed(true)).toThrow(
			HEALTH_SYNC_OPT_IN_DISABLED_MESSAGE,
		);
	});

	it("rejects non-boolean RPC input", () => {
		expect(() => validateHealthSyncPreferenceChange("false")).toThrow(
			"Health sync preference must be a boolean.",
		);
	});
});
