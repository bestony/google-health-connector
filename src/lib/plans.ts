/**
 * What each plan includes.
 *
 * The landing page states these facts twice — once as a feature claim, once as
 * a pricing row — so they live here rather than in either component. A page
 * that promises 90 days in one section and 30 in another is the kind of thing
 * nobody notices until a user quotes it back.
 *
 * Nothing enforces any of this yet: there is no billing, and no plan column on
 * the user. These are the terms being advertised, and whatever implements them
 * later should read them from here.
 *
 * This module is pure data. Keep it free of imports so both the browser bundle
 * and the server can use it.
 */

/** How far back the free tier can read. Pro has no window. */
export const FREE_HISTORY_DAYS = 90;

/**
 * What the paid tier costs, in dollars, per period.
 *
 * Numbers rather than the formatted strings the page renders, because the
 * saving the annual price advertises is the *relationship* between these two —
 * writing "58%" out by hand is how a page ends up claiming a discount that the
 * prices stopped adding up to.
 */
const PRO_AMOUNT_USD = {
	year: 9.99,
	month: 1.99,
} as const;

/** `9.99` -> `"$9.99"`. Both prices happen to have two decimals; keep it so. */
function usd(amount: number): string {
	return `$${amount.toFixed(2)}`;
}

/**
 * The headline price: what Pro costs for a year.
 *
 * Annual leads because it is the one this app would rather sell. A single
 * charge a year outlives fewer expired cards than twelve, and a payment
 * processor's fixed per-transaction fee is a far larger slice of $1.99 than of
 * $9.99 — the difference between the two plans is mostly fees, not margin.
 */
export const PRO_PRICE = {
	/** Formatted for display, currency included. */
	amount: usd(PRO_AMOUNT_USD.year),
	/** The period `amount` covers, as it reads after a slash. */
	period: "year",
} as const;

/**
 * The month-to-month alternative.
 *
 * It exists so a visitor unwilling to commit to a year has something to click
 * other than the back button, and it is deliberately priced so that annual is
 * the obvious choice for anyone who intends to stay.
 */
export const PRO_MONTHLY_PRICE = {
	amount: usd(PRO_AMOUNT_USD.month),
	period: "month",
} as const;

/** How much cheaper a year of Pro is than twelve months of it, in percent. */
export const PRO_ANNUAL_SAVING_PERCENT = Math.round(
	(1 - PRO_AMOUNT_USD.year / (PRO_AMOUNT_USD.month * 12)) * 100,
);

/**
 * AI clients named on the landing page as known to work.
 *
 * MCP is an open protocol and anything speaking it can connect, so this is a
 * list of examples rather than a whitelist — which is why the copy around it
 * says "and anything else that speaks MCP".
 */
export const MCP_CLIENTS: readonly string[] = ["Claude", "Grok", "ChatGPT"];

/** A second way to buy the same plan, shown under the headline price. */
export interface AltPrice {
	amount: string;
	period: string;
	/** Why the headline price is the better one, in a few words. */
	note: string;
}

export interface Plan {
	id: string;
	name: string;
	/** Formatted price, or `null` for free. */
	price: string | null;
	period: string | null;
	/** The other billing period on offer, or `null` when there is only one. */
	altPrice: AltPrice | null;
	description: string;
	features: readonly string[];
	/** The one plan drawn as the recommendation. */
	featured: boolean;
	cta: string;
}

export const PLANS: readonly Plan[] = [
	{
		id: "plan-free",
		name: "Free",
		price: "$0",
		period: null,
		altPrice: null,
		description:
			"Everything you need to let an assistant read your health data. No card, no trial clock.",
		features: [
			"Live readings from Google Health",
			`${FREE_HISTORY_DAYS} days of history`,
			"MCP access with OAuth or one API key",
			`Works with ${MCP_CLIENTS.join(", ")} and any MCP client`,
		],
		featured: false,
		cta: "Start free",
	},
	{
		id: "plan-pro",
		name: "Pro",
		price: PRO_PRICE.amount,
		period: PRO_PRICE.period,
		altPrice: {
			amount: PRO_MONTHLY_PRICE.amount,
			period: PRO_MONTHLY_PRICE.period,
			note: `annual saves ${PRO_ANNUAL_SAVING_PERCENT}%`,
		},
		description:
			"For questions that span more than a season — trends, comparisons, and everything before the last three months.",
		features: [
			"Everything in Free",
			"Full history, with no time limit",
			"Year-over-year and long-range trends",
			"Priority support",
		],
		featured: true,
		cta: "Get Pro",
	},
];
