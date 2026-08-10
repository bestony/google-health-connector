Welcome to your new TanStack Start app!

# Getting Started

To run this application:

```bash
pnpm install
pnpm dev
```

# Building For Production

To build this application for production:

```bash
pnpm build
```

## Authentication

Authentication is handled by [better-auth](https://better-auth.com), persisted through
[Drizzle ORM](https://orm.drizzle.team) on libSQL/SQLite.

| File                          | Role                                                                      |
| ----------------------------- | ------------------------------------------------------------------------- |
| `src/lib/auth.server.ts`      | better-auth instance (`getAuth()`), Drizzle adapter, providers — server only |
| `src/lib/auth-client.ts`      | Browser client (`signIn`, `signUp`, `signOut`, `useSession`)               |
| `src/lib/one-tap-client.ts`   | Google One Tap client, built once the client ID is known + FedCM sign-out  |
| `src/lib/session.ts`          | `fetchSession` server function + `sessionQueryOptions()` cache entry       |
| `src/lib/auth-providers.ts`   | Tells the browser which social providers are configured, and their client ID |
| `src/lib/auth-errors.ts`      | Maps better-auth's OAuth error codes and messages to user-facing copy      |
| `src/components/google-one-tap.tsx` | Mounts the One Tap prompt and turns its result into a soft navigation |
| `src/lib/google-health-scopes.ts` | Catalog of the Google Health scopes the app can ask for — pure data     |
| `src/lib/google-health-access.ts` | `fetchGoogleHealthAccess` server function: which scopes were granted   |
| `src/lib/google-health-client.ts` | Browser entry point that starts the authorization round trip           |
| `src/lib/google-health-token.server.ts` | Access tokens for calling Google, refreshed by better-auth       |
| `src/components/google-health-authorization.tsx` | The authorize button and permission list on `/dashboard` |
| `src/routes/api/auth/$.ts`    | Mounts every better-auth endpoint under `/api/auth/*`                      |
| `src/db/auth-schema.ts`       | Generated Drizzle tables: `user`, `session`, `account`, `verification`     |
| `src/db/client.server.ts`     | Lazy Drizzle/libSQL client (`getDb()`)                                     |

Copy `.env.example` to `.env` and fill it in (`openssl rand -base64 32` for the secret),
then create the tables:

```bash
pnpm test:pushdb   # drizzle-kit push — fastest for local development

# or, when you want a reviewable migration history:
pnpm db:generate   # write a migration to ./drizzle
pnpm db:migrate    # apply it
```

The root route resolves the session in `beforeLoad` and puts it on the router context, so
any route can guard itself without an extra round trip:

```tsx
export const Route = createFileRoute('/dashboard')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
  },
})
```

`/login` and `/dashboard` are working demos of that flow — restyle or delete them freely.

After changing the better-auth config (new plugins, `additionalFields`, …), regenerate the
tables with `pnpm auth:generate`. The generator still emits legacy `relations()` helpers
that drizzle-orm 1.x removed; delete those blocks from `src/db/auth-schema.ts` afterwards.

### Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an
   **OAuth client ID** of type **Web application**.
2. Add the callback as an *Authorized redirect URI*. It is always
   `<BETTER_AUTH_URL>/api/auth/callback/google`, so it must match the origin the app is
   served from — `http://localhost:3000/api/auth/callback/google` locally. A mismatch here
   is what produces Google's `redirect_uri_mismatch` error.
3. Add `<BETTER_AUTH_URL>` itself — no path — as an *Authorized JavaScript origin*
   (`http://localhost:3000` locally). Only One Tap needs this, and it fails *silently*
   without it.
4. Put the credentials in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

No migration is needed: OAuth identities live in the existing `account` table. Leaving both
variables empty is supported — the provider is simply not registered and `/login` hides the
Google button (`src/lib/auth-providers.ts` is what the page asks).

Two choices worth knowing about, both in `src/lib/auth.server.ts`:

- `accessType: "offline"` asks Google for a refresh token, because this app is meant to keep
  reading the user's health data after the browser session ends. Google only issues one when
  the user actually passes the consent screen — on the first grant, and whenever the
  requested scopes change. Use `prompt: "select_account consent"` if a refresh token must be
  guaranteed on *every* sign-in. Tokens are stored encrypted (`encryptOAuthTokens`), keyed off
  `BETTER_AUTH_SECRET`; rotating that secret forces every user to consent again.
- Account linking trusts Google's `email_verified` claim, but better-auth also requires the
  *existing local* account to be verified before it merges the two. This app has no email
  verification flow, so signing in with Google using an address that already has a password
  account fails with `account_not_linked` — the login page explains that. Extra Google scopes
  are requested after sign-in, not during it — see *Google Health authorization* below.

### Google One Tap

`/login` also shows Google's One Tap prompt, which signs a returning user in from the
overlay without ever leaving the page. It needs no extra credentials — the same
`GOOGLE_CLIENT_ID`, plus the *Authorized JavaScript origin* from step 3 above — and no
migration, because it writes the same `account` row the redirect flow does.

```
oneTap()                          server plugin  → POST /api/auth/one-tap/callback
oneTapClient({ clientId })        browser plugin → Google Identity Services
<GoogleOneTap clientId=… />       mounts the prompt on /login
```

Three things about the wiring are worth knowing:

- **The client ID is fetched, not bundled.** `oneTapClient()` wants it at construction time,
  so `src/lib/one-tap-client.ts` builds a *second* better-auth client on demand, once
  `fetchSocialProviders()` has returned the ID. The alternative — a `VITE_GOOGLE_CLIENT_ID`
  build constant — would freeze one environment's ID into the build and duplicate what is
  already in `.env`. Both clients share the session cookie, so nothing else changes.
- **Success is a soft navigation.** Passing `fetchOptions` suppresses better-auth's built-in
  `window.location` redirect, so the page invalidates the cached session and routes
  client-side, exactly like the email form.
- **Sign-out calls `preventSilentAccess()`.** The FedCM hook that normally does this lives on
  the One Tap client, not on the shared `authClient`, so `/dashboard` calls it explicitly.
  Skip it and the prompt on `/login` can hand the session straight back.

A prompt that never appears is the normal failure mode: Google suppresses it when the
visitor has no Google session, has dismissed it repeatedly, or when the browser blocks
federated sign-in — and the "Continue with Google" button below it is the fallback. The
reason is only ever visible in the browser console, at `debug` level:

```js
localStorage.setItem('app:logLevel', 'debug')   // then reload; see src/lib/logger-client.ts
```

### Google Health authorization

Signing in with Google grants `email`, `profile` and `openid` — nothing more. Reading or
writing health data is a *separate* consent, asked for from the **Google Health** card on
`/dashboard` once the user is signed in.

```
src/lib/google-health-scopes.ts        the 21 scopes, built from one prefix
src/lib/google-health-client.ts        POST /api/auth/link-social → redirect to Google
src/lib/google-health-access.ts        reads account.scope back → what was granted
src/lib/google-health-token.server.ts  access token for the actual API calls
```

The scopes cover twelve data types. Nine offer both read and write, three are read-only
(`irn`, `ecg`, `settings`), and each full scope is
`https://www.googleapis.com/auth/googlehealth.<type>.<readonly|writeonly>`:

| Data type | Read | Write |
| --------- | ---- | ----- |
| `activity_and_fitness` | ✓ | ✓ |
| `health_metrics_and_measurements` | ✓ | ✓ |
| `location` (workout GPS) | ✓ | ✓ |
| `nutrition` | ✓ | ✓ |
| `sleep` | ✓ | ✓ |
| `reproductive_health` | ✓ | ✓ |
| `logged_symptoms` | ✓ | ✓ |
| `mindfulness` | ✓ | ✓ |
| `profile` | ✓ | ✓ |
| `irn` (irregular rhythm notifications) | ✓ | — |
| `ecg` | ✓ | — |
| `settings` | ✓ | — |

Add a data type to `GOOGLE_HEALTH_DATA_TYPES` and the button, the consent request and the
permission list all pick it up; nothing else needs touching.

Before any of it works, the Google Cloud project needs the **Google Health API** enabled
and every scope above added to the **OAuth consent screen**. Google rejects an
authorization request containing a scope the consent screen does not declare, with
`invalid_scope`. Most of these are *sensitive* or *restricted* scopes, so a project that
has not been through Google's verification can only use them with accounts listed as test
users.

Four decisions are worth knowing about:

- **It links, it does not sign in.** The flow goes through `/link-social`, not
  `/sign-in/social`, because the user already has a session. Linking attaches the new grant
  to the existing `account` row — same refresh token, no second session — and it is the only
  better-auth endpoint that accepts extra `scopes`.
- **Authorization is incremental.** better-auth's Google provider always sends
  `include_granted_scopes=true`, so a later request never revokes an earlier grant. `account.scope`
  holds what *Google* returned, not what was asked for, which is why the card can report a
  permission the user unticked as not granted.
- **`prompt` is overridden to `consent`.** The provider-level `select_account` is wrong for a
  link: the account is already decided, and Google only issues a refresh token when the consent
  screen is actually shown. `src/lib/google-health-client.ts` rewrites the authorization URL
  before navigating, and adds `login_hint` so the right Google account is preselected — pick a
  different one and better-auth fails the callback with `email_doesn't_match`.
- **`/dashboard` is both the caller and the landing page.** Success returns to
  `/dashboard?health=granted`; a failure comes back to `/dashboard?error=<code>`, which
  `src/lib/auth-errors.ts` turns into readable copy.

Calling the API afterwards never touches the stored tokens directly — better-auth decrypts
the refresh token, renews the access token when it is close to expiry and writes the pair
back:

```ts
import { getGoogleHealthAccessToken } from '#/lib/google-health-token.server'
import { googleHealthScope } from '#/lib/google-health-scopes'

const { accessToken } = await getGoogleHealthAccessToken({
  requiredScopes: [googleHealthScope('sleep', 'read')],
})
```

It throws `GoogleHealthAuthorizationError` when there is no linked account, when the refresh
fails, or when a required scope was never granted — the error carries `missingScopes`, which
is exactly what the user has to be sent back through the consent screen for.

## Styling

This project uses [Tailwind CSS](https://tailwindcss.com/) for styling.

### Removing Tailwind CSS

If you prefer not to use Tailwind CSS:

1. Remove the demo pages in `src/routes/demo/`
2. Replace the Tailwind import in `src/styles.css` with your own styles
3. Remove `tailwindcss()` from the plugins array in `vite.config.ts`
4. Remove `@tailwindcss/vite` and `tailwindcss` from `package.json`

## Linting & Formatting

This project uses [Biome](https://biomejs.dev/) for linting and formatting. The following scripts are available:


```bash
pnpm lint
pnpm format
pnpm check
```


## Deploy with Nitro

This project uses Nitro as a generic server adapter, so it can run on any Node-compatible host.

```bash
npm run build
node dist/server/index.mjs
```

The build output is a self-contained Node server. To deploy, push the `dist/` directory to your host (Render, Fly.io, your own VPS, etc.) and run the server command above.

For host-specific presets (Vercel, Netlify, Cloudflare, AWS Lambda, etc.) and tuning, see https://v3.nitro.build/deploy.



## Routing

This project uses [TanStack Router](https://tanstack.com/router) with file-based routing. Routes are managed as files in `src/routes`.

### Adding A Route

To add a new route to your application just add a new file in the `./src/routes` directory.

TanStack will automatically generate the content of the route file for you.

Now that you have two routes you can use a `Link` component to navigate between them.

### Adding Links

To use SPA (Single Page Application) navigation you will need to import the `Link` component from `@tanstack/react-router`.

```tsx
import { Link } from "@tanstack/react-router";
```

Then anywhere in your JSX you can use it like so:

```tsx
<Link to="/about">About</Link>
```

This will create a link that will navigate to the `/about` route.

More information on the `Link` component can be found in the [Link documentation](https://tanstack.com/router/v1/docs/framework/react/api/router/linkComponent).

### Using A Layout

In the File Based Routing setup the layout is located in `src/routes/__root.tsx`. Anything you add to the root route will appear in all the routes. The route content will appear in the JSX where you render `{children}` in the `shellComponent`.

Here is an example layout that includes a header:

```tsx
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'My App' },
    ],
  }),
  shellComponent: ({ children }) => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <header>
          <nav>
            <Link to="/">Home</Link>
            <Link to="/about">About</Link>
          </nav>
        </header>
        {children}
        <Scripts />
      </body>
    </html>
  ),
})
```

More information on layouts can be found in the [Layouts documentation](https://tanstack.com/router/latest/docs/framework/react/guide/routing-concepts#layouts).

## Server Functions

TanStack Start provides server functions that allow you to write server-side code that seamlessly integrates with your client components.

```tsx
import { createServerFn } from '@tanstack/react-start'

const getServerTime = createServerFn({
  method: 'GET',
}).handler(async () => {
  return new Date().toISOString()
})

// Use in a component
function MyComponent() {
  const [time, setTime] = useState('')
  
  useEffect(() => {
    getServerTime().then(setTime)
  }, [])
  
  return <div>Server time: {time}</div>
}
```

## API Routes

You can create API routes by using the `server` property in your route definitions:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const Route = createFileRoute('/api/hello')({
  server: {
    handlers: {
      GET: () => json({ message: 'Hello, World!' }),
    },
  },
})
```

## Data Fetching

There are multiple ways to fetch data in your application. You can use TanStack Query to fetch data from a server. But you can also use the `loader` functionality built into TanStack Router to load the data for a route before it's rendered.

For example:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/people')({
  loader: async () => {
    const response = await fetch('https://swapi.dev/api/people')
    return response.json()
  },
  component: PeopleComponent,
})

function PeopleComponent() {
  const data = Route.useLoaderData()
  return (
    <ul>
      {data.results.map((person) => (
        <li key={person.name}>{person.name}</li>
      ))}
    </ul>
  )
}
```

Loaders simplify your data fetching logic dramatically. Check out more information in the [Loader documentation](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#loader-parameters).



# Learn More

You can learn more about all of the offerings from TanStack in the [TanStack documentation](https://tanstack.com).

For TanStack Start specific documentation, visit [TanStack Start](https://tanstack.com/start).
