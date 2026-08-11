import {
	ArrowLeftIcon,
	ArrowPathIcon,
	ExclamationTriangleIcon,
	HomeIcon,
	MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { Link, useRouter } from "@tanstack/react-router";
import { LEGAL } from "../lib/legal";

/** The two framework-level failure states rendered by the application shell. */
export type AppErrorKind = "not-found" | "error";

interface AppErrorPageProps {
	kind: AppErrorKind;
}

const COPY = {
	"not-found": {
		code: "404",
		eyebrow: "Page not found",
		title: "That page is not here",
		description:
			"The link may be out of date, or the address may have a small typo. Let’s get you back to your Google Health data.",
		icon: MagnifyingGlassIcon,
	},
	error: {
		code: "500",
		eyebrow: "Something went wrong",
		title: "We could not load this page",
		description:
			"The service hit an unexpected problem. Try again in a moment, or return to the home page while we catch up.",
		icon: ExclamationTriangleIcon,
	},
} as const;

/**
 * The application-owned fallback for unmatched routes and route failures.
 *
 * Keep this component independent of route loader data and session context:
 * TanStack Router can render it before a route finishes loading, including when
 * the root session check itself fails.
 */
export function AppErrorPage({ kind }: AppErrorPageProps) {
	const router = useRouter();
	const copy = COPY[kind];
	const StatusIcon = copy.icon;

	function goBack() {
		if (typeof window !== "undefined" && window.history.length > 1) {
			router.history.back();
			return;
		}

		void router.navigate({ to: "/" });
	}

	function retry() {
		void router.invalidate();
	}

	return (
		<main
			aria-labelledby="app-error-title"
			className="relative isolate flex min-h-[calc(100svh-8rem)] items-center overflow-hidden px-6 py-16 sm:px-8 sm:py-24"
			data-error-kind={kind}
		>
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 -z-10"
			>
				<div className="absolute left-1/2 top-1/2 size-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-3xl" />
				<div className="absolute left-[12%] top-[18%] size-2 rounded-full bg-primary/50" />
				<div className="absolute right-[16%] bottom-[20%] size-1.5 rounded-full bg-destructive/60" />
			</div>

			<div className="mx-auto w-full max-w-3xl">
				<section className="relative overflow-hidden rounded-3xl bg-card/95 p-8 text-center shadow-xl shadow-foreground/5 backdrop-blur sm:p-12">
					<div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
						<StatusIcon aria-hidden="true" className="size-7" />
					</div>

					<p className="mt-8 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
						{LEGAL.productName} · {copy.eyebrow}
					</p>
					<p className="mt-5 font-mono text-7xl font-semibold tracking-[-0.08em] text-foreground sm:text-8xl">
						{copy.code}
					</p>
					<h1
						className="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl"
						id="app-error-title"
					>
						{copy.title}
					</h1>
					<p className="mx-auto mt-5 max-w-xl text-base/7 text-pretty text-muted-foreground sm:text-lg/8">
						{copy.description}
					</p>

					<div className="mt-9 flex flex-col-reverse items-stretch justify-center gap-3 sm:flex-row sm:items-center">
						{kind === "error" ? (
							<button
								className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
								onClick={retry}
								type="button"
							>
								<ArrowPathIcon aria-hidden="true" className="size-4" />
								Try again
							</button>
						) : (
							<Link
								className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
								to="/"
							>
								<HomeIcon aria-hidden="true" className="size-4" />
								Go to home page
							</Link>
						)}

						{kind === "error" && (
							<Link
								className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
								to="/"
							>
								<HomeIcon aria-hidden="true" className="size-4" />
								Go to home page
							</Link>
						)}

						<button
							className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
							onClick={goBack}
							type="button"
						>
							<ArrowLeftIcon aria-hidden="true" className="size-4" />
							Go back
						</button>
					</div>
				</section>
			</div>
		</main>
	);
}
