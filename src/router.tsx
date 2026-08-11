import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { AppErrorPage } from "./components/app-error-page";
import { getContext } from "./integrations/tanstack-query/root-provider";
import { parseAppSearch, stringifyAppSearch } from "./lib/router-search";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const context = getContext();

	const router = createTanStackRouter({
		routeTree,
		context,
		parseSearch: parseAppSearch,
		stringifySearch: stringifyAppSearch,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		defaultErrorComponent: () => <AppErrorPage kind="error" />,
		defaultNotFoundComponent: () => <AppErrorPage kind="not-found" />,
	});

	setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient });

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
