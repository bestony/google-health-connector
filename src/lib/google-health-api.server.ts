import {
	type DataPoint,
	GOOGLE_HEALTH_API_VERSION,
	GOOGLE_HEALTH_ROOT_URL,
	type GoogleHealthDataTypeId,
	type Identity,
	type IrnProfile,
	type ListDataPointsResponse,
	type ListPairedDevicesResponse,
	type Operation,
	type PairedDevice,
	type Profile,
	type Settings,
} from "./google-health-api.gen";
import {
	dataPointsParent,
	dataPointTimeFilter,
	type TimeRange,
} from "./google-health-filter";
import {
	type GoogleHealthAccessToken,
	getGoogleHealthAccessToken,
} from "./google-health-token.server";
import { createLogger } from "./logger.server";

/**
 * Typed client for the Google Health API (v4).
 *
 * ```ts
 * const health = createGoogleHealthClient();
 *
 * // Yesterday's steps, without writing a filter by hand.
 * const { dataPoints } = await health.listDataPoints("steps", {
 *   from: startOfYesterday,
 *   to: startOfToday,
 * });
 *
 * // Everything in a window, following pagination for you.
 * for await (const point of health.iterateDataPoints("sleep", { from, to })) {
 *   console.log(point.sleep?.summary);
 * }
 * ```
 *
 * Server-only: it obtains the user's access token from the request's session,
 * which means it must be called inside a request and must never be imported by
 * a component. `google-health-filter.ts` holds the parts that are safe to share
 * with the browser.
 *
 * The token is fetched once per client and reused. better-auth refreshes an
 * access token that is within five seconds of expiring, and a client is built
 * per request, so a stale token is not a case that arises — but the memoised
 * promise is the reason a client should not be cached across requests.
 */

const log = createLogger("google-health:api");

/**
 * Google's error envelope. Only the parts worth surfacing are typed: the rest
 * is diagnostic detail that belongs in a log, not in a caller's control flow.
 */
interface GoogleApiErrorBody {
	error?: {
		code?: number;
		message?: string;
		status?: string;
	};
}

/**
 * A non-2xx answer from the API.
 *
 * `status` and Google's own `status` string are both carried because they
 * answer different questions: the HTTP code decides whether to retry, and the
 * canonical name (`PERMISSION_DENIED`, `NOT_FOUND`) is what the message means.
 */
export class GoogleHealthApiError extends Error {
	readonly status: number;
	readonly googleStatus: string | undefined;
	readonly path: string;

	constructor(status: number, path: string, body: GoogleApiErrorBody) {
		const detail = body.error?.message ?? "no message";
		super(`Google Health API ${status} on ${path}: ${detail}`);
		this.name = "GoogleHealthApiError";
		this.status = status;
		this.googleStatus = body.error?.status;
		this.path = path;
	}

	/** Whether retrying the same request could plausibly succeed. */
	get retryable(): boolean {
		return this.status === 429 || this.status >= 500;
	}
}

export interface ListDataPointsOptions extends TimeRange {
	/**
	 * How many points to ask for. The API defaults to 1440 and caps the value
	 * itself, so this is a hint rather than a guarantee.
	 */
	pageSize?: number;
	pageToken?: string;
	/**
	 * Replaces the time filter entirely, for expressions this client does not
	 * build. Giving both is a mistake, and is refused rather than silently
	 * preferring one.
	 */
	filter?: string;
}

export interface GoogleHealthClientOptions {
	/**
	 * Scopes to check before the first call. Left empty, an unauthorized call
	 * fails at Google with a 403 rather than here with a message naming the
	 * scope — so pass what the code path actually needs.
	 */
	requiredScopes?: readonly string[];
	/**
	 * Act for this user rather than for whoever the request's session belongs
	 * to. `/mcp` passes the id its API key resolved to, because an MCP request
	 * carries no session cookie.
	 */
	userId?: string;
	/**
	 * Supplies the bearer token. Defaults to the signed-in user's, from the
	 * request session; override it in tests, or to act for a user resolved some
	 * other way.
	 */
	getAccessToken?: () => Promise<GoogleHealthAccessToken>;
	/** Injection point for tests. Defaults to global `fetch`. */
	fetch?: typeof fetch;
}

