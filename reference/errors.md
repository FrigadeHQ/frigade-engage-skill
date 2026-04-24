# Error Reference

How the skill recovers from Frigade API failures and from its own composite-operation partial failures. Read this when any Frigade call returns a non-2xx response, when a GraphQL body contains `errors`, or when a multi-step recipe (flow-create + code-wiring) aborts mid-sequence.

Companion refs: `graphql-schema.md` (GraphQL surface), `rest-endpoints.md` (REST surface + canonical error shape at lines 679–698), `sdk-react.md` (SDK surface).

## GraphQL vs REST error shape (critical context)

**GraphQL responses are globally wrapped** by the server (`formatError` in `backend-app/src/app.module.ts`, lines 78–83):

```ts
formatError: (error) => {
  console.log('Error in GraphQL', error);
  return {
    message: 'An unexpected error occurred in graphql',
  };
},
```

On the wire this looks like:

```json
{ "data": null, "errors": [{ "message": "An unexpected error occurred in graphql" }] }
```

**Detailed error semantics do not surface over GraphQL.** Validation failures, not-founds, ownership-mismatches, and uncaught exceptions all collapse into the same opaque string. **Never parse the `errors[].message` text for recovery hints** — there is no reliable information there. Instead, fall back to:

1. Re-fetch the state you were trying to mutate/read (is the object actually there? did it already change?).
2. Inspect the request shape against `graphql-schema.md` (argument names, types, required vs optional, `skip`/`take <= 50`).
3. Retry once — the wrapper also hides transient 5xx-class errors.
4. Surface the raw wrapped response to the user with a note that "GraphQL hides error detail; check backend-app logs / Sentry for the real stack" and offer to retry or switch to REST if an equivalent exists.

**REST responses are NOT wrapped.** They pass through with Nest + Fastify's default shape:

```json
{
  "statusCode": 422,
  "message": ["<validation detail 1>", "<validation detail 2>"],
  "error": "Unprocessable Entity"
}
```

- `statusCode` is the HTTP status repeated in the body.
- `message` is either a string (manual `throw new BadRequestException('foreignUserId is required')`) or an array of strings (one per failed field, emitted by `class-validator` when a DTO fails validation). Claude must branch on `Array.isArray(body.message)` before displaying.
- `error` is the HTTP reason phrase ("Bad Request", "Not Found", etc.).

REST is the debuggable surface. Prefer it for any operation that exists on both surfaces (flow CRUD, user upserts, etc. — see `rest-endpoints.md` for the split).

## A note on the actual vocabulary used in backend-app

As of commit `d245b4fd`, the only exception types thrown inside `backend-app/src` are `BadRequestException` (20 throws), `NotFoundException` (11 throws), and `UnauthorizedException` (9 throws), plus the raw `HttpException(..., HttpStatus.TOO_MANY_REQUESTS)` from the rate-limit guard. There is **no** `ConflictException`, `ForbiddenException`, or `UnprocessableEntityException` thrown explicitly. That means:

- **409 Conflict** from the skill's perspective happens only as a 400 with a specific message (e.g. slug collisions are a `BadRequestException('...already exists...')`, not a real 409).
- **403 Forbidden** happens only indirectly: both `PrivateAuthGuard` and `PublicApiGuard` return `false` from `canActivate` on any auth failure, which Nest translates to a `ForbiddenException` with status 403 and body `{ statusCode: 403, message: "Forbidden resource", error: "Forbidden" }`. An explicit `throw new UnauthorizedException('...')` from inside a service (e.g. `rules.service.ts`, `actors.service.ts`, `webhook-subscriptions.service.ts`) DOES produce a 401 with the real message, but those paths require the request to have already passed the guard. In practice, a bad or missing key shows up as 403, not 401.
- **422 Unprocessable Entity** happens only if a controller opts into the global `ValidationPipe` (not all do). `main.ts` does not call `app.useGlobalPipes(new ValidationPipe())`, so DTO validation runs per-controller via `@UsePipes(new ValidationPipe())` where present, and emits a 400 (not 422) by default. If a real 422 ever surfaces, treat it structurally the same as a 400 array-message.

