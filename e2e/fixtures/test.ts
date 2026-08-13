import { randomUUID } from "node:crypto";
import { type Client, createClient } from "@libsql/client";
import { type BrowserContext, test as base } from "@playwright/test";
import { type E2EProfile, profileForProject } from "../profiles";
import { assertLocalOrigin } from "./guards";

export interface Account {
	id: string;
	email: string;
	name: string;
	password: string;
	sessionCookie: string;
	cookieName: string;
}

interface SignUpOptions {
	name?: string;
	email?: string;
	password?: string;
}

interface ApiKeyResult {
	key: string;
	keyId: string | undefined;
}

function responseString(body: Record<string, unknown>, field: "key" | "keyId") {
	if (typeof body[field] === "string") return body[field];
	if (typeof body.data !== "object" || body.data === null) return undefined;
	const value = (body.data as Record<string, unknown>)[field];
	return typeof value === "string" ? value : undefined;
}

interface Fixtures {
	profile: E2EProfile;
	googleIsolation: undefined;
	signUp: (options?: SignUpOptions) => Promise<Account>;
	addSession: (context: BrowserContext, account: Account) => Promise<void>;
	apiKey: (account: Account) => Promise<ApiKeyResult>;
}

interface WorkerFixtures {
	db: Client;
}

function cookieFromResponse(response: {
	headersArray(): Array<{ name: string; value: string }>;
}): { name: string; value: string } {
	const header = response
		.headersArray()
		.find(({ name }) => name.toLowerCase() === "set-cookie");
	if (header === undefined) {
		throw new Error("The auth response did not issue a session cookie.");
	}
	const separator = header.value.indexOf(";");
	const pair =
		separator === -1 ? header.value : header.value.slice(0, separator);
	const equals = pair.indexOf("=");
	if (equals <= 0)
		throw new Error("The auth response returned an invalid cookie.");
	return { name: pair.slice(0, equals), value: pair.slice(equals + 1) };
}

let nextIpSequence = 0;

function ipFor(testInfo: { workerIndex: number }): string {
	nextIpSequence += 1;
	const high = Math.floor(nextIpSequence / 254) % 254;
	const low = nextIpSequence % 254;
	return `10.${(testInfo.workerIndex % 250) + 1}.${high + 1}.${low + 1}`;
}

export const test = base.extend<Fixtures, WorkerFixtures>({
	profile: async ({ browserName: _browserName }, use, testInfo) => {
		await use(profileForProject(testInfo.project.name));
	},

	googleIsolation: [
		async ({ context, profile }, use) => {
			if (profile.local) {
				// Google One Tap is an external credential surface. Keep the local
				// suite deterministic and prevent test credentials from reaching it.
				await context.route("https://accounts.google.com/**", async (route) => {
					await route.fulfill({
						contentType: "application/javascript",
						body: `window.google={accounts:{id:{initialize(){},prompt(){},renderButton(){},disableAutoSelect(){},preventSilentAccess(){return Promise.resolve();}}}};`,
					});
				});
			}
			await use(undefined);
		},
		{ auto: true },
	],

	db: [
		async ({ browserName: _browserName }, use, workerInfo) => {
			const profile = profileForProject(workerInfo.project.name);
			assertLocalOrigin(profile.baseURL);
			if (profile.databaseUrl === undefined) {
				throw new Error(
					"The production profile cannot expose a database fixture.",
				);
			}
			const client = createClient({ url: profile.databaseUrl });
			await client.execute("PRAGMA busy_timeout = 5000");
			try {
				await use(client);
			} finally {
				client.close();
			}
		},
		{ scope: "worker" },
	],

	signUp: async ({ profile, request }, use, testInfo) => {
		assertLocalOrigin(profile.baseURL);
		let counter = 0;
		await use(async (options = {}) => {
			counter += 1;
			const password = options.password ?? "password12345";
			const name = options.name ?? `E2E User ${counter}`;
			const email =
				options.email ??
				`e2e-${testInfo.project.name}-${testInfo.workerIndex}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
			const ip = ipFor(testInfo);
			const response = await request.post("/api/auth/sign-up/email", {
				headers: {
					Origin: profile.baseURL,
					"x-forwarded-for": ip,
				},
				data: { name, email, password },
			});
			if (!response.ok()) {
				throw new Error(
					`E2E sign-up failed with HTTP ${response.status()}: ${await response.text()}`,
				);
			}
			const body = (await response.json()) as {
				user?: { id?: unknown };
			};
			if (typeof body.user?.id !== "string") {
				throw new Error("The auth response did not include a user id.");
			}
			const cookie = cookieFromResponse(response);
			return {
				id: body.user.id,
				email,
				name,
				password,
				sessionCookie: cookie.value,
				cookieName: cookie.name,
			};
		});
	},

	addSession: async ({ profile }, use) => {
		assertLocalOrigin(profile.baseURL);
		await use(async (context, account) => {
			await context.addCookies([
				{
					name: account.cookieName,
					value: account.sessionCookie,
					domain: new URL(profile.baseURL).hostname,
					path: "/",
					httpOnly: true,
					sameSite: "Lax",
				},
			]);
		});
	},

	apiKey: async ({ profile, request }, use, testInfo) => {
		assertLocalOrigin(profile.baseURL);
		await use(async (account) => {
			const response = await request.post("/api/auth/api-key/create", {
				headers: {
					Origin: profile.baseURL,
					Cookie: `${account.cookieName}=${account.sessionCookie}`,
					"x-forwarded-for": ipFor(testInfo),
				},
				data: { name: "e2e" },
			});
			if (!response.ok()) {
				throw new Error(
					`E2E API-key issue failed with HTTP ${response.status()}: ${await response.text()}`,
				);
			}
			const body = (await response.json()) as Record<string, unknown>;
			const key = responseString(body, "key");
			if (key === undefined) {
				throw new Error(
					`The API-key response did not include plaintext: ${JSON.stringify(body)}`,
				);
			}
			const keyId = responseString(body, "keyId");
			return { key, keyId };
		});
	},
});

// biome-ignore lint/performance/noBarrelFile: E2E specs share Playwright's expect with the fixtures.
export { expect } from "@playwright/test";

export function sessionCookieHeader(account: Account): string {
	return `${account.cookieName}=${account.sessionCookie}`;
}
