import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
	useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import { LEGAL } from "../lib/legal";
import { sessionQueryOptions } from "../lib/session";
import appCss from "../styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
	// Resolve the better-auth session once per request and expose it on the
	// router context, so any route can guard on `context.session` without
	// issuing its own request. The query cache keeps this from re-fetching on
	// every client navigation.
	beforeLoad: async ({ context }) => {
		const session = await context.queryClient.ensureQueryData(
			sessionQueryOptions(),
		);
		return { session };
	},
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: LEGAL.appName,
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	// Only the booleans are selected, not the session or the whole location: the
	// header re-renders when the visitor signs in or out, or when they arrive at
	// or leave `/login`, and not on every other state change.
	const signedIn = Route.useRouteContext({
		select: (context) => context.session !== null,
	});
	const onLoginPage = useRouterState({
		select: (state) => state.location.pathname === "/login",
	});

	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			{/* The column layout is what keeps the footer — and with it the privacy
          policy link Google's review requires on the home page — pinned to the
          bottom on short pages instead of floating mid-screen. */}
			<body className="flex min-h-svh flex-col">
				<SiteHeader signedIn={signedIn} showAction={!onLoginPage} />
				<div className="flex-1">{children}</div>
				<SiteFooter />
				<TanStackDevtools
					config={{
						position: "bottom-right",
					}}
					plugins={[
						{
							name: "Tanstack Router",
							render: <TanStackRouterDevtoolsPanel />,
						},
						TanStackQueryDevtools,
					]}
				/>
				<Scripts />
			</body>
		</html>
	);
}
