import { CheckIcon } from "@heroicons/react/20/solid";
import { Link } from "@tanstack/react-router";
import { PLANS, type Plan } from "../lib/plans";

/**
 * The two plans.
 *
 * Tailwind Plus's two-tier layout, recoloured to this app's theme tokens for
 * the same reason as the feature grid: the stock indigo-and-gray would read as
 * a different site bolted onto the page, and its `dark:` variants never fire
 * because nothing puts `.dark` on the document.
 *
 * The decorative blur keeps the shape but takes the logo's own blue-to-red
 * gradient rather than the stock pink and purple, so the one piece of colour on
 * the page that is not a theme token is at least the brand's.
 *
 * Both calls to action lead to sign-in. There is no checkout yet — see
 * `plans.ts`, where the terms live — so sending someone to a payment page that
 * does not exist would be the worse lie.
 */

/** The gradient blob's outline. Straight from Tailwind Plus; it is decorative. */
const BLOB_CLIP_PATH =
	"polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)";

export function Pricing() {
	return (
		// `isolate` keeps the blur behind this section only, and the id is what
		// the rest of the site can link to.
		<section
			className="relative isolate px-6 py-20 sm:py-28 lg:px-8"
			id="pricing"
		>
			<div
				aria-hidden="true"
				className="absolute inset-x-0 -top-3 -z-10 transform-gpu overflow-hidden px-36 blur-3xl"
			>
				<div
					className="mx-auto aspect-1155/678 w-[72rem] bg-linear-to-tr from-[#3185FF] to-[#FB423F] opacity-20"
					style={{ clipPath: BLOB_CLIP_PATH }}
				/>
			</div>

			<div className="mx-auto max-w-3xl text-center">
				<h2 className="text-base/7 font-semibold text-primary">Pricing</h2>
				<p className="mt-2 text-4xl font-bold tracking-tight text-balance sm:text-5xl">
					Free to connect. Pay only for the past.
				</p>
			</div>

			<p className="mx-auto mt-6 max-w-2xl text-center text-lg text-pretty text-muted-foreground">
				Reading today's data costs nothing and always will. Pro exists for the
				questions that need more history than the free window holds.
			</p>

			<div className="mx-auto mt-16 grid max-w-lg grid-cols-1 items-center gap-y-6 sm:mt-20 sm:gap-y-0 lg:max-w-4xl lg:grid-cols-2">
				{PLANS.map((plan, index) => (
					<PlanCard key={plan.id} plan={plan} index={index} />
				))}
			</div>
		</section>
	);
}

/**
 * One plan.
 *
 * The featured card is drawn on the foreground colour so it reads as raised
 * without needing a badge, which means the text inside it has to flip to the
 * background colour — hence the pair of ternaries rather than one.
 *
 * `index` decides which corners are rounded: the two cards meet edge to edge
 * from the `sm` breakpoint up, so only the outer corners are curved.
 */
function PlanCard({ plan, index }: { plan: Plan; index: number }) {
	const { featured } = plan;

	const corners = featured
		? ""
		: index === 0
			? "rounded-t-3xl sm:rounded-b-none lg:rounded-tr-none lg:rounded-bl-3xl"
			: "sm:rounded-t-none lg:rounded-tr-3xl lg:rounded-bl-none";

	return (
		<div
			className={`rounded-3xl p-8 ring-1 sm:p-10 ${corners} ${
				featured
					? "relative bg-foreground shadow-2xl ring-foreground"
					: "bg-card/60 ring-border sm:mx-8 lg:mx-0"
			}`}
		>
			<h3
				className={`text-base/7 font-semibold ${
					featured ? "text-background" : "text-primary"
				}`}
				id={plan.id}
			>
				{plan.name}
			</h3>

			<p className="mt-4 flex items-baseline gap-x-2">
				<span
					className={`text-5xl font-semibold tracking-tight ${
						featured ? "text-background" : ""
					}`}
				>
					{plan.price}
				</span>
				{plan.period !== null && (
					<span
						className={`text-base ${
							featured ? "text-background/70" : "text-muted-foreground"
						}`}
					>
						/{plan.period}
					</span>
				)}
			</p>

			{/* The second billing period, under the headline rather than beside it:
			    two prices on one line reads as a range, which is the one thing this
			    is not. */}
			{plan.altPrice !== null && (
				<p
					className={`mt-2 text-sm ${
						featured ? "text-background/70" : "text-muted-foreground"
					}`}
				>
					or {plan.altPrice.amount}/{plan.altPrice.period} —{" "}
					{plan.altPrice.note}
				</p>
			)}

			<p
				className={`mt-6 text-base/7 ${
					featured ? "text-background/80" : "text-muted-foreground"
				}`}
			>
				{plan.description}
			</p>

			<ul
				className={`mt-8 flex flex-col gap-3 text-sm/6 sm:mt-10 ${
					featured ? "text-background/80" : "text-muted-foreground"
				}`}
			>
				{plan.features.map((feature) => (
					<li className="flex gap-x-3" key={feature}>
						<CheckIcon
							aria-hidden="true"
							className={`h-6 w-5 flex-none ${
								featured ? "text-background" : "text-primary"
							}`}
						/>
						{feature}
					</li>
				))}
			</ul>

			{/* `aria-describedby` ties the button to its plan name, so a screen
			    reader announcing it out of context does not read four identically
			    labelled links. */}
			<Link
				aria-describedby={plan.id}
				className={`mt-8 block rounded-md px-3.5 py-2.5 text-center text-sm font-semibold transition-opacity hover:opacity-90 sm:mt-10 ${
					featured
						? "bg-primary text-primary-foreground"
						: "bg-secondary text-secondary-foreground ring-1 ring-border"
				}`}
				search={{ redirect: undefined }}
				to="/login"
			>
				{plan.cta}
			</Link>
		</div>
	);
}
