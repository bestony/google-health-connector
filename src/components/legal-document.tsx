import type { ReactNode } from "react";
import { LEGAL, LEGAL_CONTACT_MAILTO } from "../lib/legal";

/**
 * Shared shell and typography for `/privacy` and `/terms`.
 *
 * Sections arrive as data rather than as JSX children so the table of contents
 * can be derived from the same array the body is rendered from: a heading
 * cannot go missing from the index, and the numbering cannot drift away from
 * it. Both documents are long enough that a reviewer — Google's or a user's —
 * needs that index to find one clause.
 *
 * The small typography components below exist so the two content files read as
 * prose with markup around it, instead of as walls of Tailwind class strings.
 * Tailwind's typography plugin is not installed, so `prose` is not available.
 */

export interface LegalSection {
	/**
	 * Stable anchor id. Deep links to these end up quoted in support email and
	 * in Google's review correspondence, so treat a rename as a breaking change.
	 */
	id: string;
	title: string;
	body: ReactNode;
}

interface LegalDocumentProps {
	title: string;
	/** Leading paragraphs, rendered above the table of contents. */
	intro: ReactNode;
	sections: readonly LegalSection[];
}

export function LegalDocument({ title, intro, sections }: LegalDocumentProps) {
	return (
		<main className="mx-auto max-w-3xl px-6 py-12 sm:px-8">
			<header>
				<h1 className="text-3xl font-bold tracking-tight">{title}</h1>

				<dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
					<div className="flex gap-2">
						<dt>Effective</dt>
						<dd>{LEGAL.effectiveDate}</dd>
					</div>
					<div className="flex gap-2">
						<dt>Last updated</dt>
						<dd>{LEGAL.lastUpdated}</dd>
					</div>
				</dl>

				<div className="mt-6 flex flex-col gap-4 leading-7">{intro}</div>
			</header>

			<nav
				aria-label="Table of contents"
				className="mt-10 rounded-lg border border-border bg-card p-5 shadow-xs"
			>
				<h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					Contents
				</h2>
				<ol className="mt-3 grid gap-y-1 gap-x-6 sm:grid-cols-2">
					{sections.map((section, index) => (
						<li className="text-sm" key={section.id}>
							<a
								className="text-primary hover:underline"
								href={`#${section.id}`}
							>
								{index + 1}. {section.title}
							</a>
						</li>
					))}
				</ol>
			</nav>

			<div className="mt-10 flex flex-col gap-10">
				{sections.map((section, index) => (
					// `scroll-mt` keeps the heading clear of the viewport edge when the
					// table of contents jumps to it.
					<section className="scroll-mt-6" id={section.id} key={section.id}>
						<h2 className="text-xl font-semibold tracking-tight">
							{index + 1}. {section.title}
						</h2>
						<div className="mt-3 flex flex-col gap-4 leading-7">
							{section.body}
						</div>
					</section>
				))}
			</div>
		</main>
	);
}

/** A body paragraph. */
export function Para({ children }: { children: ReactNode }) {
	return <p>{children}</p>;
}

/** A heading below a numbered section. */
export function Subheading({ children }: { children: ReactNode }) {
	return <h3 className="mt-2 font-semibold">{children}</h3>;
}

/** A bulleted list. Children are plain `<li>` elements. */
export function Bullets({ children }: { children: ReactNode }) {
	return <ul className="flex list-disc flex-col gap-2 pl-5">{children}</ul>;
}

/** A numbered list, for steps a user is meant to follow in order. */
export function Steps({ children }: { children: ReactNode }) {
	return <ol className="flex list-decimal flex-col gap-2 pl-5">{children}</ol>;
}

/**
 * A boxed passage.
 *
 * `warning` is for the two statements a reader must not skim past: that this is
 * not medical advice, and the limits on what happens to health data.
 */
export function Callout({
	children,
	tone = "neutral",
}: {
	children: ReactNode;
	tone?: "neutral" | "warning";
}) {
	return (
		<div
			className={`rounded-md border px-4 py-3 leading-7 ${
				tone === "warning"
					? "border-destructive/40 bg-destructive/5"
					: "border-border bg-muted"
			}`}
		>
			{children}
		</div>
	);
}

/** A link off-site. Always opens in a new tab so the document is not lost. */
export function ExternalLink({
	href,
	children,
}: {
	href: string;
	children: ReactNode;
}) {
	return (
		<a
			className="text-primary underline underline-offset-2"
			href={href}
			rel="noopener noreferrer"
			target="_blank"
		>
			{children}
		</a>
	);
}

/**
 * Builds the cross-reference component for one document.
 *
 * Section numbers are derived from the document's own `sections` array at
 * render time, not written by hand, so inserting or reordering a section
 * renumbers every reference to it instead of quietly making them wrong — which
 * is exactly the kind of error a reader only finds by following the reference
 * and landing on the wrong clause.
 *
 * `getSections` is a getter rather than the array itself because the references
 * live *inside* the section bodies, so the array does not exist yet at the point
 * this is wired up.
 *
 * An id with no matching section throws rather than rendering "section 0": SSR
 * runs during the build, so a stale reference fails the build instead of
 * shipping.
 */
export function createSectionRef(getSections: () => readonly LegalSection[]) {
	return function SectionRef({ id }: { id: string }) {
		const index = getSections().findIndex((section) => section.id === id);

		if (index < 0) {
			throw new Error(`Cross-reference to unknown legal section: "${id}"`);
		}

		return (
			<a className="text-primary underline underline-offset-2" href={`#${id}`}>
				section {index + 1}
			</a>
		);
	};
}

/** The contact address, as a `mailto:` link. */
export function ContactEmail() {
	return (
		<a
			className="text-primary underline underline-offset-2"
			href={LEGAL_CONTACT_MAILTO}
		>
			{LEGAL.contactEmail}
		</a>
	);
}
