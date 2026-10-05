import {
	BoltIcon,
	ClockIcon,
	PuzzlePieceIcon,
} from "@heroicons/react/20/solid";
import type { ComponentType, SVGProps } from "react";
import { HISTORY_LIMIT_DAYS } from "../lib/health-history";

/**
 * What the product does, in three claims.
 *
 * The history window is read from the MCP tools' own limit rather than written
 * out, so the page cannot promise a window that a read does not honour.
 *
 * The layout is Tailwind Plus's three-column feature grid, recoloured to this
 * app's theme tokens: the stock markup hard-codes indigo and gray, which would
 * sit next to a blue hero looking like a different site, and its `dark:`
 * variants are dead weight here — nothing ever puts `.dark` on the document.
 */

/**
 * AI clients named on the landing page as known to work.
 *
 * MCP is an open protocol and anything speaking it can connect, so this is a
 * list of examples rather than a whitelist — which is why the copy around it
 * says "and anything else that speaks MCP".
 */
const MCP_CLIENTS: readonly string[] = ["Claude", "Grok", "ChatGPT"];

interface Feature {
	name: string;
	description: string;
	icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const FEATURES: readonly Feature[] = [
	{
		name: "Live readings",
		description:
			"Ask about today. Steps, heart rate, last night's sleep — every answer is read from Google Health at the moment your assistant asks, not from a copy that went stale overnight.",
		icon: BoltIcon,
	},
	{
		name: "History you can question",
		description: `Look back across months, not just this morning. Your assistant can read the last ${HISTORY_LIMIT_DAYS} days, so "how has my resting heart rate moved this season" is a question you can actually ask.`,
		icon: ClockIcon,
	},
	{
		name: "Works with the AI you already use",
		description: `An open Model Context Protocol endpoint, not a plugin for one vendor. ${MCP_CLIENTS.join(", ")} and anything else that speaks MCP connect with a URL and a key.`,
		icon: PuzzlePieceIcon,
	},
];

export function Features() {
	return (
		<section className="py-20 sm:py-28">
			<div className="mx-auto max-w-5xl px-6 sm:px-8">
				<div className="mx-auto max-w-2xl text-center">
					<h2 className="text-base/7 font-semibold text-primary">
						Your data, on demand
					</h2>
					<p className="mt-2 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
						Everything an assistant needs to answer for you
					</p>
					<p className="mt-6 text-lg/8 text-pretty text-muted-foreground">
						Connect Google Health once. After that your assistant reads what it
						needs, when it needs it — and you can take the permission back at
						any time.
					</p>
				</div>

				<dl className="mx-auto mt-16 grid max-w-xl grid-cols-1 gap-x-8 gap-y-12 sm:mt-20 lg:max-w-none lg:grid-cols-3">
					{FEATURES.map((feature) => (
						<div className="flex flex-col" key={feature.name}>
							<dt className="flex items-center gap-x-3 text-base/7 font-semibold">
								<feature.icon
									aria-hidden="true"
									className="size-5 flex-none text-primary"
								/>
								{feature.name}
							</dt>
							<dd className="mt-4 flex flex-auto flex-col text-base/7 text-muted-foreground">
								<p className="flex-auto">{feature.description}</p>
							</dd>
						</div>
					))}
				</dl>
			</div>
		</section>
	);
}
