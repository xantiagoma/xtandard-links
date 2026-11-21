# Auth

Who is making this request? Authentication is a pluggable provider on the admin panel; three ship,
and the contract is one function if you need your own. (Whether they _may_ do it is authorization —
`docs/AUTHORIZATION.md`. Analytics viewer tokens are a third, separate lane — see
[Viewer tokens](#viewer-tokens) below and ADR 0009.)

The redirect plane (`createRedirectHandler`) is anonymous by design and never consults these
providers; only the admin panel (`createFetchHandler` and every adapter's `linksPanel`) does.

## The contract

```ts
interface Principal {
  id: string;
  email?: string;
  name?: string;
  roles?: string[];
  metadata?: unknown;
}

interface AuthProvider {
  authenticate(request: Request): Promise<Principal | null>;
  /** Optional: the 401 to send when `authenticate` returns null (e.g. a Basic challenge). */
  challenge?(request: Request): Response | undefined;
}
```

Return a `Principal` to admit, or `null` for "not authenticated" (the panel answers `challenge()` or a
plain `401`). A provider that **throws** is a backend failure (IdP down) and yields a `500`, never a
misleading `401`. The principal's `id`/`email`/`name` are recorded as the actor on every audit entry
and as `createdBy` on new links.

## Bundled providers

### `@xtandard/links/auth/none` (default)

```ts
import { noAuth, ANONYMOUS_PRINCIPAL } from "@xtandard/links/auth/none";
```

Everyone is `{ id: "anonymous" }`. The default so the quickstart works — put anything
internet-reachable behind real auth.

### `@xtandard/links/auth/basic`

```ts
import { basicAuth, hashPassword } from "@xtandard/links/auth/basic";

const auth = basicAuth({
  realm: "Links Admin",
  users: [{ username: "ops", passwordHash: await hashPassword("s3cret"), roles: ["admin"] }],
});
```

HTTP Basic with scrypt password hashes (`scrypt$<salt>$<hash>`, never plaintext at rest),
constant-time verification, and a `WWW-Authenticate` challenge so browsers prompt. A custom
`passwordVerifier(username, password)` can delegate to your user store; a plain `password` field
exists for development only. Pair with `AUTH_MODE=basic` + `AUTH_USERNAME` / `AUTH_PASSWORD_HASH` on
the CLI and the standalone image. `AUTH_MODE` accepts only `none` (the default, also when empty) or
`basic`; any other value (e.g. a typo like `basci`) is rejected at startup rather than falling back
to an open panel.

Basic auth is also the simplest way to give a backend a **conversion-tracking key**: add a
`{ username: "tracker", passwordHash, roles: ["tracker"] }` user and grant that role only
`conversion:track` (see `docs/AUTHORIZATION.md`).

### `@xtandard/links/auth/delegated`

```ts
import { delegatedAuth } from "@xtandard/links/auth/delegated";

const auth = delegatedAuth({
  async authenticate(request) {
    const session = await myApp.getSession(request); // your cookie / JWT / IdP
    return session ? { id: session.userId, email: session.email, roles: session.roles } : null;
  },
  challenge: () => new Response(null, { status: 302, headers: { location: "/login" } }),
});
```

The integration point for the auth your app already has — the panel never sees credentials, only
your resolved principal. Put tenant membership in `metadata` for a delegated authorization policy.

## Wiring

```ts
linksPanel({
  storage,
  auth, // AuthProvider
  authorization, // see docs/AUTHORIZATION.md
  portal: { secret: process.env.LINKS_VIEWER_SECRET! }, // optional third lane
});
```

Order of evaluation per request:

1. Public routes skip auth: `/healthcheck`, `/api/openapi.json` and the static UI assets.
   `/config` runs auth but never rejects — it reports `authenticated` / `principal` / `viewer` so
   the UI can decide what to show.
2. With `portal` configured, an `Authorization: Bearer lvt_…` token wins. Valid → a viewer
   principal; invalid or expired → `401 { code: "VIEWER_TOKEN" }`. It **never** falls back to your
   `auth` provider.
3. Otherwise your `auth` provider runs.

## Viewer tokens

Analytics viewer tokens (ADR 0009) let you embed per-tenant analytics in your own product without
giving customers panel accounts:

```ts
import { createViewerToken } from "@xtandard/links";

// In a session-guarded route of your app:
const token = await createViewerToken(process.env.LINKS_VIEWER_SECRET!, {
  tenant: session.workspaceId,
  links: undefined, // or a list of link ids to restrict further
  allow: undefined, // default ["analytics:read", "link:read"]
  expiresIn: "1h", // default "1d"
});
```

Wire format: `lvt_<base64url(JSON {tenant, links?, allow?, exp})>.<base64url(HMAC-SHA256)>` —
stateless, verified with Web Crypto only. Admins can also mint them through
`POST /api/tenants/:tenant/viewer-tokens` (action `viewer-token:create`; a minter can only delegate
actions it holds itself). Revoking before expiry means rotating the secret. How viewers are scoped
is in `docs/AUTHORIZATION.md`.
