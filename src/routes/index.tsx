import { Link, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const { session } = Route.useRouteContext()

  return (
    <div className="p-8">
      <h1 className="text-4xl font-bold">Welcome to TanStack Start</h1>
      <p className="mt-4 text-lg">
        Edit <code>src/routes/index.tsx</code> to get started.
      </p>

      <p className="mt-4 text-lg">
        {session ? (
          <>
            Signed in as <strong>{session.user.email}</strong> —{' '}
            <Link className="underline" to="/dashboard">
              Dashboard
            </Link>
          </>
        ) : (
          <Link
            className="underline"
            to="/login"
            search={{ redirect: undefined }}
          >
            Sign in
          </Link>
        )}
      </p>
    </div>
  )
}
