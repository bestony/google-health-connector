import { describe, expect, it } from "vitest";
import { canonicalJson } from "./canonical-json";

describe("canonicalJson", () => {
	it("is independent of key order", () => {
		expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
		expect(canonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
	});

	it("drops undefined members but keeps null", () => {
		expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
	});

	it("sorts nested objects and preserves array order", () => {
		expect(canonicalJson({ list: [{ z: 1, y: 2 }, 3] })).toBe(
			'{"list":[{"y":2,"z":1},3]}',
		);
	});

	it("renders primitives and a bare undefined", () => {
		expect(canonicalJson(undefined)).toBe("null");
		expect(canonicalJson(null)).toBe("null");
		expect(canonicalJson("x")).toBe('"x"');
		expect(canonicalJson(7)).toBe("7");
	});
});