The sections below describe the status codes the skill will encounter **on the wire**, not the Nest exception class name. That's the layer that matters.

## API error classes

### 401 Unauthorized

**Shape (REST):**

```json
{ "statusCode": 401, "message": "Unauthorized", "error": "Unauthorized" }
```
or, for the handful of services that throw `UnauthorizedException('OrganizationId does not match')` / `UnauthorizedException('Invalid Flow Ids')` after the guard has already admitted the request:
```json
{ "statusCode": 401, "message": "OrganizationId does not match", "error": "Unauthorized" }
```

**Cause:** A service-level ownership check rejected the request AFTER the guard let it through. This is usually a cross-environment leak (the skill called a dev endpoint with a prod key or vice versa, and the resource being accessed belongs to the other environment's organization).

**Skill response:**
1. Halt the operation.
2. Check `.frigade/project.json` for the expected environment on this repo; compare against which env var was read (`FRIGADE_API_KEY_SECRET` vs `FRIGADE_API_KEY_SECRET_PROD`).
3. Tell the user: "The key I used (`FRIGADE_API_KEY_SECRET...`) appears to belong to a different environment than the resource `<id>`. Swap to `FRIGADE_API_KEY_SECRET_PROD` (or vice versa) and retry."
4. DO NOT retry automatically with a different key — the skill must not guess across environments.

### 403 Forbidden

**Shape (REST):**

```json
{ "statusCode": 403, "message": "Forbidden resource", "error": "Forbidden" }
```

**Cause:** `PrivateAuthGuard` (or `PublicApiGuard` on public routes) returned `false`. This covers:
- No `Authorization` header at all.
- Header present but not a Bearer token (the guard parses `Bearer ...` or `Basic ...`; anything else is dropped).
- Token is a Clerk session token that didn't authenticate (dashboard path; not applicable to skill calls).
- Token is an API key that doesn't exist in the database (revoked, typo'd, or from a different Frigade account).
- For `PrivateAuthGuard` specifically: the key exists but has `type = PUBLIC` — i.e. the skill accidentally used a `api_public_*` key on a private-only endpoint.

