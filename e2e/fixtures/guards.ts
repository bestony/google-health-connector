import type { Locator } from "@playwright/test";

export function assertLocalOrigin(baseURL: string): void {
	const hostname = new URL(baseURL).hostname;
	if (hostname !== "127.0.0.1" && hostname !== "localhost") {
		throw new Error(
			`Mutating E2E fixtures are local-only; refusing origin ${baseURL}.`,
		);
	}
}

/** Wait until React has attached event props to an SSR-rendered control. */
export async function waitForReactControl(locator: Locator): Promise<void> {
	await locator.waitFor({ state: "visible" });
	await locator.evaluate((element) => {
		return new Promise<void>((resolve) => {
			function ready() {
				if (
					Object.keys(element).some((key) => key.startsWith("__reactProps$"))
				) {
					resolve();
					return;
				}
				requestAnimationFrame(ready);
			}
			ready();
		});
	});
}
