import { describe, expect, it } from "vitest";
import {
	DATABASE_DIALECTS,
	DATABASE_URL_EXAMPLES,
	detectDatabaseDialect,
	isLocalSqliteUrl,
} from "./dialect";

describe("database dialect detection", () => {
	it("keeps the supported dialect catalog and examples stable", () => {
		expect(DATABASE_DIALECTS).toEqual(["sqlite", "postgresql", "mysql"]);
		expect(DATABASE_URL_EXAMPLES).toHaveLength(4);
	});

	it.each([
		[":memory:", "sqlite"],
		["file:test.db", "sqlite"],
		["libsql://db.turso.io", "sqlite"],
		["http://localhost:8080", "sqlite"],
		["https://db.turso.io", "sqlite"],
		["ws://localhost", "sqlite"],
		["wss://db.turso.io", "sqlite"],
		["postgres://user:secret@localhost/db", "postgresql"],
		["postgresql://user:secret@localhost/db", "postgresql"],
		["mysql://user:secret@localhost/db", "mysql"],
		["mariadb://user:secret@localhost/db", "mysql"],
	] as const)("maps %s to %s", (url, dialect) => {
		expect(detectDatabaseDialect(url)).toBe(dialect);
	});

	it("returns undefined for malformed or unsupported URLs", () => {
		expect(detectDatabaseDialect("localhost:5432")).toBeUndefined();
		expect(detectDatabaseDialect("redis://localhost")).toBeUndefined();
		expect(detectDatabaseDialect("not a url")).toBeUndefined();
	});

	it("recognizes only in-process SQLite URLs as local", () => {
		expect(isLocalSqliteUrl(":memory:")).toBe(true);
		expect(isLocalSqliteUrl("file:./test.db")).toBe(true);
		expect(isLocalSqliteUrl("libsql://db.turso.io")).toBe(false);
		expect(isLocalSqliteUrl("sqlite:test.db")).toBe(false);
	});
});
