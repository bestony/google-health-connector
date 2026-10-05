/**
 * Order-independent JSON, for comparing structured values by content.
 *
 * Pure and import-free, so both the server and the browser bundle can use it.
 */

function compareKeys(left: string, right: string): number {
	if (left < right) return -1;
	return left > right ? 1 : 0;
}

/**
 * JSON with object keys sorted and `undefined` members dropped, recursively.
 *
 * `JSON.stringify` preserves insertion order, and Google has no obligation to
 * serialise a payload's fields in the same order twice. Comparing its output
 * directly would read a reordered response as a different value — for example,
 * one device reported as two `dataSource`s.
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