**Skill response:**
1. Halt the operation.
2. Tell the user which env var was used (`FRIGADE_API_KEY_SECRET` or `FRIGADE_API_KEY_SECRET_PROD`) and which endpoint it was sent to.
3. Link them to the dashboard: `https://app.frigade.com/settings/api`.
4. Suggest a verification curl that does NOT require Clerk (`GET /v1/me` isn't skill-reachable — it requires a Clerk session):
   ```bash
   curl -sS -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" https://api3.frigade.com/v1/apiKeys
   ```
   A 200 confirms the key is valid and private-scoped; another 403 confirms the key is revoked or public. `GET /v1/flows` is an acceptable fallback if `/v1/apiKeys` errors for other reasons.
5. Check the key prefix: `api_private_*` for private endpoints, `api_public_*` for the `/v1/public/*` endpoints only. If the mismatch is a prefix issue, tell the user which env var they need to populate.
6. DO NOT retry automatically.

### 404 Not Found

**Shape (REST):**

```json
{ "statusCode": 404, "message": "Flow not found", "error": "Not Found" }
```
or, from the `NotFoundInterceptor` tripping on a GET that returned `null`:
```json
{ "statusCode": 404, "message": "Not Found", "error": "Not Found" }
```

**Cause:** The resource (flow, user, user-group, rule, etc.) doesn't exist for the caller's organization. Common sub-causes:
- Slug typo or an id from the wrong environment (see 401 — sometimes surfaces as 404 instead of 401 depending on whether the ownership check or the lookup runs first).
- The flow was deleted, archived, or replaced (a new version of the flow was activated and archived the old one).
- The skill is using a stale id from a previous session.

**Skill response:**
1. Do NOT treat as fatal. 404 is routinely expected during list/diff operations.
2. For a single-resource fetch: offer to list nearest matches. Call `GET /v1/flows?limit=500` and fuzzy-match the slug/name/id the user asked for; present the top 3 matches with their slugs and let the user pick.
3. For a targeted update (`PUT /v1/flows/:id`): re-check the slug → id mapping. If the id has changed (common after activating a draft — the active flow's id increments), suggest the new id.
4. If the user is certain the resource exists, have them check the dashboard at `https://app.frigade.com/flows` against the env they believe they're in.
5. DO NOT retry automatically.

### 409 Conflict (synthetic — not a real 409)

**Shape:** Not a real 409. In practice this arrives as a 400 with a message that names the duplicate:

```json
{ "statusCode": 400, "message": "A flow with slug 'welcome-announcement' already exists", "error": "Bad Request" }
```
(exact wording depends on the service; backend-app emits human messages, not error codes.)

**Cause:** Slug collision on create — the skill tried to `POST /v1/flows` with a slug already taken in this organization.

**Skill response:**
1. Before any create, run an idempotency check: `GET /v1/flows/<slug>`. If it returns 200, the flow exists — switch from create to update (`PUT /v1/flows/:id`) or prompt the user "A flow named `<slug>` already exists. Use the existing one, update it, or pick a new name?"
2. If the collision is discovered only by the failing POST, propose an alternative slug (`<slug>-v2`, `<slug>-<short-uuid>`) and await user confirmation before retrying. Do NOT auto-retry with a new slug — the user should name their own content.
3. Consider a pre-flight slug-availability check at the top of any create recipe to avoid this class of error entirely.

### 422 Unprocessable Entity (rare — usually surfaces as 400)

**Shape:** Matches the 400 shape when it does fire; `class-validator` emits an array:

```json
{
  "statusCode": 400,
  "message": [
    "name should not be empty",
    "type must be one of the following values: FORM, CHECKLIST, TOUR, ANNOUNCEMENT, BANNER"
  ],
  "error": "Bad Request"
}
```

**Cause:** DTO validation failed. Each entry in the `message` array is one failed field, with the field name at the start of the string (class-validator's default format: `<field> <constraint message>`).

**Skill response:**
1. Parse each entry. Extract the leading field name (split on first whitespace) and the constraint.
2. Cross-reference against `rest-endpoints.md` to confirm the field's expected shape.
3. Attempt **one** auto-correction: commonly this is a missing `type`, an uppercase-vs-lowercase enum, a stringified-number where a number is required, or a JSON string where an object was expected (`data` and `targetingLogic` on `POST /v1/flows` are both `string` fields containing stringified JSON — do not send objects).
4. Show the user a unified diff of the request body before retrying: `— rejected\n+ corrected`.
5. Retry once. If still failing, stop and hand the raw validation messages to the user.

### 429 Too Many Requests

**Shape:**

```json
{
  "statusCode": 429,
  "message": "Your account has used its maximum allowed MAUs. Contact Frigade support to upgrade."
}
```

(No `error` field on the HttpException variant — the rate-limit guard uses `throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS)` directly, so the body is whatever Nest serializes from an `HttpException` with a string payload.)

**Cause:** This is **not** a per-second rate limit. It's an **account-level MAU cap** — the organization has exceeded its monthly active user quota. The check lives in `backend-app/src/middlewares/rate-limit.guard.ts` and only guards the public/user-facing endpoints (`POST /v1/public/users`, `POST /v1/public/userFlowStates`, `PUT /v1/flows/:id`, plus select user-flow-state writes). GraphQL and other REST writes are not rate-limited by this guard.

**Skill response:**
1. No exponential backoff — retrying will not help, the cap is monthly.
2. Halt the operation.
3. Tell the user: "Your Frigade account has hit its MAU cap for the month; no amount of retrying will fix this. Go to `https://app.frigade.com/settings/billing` or email Frigade support."
4. Do NOT write this error into any retry loop.

(Note: if a future Frigade build adds a real per-second limiter with a `Retry-After` header, update this section to do `n=3` exponential backoff, base 500ms. For now there is none.)

### 5xx / network / unknown

**Shape (REST, 500):**

```json
{ "statusCode": 500, "message": "Internal server error" }
```

The real stack is NOT echoed — it's only in backend-app logs / Sentry (REST doesn't wrap errors the way GraphQL does, but 500s still don't echo their cause in the response body).

**Cause:** Uncaught service exception (e.g. activating a flow with no draft, some data-integrity violation, a Prisma query that panicked). Also covers 502 / 503 / 504 from the infra layer (load balancer timeouts, cluster restart).

**Skill response:**
1. Retry once after a 1-second pause.
2. On second failure, halt. Tell the user: "The Frigade API returned an unexpected server error; the detail isn't in the response. If this reproduces, forward the timestamp (`<ISO>`) to Frigade support along with the request payload (stored in `.frigade/skill.log`)." Include the dashboard link for the affected resource if known.
3. Do NOT continue composite operations past a 5xx — surface the partial-failure report (see Composite operation failures below).

**Network-class errors** (DNS failure, connection refused, TLS error, `fetch: ENOTFOUND`): treat the same as 5xx — one retry, then halt. Distinguish only in the user-facing message ("the Frigade API returned 500" vs "I couldn't reach api3.frigade.com — check your network").

### GraphQL: opaque wrapped server error

**Shape:**

```json
{ "data": null, "errors": [{ "message": "An unexpected error occurred in graphql" }] }
```

(The HTTP response is almost always 200 even when `errors` is present — GraphQL convention. Do not branch on the HTTP status for GraphQL calls; branch on the presence of `errors` in the body. The server will still occasionally emit a plain 400/401/403 at the HTTP layer before the GraphQL resolver runs — treat those by their REST rules above.)

**Cause:** Any error below the `formatError` wrapper. Could be a bad argument type, a nonexistent field, a resolver-level exception, or an infra 5xx. You cannot tell from the response.

**Skill response:**
1. Retry once — the wrapper hides transient errors, and GraphQL requests over the same Apollo-compatible HTTP path are idempotent for queries and (usually) idempotent for mutations.
2. If the query still fails, walk through `graphql-schema.md`:
   - Is the operation name spelled right? (Queries/mutations are camelCase, types are PascalCase.)
   - Are all required args present and correctly typed? (e.g. `Float!` for numeric flow ids, `ID!` for string ids, `take <= 50`.)
   - Are you selecting only fields documented in the type? Apollo rejects unknown fields, but the rejection surfaces through `formatError` as the same opaque message.
3. Check if a REST equivalent exists (see `rest-endpoints.md` — most reads have both surfaces; writes are REST-only for flows and user-facing endpoints). If so, switch to REST for the same operation and surface the real error message to the user.
4. Surface the raw wrapped response to the user verbatim; do NOT pretend to know the cause. Suggested phrasing: "GraphQL returned its opaque wrapper error and the real cause is hidden server-side. I've logged the request to `.frigade/skill.log`. Want me to try the REST equivalent?"

### Introspection failures (production)

**Shape:**

```json
{ "data": null, "errors": [{ "message": "GraphQL introspection has been disabled, but the requested query contained the field \"__schema\"." }] }
```
or the wrapped `"An unexpected error occurred in graphql"` if `formatError` catches it first.

**Cause:** `GraphQLModule.forRoot` sets `introspection: process.env.NODE_ENV !== 'production'` — introspection is only enabled on the dev cluster. Running `{ __schema { ... } }` against `https://api3.frigade.com/graphql` will always fail in prod.

**Skill response:**
1. Do not attempt introspection against prod as a recovery step.
2. The committed `graphql-schema.md` is the authoritative schema snapshot — use it as the source of truth when the skill needs to reason about the surface.
3. If the skill really needs a live schema check (e.g. to diagnose drift), and a dev API key is available, retry introspection against `https://ei.frigade.com/graphql` (the dev endpoint — see `graphql-schema.md` header). Otherwise, accept the snapshot.

## Composite operation failures

A "composite operation" is a recipe with multiple sequential side-effects. The canonical example is `create-announcement`:

1. Create server-side flow via `POST /v1/flows` (Frigade state).
2. Install `@frigade/react` via the host package manager (codebase state).
3. Wire `<FrigadeProvider>` into `app/providers.tsx` or equivalent (codebase state).
4. Mount `<Announcement flowId="...">` at the user's chosen anchor (codebase state).
5. Optionally start the dev server for visual confirmation (host process state — never without user confirmation).

Failures partway through this sequence need deliberate handling.

### Partial failure rules

1. **Code-edit batches are atomic.** If any file-edit in the batch fails (file locked, write error, user interrupt), revert all file edits in this batch. Keep a before-state snapshot (file contents keyed by absolute path) before the batch starts and restore on failure. This applies ONLY to edits inside a single atomic unit (e.g. install + provider-wire + anchor-mount is one unit for a single flow).
2. **Upstream Frigade state is preserved.** Do NOT auto-delete server-side flows as a recovery step. If steps 1–2 succeeded and step 3 failed, the flow on Frigade's side stays. Report it as "created server-side, but code wiring failed at step N." Let the user decide whether to delete or reuse.
3. **Idempotency on re-run.** Before step 1 (create), check whether the flow already exists (by slug — `GET /v1/flows/<slug>`). If it does, offer update-instead-of-create or adopt-the-existing, do not create a duplicate. This is the primary defense against users re-running a recipe after a partial failure.
4. **Never run destructive Frigade operations as silent recovery.** No `DELETE /v1/flows/:id`, no `PUT /v1/flows/:id` with `active: false` without explicit user confirmation. Composite-failure recovery is always interactive.
5. **Dev server lifecycle is out of scope for auto-recovery.** If step 5 failed (e.g. port collision), do not kill processes. Report and hand back to the user.

### Reporting partial failures

Output template (concrete, not abstract — Claude should produce output that looks like this):

```
Completed:
✅ Created flow: welcome-announcement (id: flow_abc123) — see https://app.frigade.com/flows/welcome-announcement
✅ Installed @frigade/react@^2.9.4 via pnpm

Failed at step 3 of 5:
❌ Could not insert <Frigade.Provider> into app/providers.tsx
   Reason: file was modified externally between my read and my write (mtime changed).
   Rolled back: no edits to app/providers.tsx were persisted. package.json / pnpm-lock.yaml still reflect the install (not rolled back — install is cheap to keep).

Upstream state preserved:
- The flow welcome-announcement exists in Frigade dev. No action has been taken on it.

Recovery options:
  1. Retry code wiring only (I'll re-read the current file state and resume from step 3; the flow won't be re-created).
  2. Delete the created flow via DELETE /v1/flows/flow_abc123 and start the recipe from scratch (I will confirm before deleting).
  3. Leave things as they are — the flow exists server-side but isn't mounted in your app. You can mount it manually later.

Which would you like?
```

Required fields in any partial-failure report:
- A ✅ list of what was persisted (server-side creates, package installs, files written) with identifiers and dashboard links where applicable.
- A ❌ line with the step number, the operation, the failure reason, and what was rolled back vs preserved.
- An "Upstream state preserved" paragraph naming any Frigade-side objects created so the user knows they exist.
- A numbered "Recovery options" list — always at least 3 options, with the "leave things as they are" option present.
- A prompt asking the user to pick. Never auto-recover.

### Resumption semantics

If the user picks "retry code wiring only":
- Re-run the idempotency check at step 1 (the flow should still exist; confirm by slug and id).
- Skip any steps whose completion marker is already present (flow exists, package installed — `require.resolve('@frigade/react')` succeeds).
- Re-read file state from disk before re-attempting edits; do NOT trust a cached before-state.

## Schema drift

If a GraphQL response's data shape doesn't match what `graphql-schema.md` documents (missing field, renamed field, changed type):

1. **In a dev environment**, try `{ __schema { types { name fields { name type { name } } } } }` against the dev GraphQL endpoint to refresh understanding. If the introspection call itself fails with the wrapped error, treat drift as unrecoverable and follow the prod path.
2. **In production**, introspection is disabled. Treat the committed `graphql-schema.md` as authoritative. If a response genuinely has a new field the snapshot doesn't document, log it and continue using only the documented fields.
3. **Report drift to the user** with a one-line note: "Response shape didn't match the committed snapshot; see `.frigade/skill.log` for the raw body. I'll continue using only fields from `graphql-schema.md`." Include a suggestion to open an issue on the skill repo so the snapshot can be regenerated.

## Logging

Every error — API-class or composite-partial — gets written to `.frigade/skill.log` in the host repo. The log is append-only JSON lines; one line per event. Required fields:

- `timestamp` — ISO 8601 UTC.
- `op` — operation name (e.g. `create-announcement:step-3`, `rest.POST /v1/flows`, `graphql.CreateRule`).
- `request.method`, `request.url` (REST) or `request.query` (GraphQL).
- `request.headers` — **redacted.** Strip `authorization` entirely before writing (replace value with `"<REDACTED>"`). Do not log any `api_private_*` or `api_public_*` token under any circumstance. Consider also redacting any custom headers that might contain an auth token downstream.
- `request.body` — include for non-GET requests. If the body itself contains a token (rare), redact that token value.
- `response.status` — HTTP status.
- `response.body` — the raw response body, parsed if JSON.
- `recovery` — string describing the recovery action taken ("retried once, succeeded", "halted, user prompt shown", "auto-corrected 'type' → 'ANNOUNCEMENT' and retried", "rolled back 3 file edits", etc.).

The log file is gitignored by default — the skill ensures `.frigade/` is in the host repo's `.gitignore` on first run. Never commit this file.

## Quick reference table

| HTTP / signal | Likely cause | Skill action |
|---|---|---|
| 401 | Service-level ownership mismatch (cross-env resource) | Halt; explain env mismatch; do not retry |
| 403 | Guard rejection (missing/bad/revoked key, or public key on private endpoint) | Halt; direct user to dashboard + verify with `GET /v1/apiKeys` |
| 404 | Stale id, wrong env, deleted resource | Offer nearest-match list (from `GET /v1/flows?limit=500`) |
| 409 (as 400 with "already exists" message) | Slug collision on create | Offer update-instead-of-create; propose alternate slug |
| 400 with array message | DTO validation failed | Parse fields; attempt one auto-correction; show diff; retry once |
| 422 | Rare — same handling as 400 array | Same as 400 array |
| 429 | Monthly MAU cap exceeded (NOT rate limit) | Halt; no retry; direct user to billing |
| 5xx / network | Transient or uncaught server error | Retry once; then halt with log reference |
| GraphQL `errors[]` with wrapped message | Any below `formatError` | Retry once; validate request shape; offer REST equivalent |
| GraphQL introspection error in prod | `introspection: false` | Use committed snapshot; don't retry introspection |
| Composite step N failed | Code edit or Frigade call failed mid-recipe | Rollback code batch; preserve Frigade state; present 3+ recovery options |

## Cross-reference

- REST error shape canonical: `skill/reference/rest-endpoints.md` § "Error format" (lines 679–698).
