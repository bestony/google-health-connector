import { describe, expect, it, vi } from "vitest";
import type { DataPoint } from "./google-health-api.gen";
import {
	createGoogleHealthClient,
	GoogleHealthApiError,
} from "./google-health-api.server";
import type { GoogleHealthAccessToken } from "./google-health-token.server";

const token: GoogleHealthAccessToken = {
	accessToken: "access-token",
	expiresAt: new Date("2026-08-10T00:00:00Z"),
	grantedScopes: [
		"https://www.googleapis.com/auth/googlehealth.steps.readonly",
	],
};

const point = { steps: { count: "1" } } as DataPoint;

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("Google Health API client", () => {
	it("builds filtered requests and memoizes the access token", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockImplementation(async () => jsonResponse({ dataPoints: [point] }));
		const resolveToken = vi.fn(async () => token);
		const client = createGoogleHealthClient({
			fetch: fetchMock,
			getAccessToken: resolveToken,
		});

		const page = await client.listDataPoints("steps", {
			from: new Date("2026-08-09T00:00:00Z"),
			to: new Date("2026-08-10T00:00:00Z"),
			pageSize: 2,
		});
		expect(page.dataPoints).toEqual([point]);
		await client.getProfile();
		expect(resolveToken).toHaveBeenCalledOnce();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const [url, init] = fetchMock.mock.calls.at(0) ?? [];
		expect(String(url)).toContain("/v4/users/me/dataTypes/steps/dataPoints");
		expect(String(url)).toContain("pageSize=2");
		expect(String(url)).toContain("filter=");
		expect(init?.method).toBe("GET");
		expect(init?.headers).toEqual({ Authorization: "Bearer access-token" });
		expect(await client.grantedScopes()).toEqual(token.grantedScopes);
	});

	it("rejects a caller that combines a custom filter and time range", async () => {
		const fetchMock = vi.fn<typeof fetch>();
		const client = createGoogleHealthClient({
			fetch: fetchMock,
			getAccessToken: async () => token,
		});
		await expect(
			client.listDataPoints("steps", {
				filter: 'steps.interval.start_time >= "now"',
				from: new Date(),
			}),
		).rejects.toThrow(/either `filter` or a time range/);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("iterates pages, stops on a repeated token and honors collection limits", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				jsonResponse({ dataPoints: [point], nextPageToken: "next" }),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					dataPoints: [{ steps: { count: "2" } }],
					nextPageToken: "next",
				}),
			);
		const client = createGoogleHealthClient({
			fetch: fetchMock,
			getAccessToken: async () => token,
		});
		const points: DataPoint[] = [];
		for await (const value of client.iterateDataPoints("steps"))
			points.push(value);
		expect(points).toHaveLength(2);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(String(fetchMock.mock.calls.at(0)?.[0])).toContain("pageSize=1440");
		expect(String(fetchMock.mock.calls.at(1)?.[0])).toContain("pageToken=next");

		const limitedFetch = vi
			.fn<typeof fetch>()
			.mockResolvedValue(jsonResponse({ dataPoints: [point] }));
		const limited = createGoogleHealthClient({
			fetch: limitedFetch,
			getAccessToken: async () => token,
		});
		expect(await limited.collectDataPoints("steps", { limit: 1 })).toEqual([
			point,
		]);
	});

	it("wraps every supported resource operation with the correct HTTP request", async () => {
		const responses = [
			jsonResponse(point),
			jsonResponse({ name: "create" }),
			jsonResponse({ name: "update" }),
			new Response(null, { status: 204 }),
			jsonResponse({ profile: true }),
			jsonResponse({ profile: false }),
			jsonResponse({ settings: true }),
			jsonResponse({ settings: false }),
			jsonResponse({ identity: true }),
			jsonResponse({ irn: true }),
			jsonResponse({ pairedDevices: [] }),
			jsonResponse({ name: "device" }),
		];
		const fetchMock = vi.fn<typeof fetch>(async () => {
			const response = responses.shift();
			if (response === undefined)
				throw new Error("test response queue exhausted");
			return response;
		});
		const client = createGoogleHealthClient({
			fetch: fetchMock,
			getAccessToken: async () => token,
		});

		await client.getDataPoint("users/me/dataTypes/steps/dataPoints/1");
		await client.createDataPoint("steps", point);
		await client.updateDataPoint(
			"users/me/dataTypes/steps/dataPoints/1",
			point,
		);
		await client.deleteDataPoints("steps", ["one", "two"]);
		await client.getProfile();
		await client.updateProfile({ profile: true } as never, "profile");
		await client.getSettings();
		await client.updateSettings({ settings: true } as never);
		await client.getIdentity();
		await client.getIrnProfile();
		await client.listPairedDevices();
		await client.getPairedDevice("users/me/pairedDevices/1");

		expect(fetchMock).toHaveBeenCalledTimes(12);
		expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual([
			"GET",
			"POST",
			"PATCH",
			"POST",
			"GET",
			"PATCH",
			"GET",
			"PATCH",
			"GET",
			"GET",
			"GET",
			"GET",
		]);
		const [, deleteInit] = fetchMock.mock.calls.at(3) ?? [];
		expect(JSON.parse(String(deleteInit?.body))).toEqual({
			names: ["one", "two"],
		});
		const [, createInit] = fetchMock.mock.calls.at(1) ?? [];
		expect(createInit?.headers).toEqual({
			Authorization: "Bearer access-token",
			"Content-Type": "application/json",
		});
	});

	it("surfaces useful typed errors and tolerates an invalid error body", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response("not json", { status: 503 }))
			.mockResolvedValueOnce(
				jsonResponse(
					{ error: { message: "busy", status: "UNAVAILABLE" } },
					429,
				),
			);
		const client = createGoogleHealthClient({
			fetch: fetchMock,
			getAccessToken: async () => token,
		});

		await expect(client.getProfile()).rejects.toMatchObject({
			status: 503,
			googleStatus: undefined,
			path: "users/me/profile",
		});
		try {
			await client.getProfile();
		} catch (error) {
			expect(error).toBeInstanceOf(GoogleHealthApiError);
			expect((error as GoogleHealthApiError).retryable).toBe(true);
			expect((error as GoogleHealthApiError).message).toContain("busy");
		}
	});
});
