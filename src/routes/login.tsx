import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "../lib/auth-client";
import { SESSION_QUERY_KEY } from "../lib/session";

/**
 * Demo sign-in / sign-up screen for the email + password provider.
 *
 * It is intentionally plain: it exists to exercise the better-auth wiring end
 * to end. Replace or restyle it freely — nothing else depends on this file.
 */

type Mode = "signin" | "signup";

/**
 * Only same-origin, absolute paths are accepted. Anything else (`//evil.com`,
 * `https://evil.com`) is dropped so the redirect cannot be used as an open
 * redirect after a successful login.
 */
function sanitizeRedirect(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	if (!value.startsWith("/") || value.startsWith("//")) return undefined;
	return value;
}

export const Route = createFileRoute("/login")({
	validateSearch: (search: Record<string, unknown>) => ({
		redirect: sanitizeRedirect(search.redirect),
	}),
	beforeLoad: ({ context, search }) => {
		if (context.session) {
			throw redirect({ to: search.redirect ?? "/dashboard" });
		}
	},
	component: LoginPage,
});

function LoginPage() {
	const router = useRouter();
	const { queryClient } = Route.useRouteContext();
	const search = Route.useSearch();

	const [mode, setMode] = useState<Mode>("signin");
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		setPending(true);

		const result =
			mode === "signin"
				? await authClient.signIn.email({ email, password })
				: await authClient.signUp.email({ name, email, password });

		setPending(false);

		if (result.error) {
			setError(result.error.message ?? "Authentication failed.");
			return;
		}

		// The session cookie changed, so drop the cached session and let the
		// router re-run `beforeLoad` with the new one.
		await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
		await router.invalidate();
		await router.navigate({ to: search.redirect ?? "/dashboard" });
	}

	return (
		<div className="mx-auto max-w-sm p-8">
			<h1 className="text-2xl font-bold">
				{mode === "signin" ? "Sign in" : "Create an account"}
			</h1>

			<form className="mt-6 flex flex-col gap-3" onSubmit={onSubmit}>
				{mode === "signup" && (
					<label className="flex flex-col gap-1 text-sm">
						Name
						<input
							className="rounded border px-3 py-2"
							value={name}
							onChange={(event) => setName(event.target.value)}
							required
						/>
					</label>
				)}

				<label className="flex flex-col gap-1 text-sm">
					Email
					<input
						className="rounded border px-3 py-2"
						type="email"
						autoComplete="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						required
					/>
				</label>

				<label className="flex flex-col gap-1 text-sm">
					Password
					<input
						className="rounded border px-3 py-2"
						type="password"
						autoComplete={
							mode === "signin" ? "current-password" : "new-password"
						}
						minLength={8}
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						required
					/>
				</label>

				{error && <p className="text-sm text-red-600">{error}</p>}

				<button
					className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
					type="submit"
					disabled={pending}
				>
					{pending ? "Working…" : mode === "signin" ? "Sign in" : "Sign up"}
				</button>
			</form>

			<button
				className="mt-4 text-sm underline"
				type="button"
				onClick={() => {
					setMode(mode === "signin" ? "signup" : "signin");
					setError(null);
				}}
			>
				{mode === "signin"
					? "Need an account? Sign up"
					: "Already registered? Sign in"}
			</button>
		</div>
	);
}