export interface GoogleHealthClient {
	/** One page of data points for `id`, narrowed to a time range. */
	listDataPoints(
		id: GoogleHealthDataTypeId,
		options?: ListDataPointsOptions,
	): Promise<ListDataPointsResponse>;
	/** Every data point for `id` in a range, following pagination. */
	iterateDataPoints(
		id: GoogleHealthDataTypeId,
		options?: ListDataPointsOptions,
	): AsyncGenerator<DataPoint, void, undefined>;
	/** Collects `iterateDataPoints` into an array. Bounded by `limit`. */
	collectDataPoints(
		id: GoogleHealthDataTypeId,
		options?: ListDataPointsOptions & { limit?: number },
	): Promise<DataPoint[]>;
	getDataPoint(name: string): Promise<DataPoint>;
	createDataPoint(
		id: GoogleHealthDataTypeId,
		dataPoint: DataPoint,
	): Promise<Operation>;
	updateDataPoint(name: string, dataPoint: DataPoint): Promise<Operation>;
	deleteDataPoints(
		id: GoogleHealthDataTypeId,
		names: readonly string[],
	): Promise<Operation>;
	getProfile(): Promise<Profile>;
	updateProfile(profile: Profile, updateMask?: string): Promise<Profile>;
	getSettings(): Promise<Settings>;
	updateSettings(settings: Settings, updateMask?: string): Promise<Settings>;
	getIdentity(): Promise<Identity>;
	getIrnProfile(): Promise<IrnProfile>;
	listPairedDevices(): Promise<ListPairedDevicesResponse>;
	getPairedDevice(name: string): Promise<PairedDevice>;
	/**
	 * The Google Health scopes this user actually granted.
	 *
	 * Reads the token the client already resolved, so asking costs nothing —
	 * which is what makes it usable in an error path, where the answer to "why
	 * was that refused" is usually "that category was never granted".
	 */
	grantedScopes(): Promise<readonly string[]>;
	/**
	 * Escape hatch for anything not wrapped above. `path` is relative to the
	 * version segment, e.g. `users/me/dataTypes/steps/dataPoints`.
	 */
	request<T>(
		method: string,
		path: string,
		init?: {
			query?: Record<string, string | number | undefined>;
			body?: unknown;
		},
	): Promise<T>;
}

/** Default page size for the paginating helpers. The API's own default. */
const DEFAULT_PAGE_SIZE = 1440;

