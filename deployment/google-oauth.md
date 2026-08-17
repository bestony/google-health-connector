# Google OAuth callback

Google sign-in and the later Google Health grant both return to **one**
callback URL. Register that URL in Google Cloud Console before you set
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

A wrong callback never reaches this application. Google rejects the request
with `redirect_uri_mismatch`.

## What to register

The callback is derived from `BETTER_AUTH_URL`. It is always this path:

```text
<BETTER_AUTH_URL>/api/auth/callback/google
```

Register two values on the same **Web application** OAuth client:

| Google Cloud field | Value |
| ------------------ | ----- |
| Authorized redirect URI | `<BETTER_AUTH_URL>/api/auth/callback/google` |
| Authorized JavaScript origin | `<BETTER_AUTH_URL>` |

`BETTER_AUTH_URL` must be the **public origin** that users open in the
browser:

- Include the scheme (`https://` in production).
- Include the host.
- Include the port only when it is not the default (`443` for `https`,
  `80` for `http`).
- Do not add a path.
- Do not add a trailing slash.

Do not register the internal listen address. If Compose or Nitro binds
`0.0.0.0:3000` behind a reverse proxy, still register the public HTTPS
origin.

## Worked examples

| Public origin (`BETTER_AUTH_URL`) | Authorized redirect URI | Authorized JavaScript origin |
| --------------------------------- | ----------------------- | ---------------------------- |
| `https://health.example.com` | `https://health.example.com/api/auth/callback/google` | `https://health.example.com` |
| `https://my-app.vercel.app` | `https://my-app.vercel.app/api/auth/callback/google` | `https://my-app.vercel.app` |
| `http://localhost:3000` | `http://localhost:3000/api/auth/callback/google` | `http://localhost:3000` |

Localhost and the production origin are different clients from Google's
point of view. Add both rows to the same OAuth client, or create one
client per environment. A production client that only lists localhost
will fail as soon as a user opens the deployed site.

## Console steps

1. Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials).
2. Create or edit an **OAuth client ID** of type **Web application**.
3. Under **Authorized JavaScript origins**, add `BETTER_AUTH_URL` with no
   path.
4. Under **Authorized redirect URIs**, add
   `<BETTER_AUTH_URL>/api/auth/callback/google`.
5. Save the client. Copy the client ID and client secret into
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the deployment.

Set both variables together. Leave both empty to keep email/password
sign-in and hide the Google button. Setting only one of them is a
configuration error.

The JavaScript origin is required for Google One Tap on `/login`. A
missing origin does not produce a visible error; the prompt never
appears.

## Google Health is the same callback

The dashboard **Authorize** button asks for extra Google Health scopes
after the user is already signed in. That grant still returns to
`/api/auth/callback/google`. Do not register `/dashboard`, `/consent`, or
`/api/auth/link-social` as a redirect URI.

The Google Cloud project also needs:

- the **Google Health API** enabled under APIs & Services → Library
- every scope in `src/lib/google-health-scopes.ts` declared on the OAuth
  consent screen

Google answers with `invalid_scope` for a scope the consent screen does
not declare. Most of these scopes are sensitive or restricted. Until
Google verifies the project, only accounts listed as test users can
grant them.

## Common mistakes

- **Trailing slash on `BETTER_AUTH_URL`.** Use
  `https://health.example.com`, not `https://health.example.com/`.
- **Wrong scheme.** `http://` and `https://` are different origins.
  Production must use the scheme the reverse proxy actually serves.
- **Wrong host.** `www.example.com` and `example.com` are different.
  Register the host users type, which must match `BETTER_AUTH_URL`.
- **Missing `/google` suffix.** The path is
  `/api/auth/callback/google`, not `/api/auth/callback`.
- **Internal port instead of the public origin.** Register
  `https://health.example.com/...`, not `http://127.0.0.1:3000/...`,
  when TLS terminates in front of the container.
- **Preview or extra origins not listed.** Each distinct origin needs
  its own redirect URI. A Vercel preview such as
  `https://<project>-git-<branch>-<team>.vercel.app` will fail until you
  add that origin, or until you pin previews to a custom domain that is
  already registered.

If Google returns `redirect_uri_mismatch`, compare the URL in the error
with `BETTER_AUTH_URL` byte for byte: scheme, host, port, and path.

Local development uses the same rules with
`BETTER_AUTH_URL=http://localhost:3000`. The developer walkthrough is in
[`../development.md#google-sign-in`](../development.md#google-sign-in).
