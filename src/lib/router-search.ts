import {
	defaultParseSearch,
	defaultStringifySearch,
} from "@tanstack/react-router";

/**
 * Preserve the exact query spelling read from browser history.
 *
 * OAuth Provider signs a canonical query and redirects it through `/login` and
 * `/consent`. TanStack's JSON search serializer normally rewrites repeated
 * parameters such as `ba_param=a&ba_param=b` into one JSON array value. That
 * changes the signed parameter set. The snapshot below lets an untouched
 * location keep its original query while ordinary search updates still use
 * TanStack's default JSON serialization.
 */

const RAW_SEARCH_SNAPSHOT = Symbol("raw-search-snapshot");

interface RawSearchSnapshot {
	raw: string;
	normalized: string;
}

interface TrackedSearch extends Record<string, unknown> {
	[RAW_SEARCH_SNAPSHOT]?: RawSearchSnapshot;
}

export function parseAppSearch(search: string): TrackedSearch {
	const parsed: TrackedSearch = defaultParseSearch(search);
	Object.defineProperty(parsed, RAW_SEARCH_SNAPSHOT, {
		value: {
			raw: search,
			normalized: defaultStringifySearch(parsed),
		} satisfies RawSearchSnapshot,
		enumerable: true,
	});
	return parsed;
}

export function stringifyAppSearch(search: TrackedSearch): string {
	const normalized = defaultStringifySearch(search);
	const snapshot = search[RAW_SEARCH_SNAPSHOT];
	return snapshot?.normalized === normalized ? snapshot.raw : normalized;
}