export function createGoogleHealthClient(
	options: GoogleHealthClientOptions = {},
): GoogleHealthClient {
	const doFetch = options.fetch ?? fetch;
	const resolveToken =
		options.getAccessToken ??
		(() =>
			getGoogleHealthAccessToken({
				requiredScopes: options.requiredScopes,
				userId: options.userId,
			}));

	// Memoised, not cached: one token per client, and a client per request.
	let tokenPromise: Promise<GoogleHealthAccessToken> | undefined;
	function accessToken(): Promise<GoogleHealthAccessToken> {
		tokenPromise ??= resolveToken();
		return tokenPromise;
	}

	async function request<T>(
		method: string,
		path: string,
		init: {
			query?: Record<string, string | number | undefined>;
			body?: unknown;
		} = {},
	): Promise<T> {
		const { accessToken: token } = await accessToken();

		const url = new URL(
			`${GOOGLE_HEALTH_API_VERSION}/${path}`,
			GOOGLE_HEALTH_ROOT_URL,
		);
		for (const [key, value] of Object.entries(init.query ?? {})) {
			if (value !== undefined) url.searchParams.set(key, String(value));
		}

		const startedAt = performance.now();
		const response = await doFetch(url, {
			method,
			headers: {
				Authorization: `Bearer ${token}`,
				...(init.body === undefined
					? {}
					: { "Content-Type": "application/json" }),
			},
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
		});

		const durationMs = Math.round(performance.now() - startedAt);

		if (!response.ok) {
			// A body that will not parse is not worth failing over — the status is
			// the part that matters, and an empty envelope still produces a usable
			// message.
			const body = (await response.json().catch(() => ({}))) as
				| GoogleApiErrorBody
				| Record<string, never>;
			log.warn("request failed", {
				method,
				path,
				status: response.status,
				googleStatus: (body as GoogleApiErrorBody).error?.status ?? null,
				durationMs,
			});
			throw new GoogleHealthApiError(response.status, path, body);
		}

		log.debug("request", {
			method,
			path,
			status: response.status,
			durationMs,
		});

		// 204 and friends: `Operation` responses to a delete can be empty.
		if (response.status === 204) return {} as T;
		return (await response.json()) as T;
	}

	function listQuery(
		id: GoogleHealthDataTypeId,
		options: ListDataPointsOptions,
	): Record<string, string | number | undefined> {
		if (options.filter !== undefined && (options.from ?? options.to)) {
			throw new Error(
				"Pass either `filter` or a time range, not both: the two would have " +
					"to be combined, and only the caller knows how.",
			);
		}

		return {
			pageSize: options.pageSize,
			pageToken: options.pageToken,
			filter:
				options.filter ??
				dataPointTimeFilter(id, { from: options.from, to: options.to }),
		};
	}

	async function listDataPoints(
		id: GoogleHealthDataTypeId,
		options: ListDataPointsOptions = {},
	): Promise<ListDataPointsResponse> {
		return request<ListDataPointsResponse>(
			"GET",
			`${dataPointsParent(id)}/dataPoints`,
			{ query: listQuery(id, options) },
		);
	}

	async function* iterateDataPoints(
		id: GoogleHealthDataTypeId,
		options: ListDataPointsOptions = {},
	): AsyncGenerator<DataPoint, void, undefined> {
		let pageToken = options.pageToken;
		let pages = 0;

		do {
			const page = await listDataPoints(id, {
				...options,
				pageSize: options.pageSize ?? DEFAULT_PAGE_SIZE,
				pageToken,
			});
			pages += 1;

			for (const point of page.dataPoints ?? []) {
				yield point;
			}

			// An empty token and an absent one both mean "no more"; a token equal to
			// the one just used would loop forever, so it is treated as the end too.
			const next = page.nextPageToken;
			pageToken = next && next !== pageToken ? next : undefined;
		} while (pageToken !== undefined);

		log.debug("iterated data points", { id, pages });
	}

	return {
		listDataPoints,
		iterateDataPoints,

		async collectDataPoints(id, options = {}) {
			const { limit, ...rest } = options;
			const points: DataPoint[] = [];
			for await (const point of iterateDataPoints(id, rest)) {
				points.push(point);
				if (limit !== undefined && points.length >= limit) break;
			}
			return points;
		},

		getDataPoint(name) {
			return request<DataPoint>("GET", name);
		},

		createDataPoint(id, dataPoint) {
			return request<Operation>("POST", `${dataPointsParent(id)}/dataPoints`, {
				body: dataPoint,
			});
		},

		updateDataPoint(name, dataPoint) {
			return request<Operation>("PATCH", name, { body: dataPoint });
		},

		deleteDataPoints(id, names) {
			return request<Operation>(
				"POST",
				`${dataPointsParent(id)}/dataPoints:batchDelete`,
				{ body: { names } },
			);
		},

		getProfile() {
			return request<Profile>("GET", "users/me/profile");
		},

		updateProfile(profile, updateMask) {
			return request<Profile>("PATCH", "users/me/profile", {
				query: { updateMask },
				body: profile,
			});
		},

		getSettings() {
			return request<Settings>("GET", "users/me/settings");
		},

		updateSettings(settings, updateMask) {
			return request<Settings>("PATCH", "users/me/settings", {
				query: { updateMask },
				body: settings,
			});
		},

		getIdentity() {
			return request<Identity>("GET", "users/me/identity");
		},

		getIrnProfile() {
			return request<IrnProfile>("GET", "users/me/irnProfile");
		},

		listPairedDevices() {
			return request<ListPairedDevicesResponse>(
				"GET",
				"users/me/pairedDevices",
			);
		},

		getPairedDevice(name) {
			return request<PairedDevice>("GET", name);
		},

		async grantedScopes() {
			return (await accessToken()).grantedScopes;
		},

		request,
	};
}
