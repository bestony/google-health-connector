import { describe, expect, it } from "vitest";
import { parseAppSearch, stringifyAppSearch } from "./router-search";

describe("router search serialization", () => {
	it("keeps an untouched signed query byte-for-byte", () => {
		const raw =
			"?client_id=x%2By&scope=openid%20health&ba_param=client_id&ba_param=sig&sig=fake%2Bsignature";
		const parsed = parseAppSearch(raw);

		expect(parsed.ba_param).toEqual(["client_id", "sig"]);
		expect(stringifyAppSearch(parsed)).toBe(raw);
	});

	it("uses TanStack serialization after a search value changes", () => {
		const parsed = parseAppSearch("?page=1&filter=old");
		const changed = { ...parsed, filter: "new" };

		expect(stringifyAppSearch(changed)).toBe("?page=1&filter=new");
	});
});
