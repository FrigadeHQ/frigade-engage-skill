# create-collection

**End-to-end create-a-collection recipe.** Takes the user's intent ("create a product-update collection and embed it in the app"), creates the collection in Frigade via the `createRule` GraphQL mutation, then installs `@frigade/react` if needed, wires the `<Frigade.Provider>`, and mounts `<Frigade.Collection>` in the host codebase. On partial failure, Frigade-side state is preserved and code-edit batches are rolled back atomically.

Note on naming: collections are called `Rule` in GraphQL; customer-facing language is always "collection".

Companion refs:
- `recipes/first-run-setup.md` — pre-condition state check.
- `reference/graphql-schema.md` §`createRule` — mutation signature and `ExternalizedRule` response shape.
- `reference/operations.md` — `createRule` safety row (dev: safe; prod: dangerous) and canonical confirmation prompt templates.
- `reference/sdk-react.md` §`<Frigade.Collection>` — component props and `<Frigade.Provider>` surface.
- `reference/next-app-router.md` / `reference/next-pages-router.md` — framework adapters with ready-to-paste snippets.
- `reference/errors.md` — GraphQL/REST failure handling and composite-failure reporting.

---

## Pre-conditions

1. **`first-run-setup.md` Section 1 passed.** The current working directory has `.frigade/project.json` (marker) and `.env.local` with at least `NEXT_PUBLIC_FRIGADE_API_KEY` + `FRIGADE_API_KEY_SECRET` that verify against the marker's `workspaceId`. If not, invoke `first-run-setup.md` first — it returns silently on success. Don't proceed until that returns.
2. **Dev private key available in env.** The shell that runs the `curl` in Step 3 has `FRIGADE_API_KEY_SECRET` exported (e.g. `set -a; source .env.local; set +a`). Never paste the raw key into a tool-call argument; always interpolate `$FRIGADE_API_KEY_SECRET` from the shell. For prod, swap to `$FRIGADE_API_KEY_SECRET_PROD`.
3. **Framework detection succeeds at Step 4.** If the host project is a framework the skill doesn't know how to wire (Vue, Svelte, Remix, Astro…), Step 4 stops the code-emission half and reports "collection is live in Frigade but not wired into this codebase" with a manual-setup link.

---

## Step 1 — Resolve parameters

Parse the triggering prompt. Fill these inputs, asking only for what's missing:

| Input | Type | Required | How to resolve |
|---|---|---|---|
| `name` | `string` | **yes** | Extract from the prompt quote (e.g. "'Product Updates'"). If absent, ask once: "What should the collection be called?" This is the dashboard-facing label. |
| `description` | `string` | no | Short human-readable description. Default to empty string (`""`) if the user didn't specify — `createRule` requires the argument (it is `String!`), but empty is valid. |
| `coolOffPeriod` | `Float` | no | Minimum time between two flows in this collection firing at the same user. Omit / send `null` to accept the server default. If the user said something like "one flow per day", translate to `coolOffPeriod: 1` + `coolOffUnit: "day"`. |
| `coolOffUnit` | `String` | no | `"hour"`, `"day"`, `"week"`, `"month"`. Must pair with `coolOffPeriod`; if one is set and the other isn't, ask for the missing half or drop both. |
| `flowIds` | `[Float!]` | no | Numeric flow ids to attach at creation time. **Default: omit.** If the user said "add flow X and flow Y", resolve each to its numeric id via `reference/graphql-schema.md` §`flows` or `recipes/list-flows.md`. Otherwise leave empty and let `recipes/add-flows-to-collection.md` (future task) handle attachment. |
| `environment` | `"dev" \| "prod"` | no | Default `dev`. If the user said "in prod", "production", or "live", set `prod` and apply the prod confirmation wrapper (see Step 2). |

**Slug is server-assigned.** Unlike `createFlow`, `createRule` does not accept a client-supplied slug — the server derives `slug` from `name` and returns it on the response. No collision check is needed up front; if the user wants a specific slug, we can't force it via this mutation (workaround: create, then `updateRules` to rename, if the dashboard allows slug overrides — see `reference/graphql-schema.md` §`updateRules`).

---

## Step 2 — Environment + confirmation gate

**Prod confirmation gate.** If `environment == "prod"`, per the `operations.md` `createRule` row (`safe` in dev, `dangerous` in prod), emit the canonical confirmation (verbatim from `operations.md` §"Collection create / update in prod"):

> About to create collection '<name>' in prod. Confirm? (y/n)

Wait for an explicit `y`/`yes`. Anything else aborts with no side effects. Dev skips this prompt — `createRule` is marked `safe` in dev per `operations.md`.

**Auth header selection.** `Authorization: Bearer $FRIGADE_API_KEY_SECRET` (dev) or `Authorization: Bearer $FRIGADE_API_KEY_SECRET_PROD` (prod). The `first-run-setup.md` Section 5 helper picks the right env var.

---

## Step 3 — Create the collection via GraphQL

**Endpoint:** `POST https://api3.frigade.com/graphql` (per `reference/graphql-schema.md` §`createRule`).

**Mutation signature** (from Task 1's smoke test against the live endpoint):

- `name: String!` — required, non-null.
- `description: String!` — required, non-null (empty string is valid).
- `coolOffPeriod: Float` — nullable.
- `coolOffUnit: String` — nullable.
- `flowIds: [Float!]` — nullable list of numeric flow ids to attach at creation.

**Curl template** (interpolate variables from shell vars; do not paste raw values into tool-call arguments):

```bash
curl -sS -X POST "https://api3.frigade.com/graphql" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation CreateCollection($name: String!, $description: String!, $coolOffPeriod: Float, $coolOffUnit: String) { createRule(name: $name, description: $description, coolOffPeriod: $coolOffPeriod, coolOffUnit: $coolOffUnit) { id slug name type } }",
    "variables": { "name": "<NAME>", "description": "<DESC or empty>", "coolOffPeriod": null, "coolOffUnit": null }
  }' \
  -w "\n---HTTP_STATUS:%{http_code}---\n"
```

If you need to attach flows at creation time, extend the mutation + variables to include `$flowIds: [Float!]` and pass an array of numeric ids; otherwise omit `flowIds` entirely (the argument is nullable).

**Body-building tip** (avoids shell-quoting bugs around embedded quotes in `name`):

```bash
BODY=$(jq -n \
  --arg name "$NAME" \
  --arg desc "$DESCRIPTION" \
  '{
    query: "mutation CreateCollection($name: String!, $description: String!, $coolOffPeriod: Float, $coolOffUnit: String) { createRule(name: $name, description: $description, coolOffPeriod: $coolOffPeriod, coolOffUnit: $coolOffUnit) { id slug name type } }",
    variables: { name: $name, description: $desc, coolOffPeriod: null, coolOffUnit: null }
  }')

curl -sS -X POST "https://api3.frigade.com/graphql" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  -w "\n---HTTP_STATUS:%{http_code}---\n"
```

### Handling the response (per `errors.md`)

GraphQL always returns `200` at the HTTP layer — check for `errors[]` in the JSON body to detect failures.

| Outcome | Action |
|---|---|
| `data.createRule` present, `errors` absent | Success. Extract `id` (string over the wire — GraphQL `ID` type; coerce to number with `Number(id)` if you need a numeric id for a subsequent `updateRules` / `deleteRule` / `syncRuleToProd` call). Extract `slug`, `name`, `type` (expect `CUSTOM` — `DEFAULT` is reserved for the workspace-default collection). Proceed to Step 4. |
| `errors[0].extensions.code == "UNAUTHENTICATED"` or HTTP `401` | Ownership/cross-env mismatch (per `errors.md` §401). Halt. Tell the user: "The key appears to belong to a different environment than the resource. Swap key and retry." Do NOT auto-retry with the other env var. |
| HTTP `403` | Bad/revoked/public key (per `errors.md` §403). Halt. Link to dashboard `https://app.frigade.com/settings/api`. Route user back to `first-run-setup.md` Section 2.7 verification curl. |
| `errors[]` with validation message (missing required field, wrong type) | Auto-correct one obvious case if possible (e.g. `coolOffPeriod` was sent as a string `"7"` instead of number `7`) and retry once. Otherwise halt and surface the raw `errors[].message`. |
| HTTP `5xx` or network error | Transient (per `errors.md` §5xx). Retry once after 1s. If still failing, halt with timestamp. Do NOT proceed to Step 4 — partial composite failure handling applies (see bottom of recipe). |

**On success**, extract from the response:
- `id` — collection id (string over the wire; coerce to `Number(id)` for later numeric-typed calls).
- `slug` — server-derived slug; this is what `<Frigade.Collection collectionId={slug} />` needs.
- `name` — echoed back; should match what you sent.
- `type` — expect `"CUSTOM"` for a user-created collection.
- Dashboard URL: `https://app.frigade.com/collections/<slug>`.

Log a `create-collection:server-created` event to `.frigade/skill.log` with `op`, `slug`, `id`, `env`, and the `Authorization` header redacted.

---

## Step 4 — Framework detection

Look at the host project and dispatch to the right wiring path. Dispatch table (same as `recipes/create-announcement.md` Step 4 — reproduced for completeness):

| Signal | Dispatch |
|---|---|
| `next.config.{js,mjs,ts}` exists AND `app/layout.{tsx,jsx,js}` (or `src/app/layout.*`) exists AND no `pages/_app.*` (or `pages/` has API routes only) | **App Router** → `reference/next-app-router.md` |
| `next.config.{js,mjs,ts}` exists AND `pages/_app.{tsx,jsx,js}` (or `src/pages/_app.*`) exists AND no `app/layout.*` | **Pages Router** → `reference/next-pages-router.md` |
| Both `app/layout.*` AND `pages/_app.*` present (hybrid — e.g. `frigade-web`) | Ask: "This project has both App Router and Pages Router. Which should the collection mount under?" Default to App Router if the user doesn't answer (per `next-app-router.md` §"Hybrid case"). |
| `vite.config.*` or `src/main.tsx` + `src/App.tsx` (plain React) | **Plain React** — inline template (see `recipes/create-announcement.md` §"Plain-React (Vite / CRA) inline template"). |
| `remix.config.*`, `svelte.config.*`, `vue.config.*`, `nuxt.config.*`, `astro.config.*`, etc. | **Unsupported** — halt the code-emission half. Report to user: "Collection is live in Frigade but I don't know how to wire it into <framework>. See `https://docs.frigade.com/v2/sdk/react` for manual setup; mount `<Frigade.Provider apiKey=...>` at your app root and render `<Frigade.Collection collectionId='<slug>' />` where you want the grouped flows to appear." Upstream state preserved; see partial-failure template. |

**Detection order:** framework-specific config → layout/entry file presence → lockfile. Use `Glob` to check path existence before reading `package.json`.

**Monorepo.** If `turbo.json` is at the repo root AND there are `apps/*/package.json` files, pick the app whose package.json has `next` (or the matching framework) as a dep. Wire into that app's dir; `.env.local` lives next to that app's `package.json`, not at repo root (per `next-app-router.md` §"Edge cases / Monorepo").

---

## Step 5 — Install `@frigade/react`

Detect package manager by lockfile presence (stop at the first match):

| Lockfile | Command |
|---|---|
| `yarn.lock` | `yarn add @frigade/react` |
| `pnpm-lock.yaml` | `pnpm add @frigade/react` |
| `bun.lockb` | `bun add @frigade/react` |
| (default, including only `package-lock.json` or none) | `npm install @frigade/react` |

Run via Bash, in the directory that holds the relevant `package.json` (the host app's dir in a monorepo, the repo root otherwise). Use `run_in_background` to avoid blocking on slow installs — poll with `Monitor` if needed.

**On failure** (non-zero exit, network error, resolver error): surface stderr to the user verbatim, halt; do NOT proceed to Steps 6–7. Log the failure to `.frigade/skill.log` (redact any tokens in the npm output — rare but possible with private registries). The collection still exists in Frigade — report "collection created but install failed at Step 5" per the partial-failure template at the bottom.

**Idempotency.** If the project already has `@frigade/react` in `dependencies` (check `package.json`), skip the install — just confirm and move on. Do NOT re-install or auto-upgrade without the user's say-so (breaking-change risk).

---

## Step 6 — Ensure provider is mounted

Per the framework adapter picked in Step 4. This step, plus Step 7, plus any `.env.local` edits compose one **atomic code-edit batch**: take snapshots of every file you're about to edit; if any edit fails, revert all prior edits in the batch.

**If `<Frigade.Provider>` is already mounted** (e.g., from a prior `create-announcement.md` run in the same project), skip this step entirely — `Read` the candidate provider file, detect `<Frigade.Provider` in its contents, and move to Step 7. Idempotency matters: collections and announcements share the same provider.

### App Router (see `reference/next-app-router.md`)

1. If `app/providers.tsx` (or `src/app/providers.tsx`) does not exist, create it from the **full version** template (router-aware `navigate` with `useRouter().push`). The file lives at whichever path matches the existing `app/layout.tsx` location (`app/` vs `src/app/`).

   ```tsx
   'use client';

   import * as Frigade from '@frigade/react';
   import { useRouter } from 'next/navigation';
   import { ReactNode } from 'react';

   export function Providers({ children }: { children: ReactNode }) {
     const router = useRouter();

     if (!process.env.NEXT_PUBLIC_FRIGADE_API_KEY) {
       throw new Error(
         'NEXT_PUBLIC_FRIGADE_API_KEY is required. Copy .env.local.example to .env.local.',
       );
     }

     return (
       <Frigade.Provider
         apiKey={process.env.NEXT_PUBLIC_FRIGADE_API_KEY}
         userId={/* TODO: pass your app's auth user id here, e.g. from your session hook */ undefined}
         navigate={(url, target) => {
           if (target === '_blank') {
             window.open(url, '_blank');
           } else {
             router.push(url);
           }
         }}
       >
         {children}
       </Frigade.Provider>
     );
   }
   ```

2. If `app/providers.tsx` exists, read it first. If `<Frigade.Provider>` is already mounted inside it, leave it alone (idempotent). Otherwise, `Edit` the file to add the Frigade provider inside the existing outermost wrapper — preserve any other providers (Clerk, NextAuth, ThemeProvider, etc.). Canonical order from `next-app-router.md` §"Edge cases / Existing auth providers":
   ```tsx
   <ClerkProvider>
     <ThemeProvider>
       <Frigade.Provider apiKey={...} userId={...}>
         {children}
       </Frigade.Provider>
     </ThemeProvider>
   </ClerkProvider>
   ```

3. Edit `app/layout.tsx` (or `src/app/layout.tsx`). If `<Providers>` is not already imported and mounted, add:
   ```tsx
   import { Providers } from './providers';
   // inside <body>:
   <Providers>{children}</Providers>
   ```
   Preserve existing `metadata` export, font imports, `className` wiring.

### Pages Router (see `reference/next-pages-router.md`)

1. If `components/providers.tsx` (or `src/components/providers.tsx`) does not exist, create it from the **full version** template. Pages Router uses `next/router`, not `next/navigation`:
   ```tsx
   import * as Frigade from '@frigade/react';
   import { useRouter } from 'next/router';
   import { ReactNode } from 'react';

   export function Providers({ children }: { children: ReactNode }) {
     const router = useRouter();

     if (typeof process.env.NEXT_PUBLIC_FRIGADE_API_KEY === 'undefined') {
       throw new Error(
         'NEXT_PUBLIC_FRIGADE_API_KEY is required. Copy .env.local.example (or .env.example) to .env.local.',
       );
     }

     return (
       <Frigade.Provider
         apiKey={process.env.NEXT_PUBLIC_FRIGADE_API_KEY}
         userId={/* TODO: pass your app's auth user id here, e.g. from your session hook */ undefined}
         navigate={(url, target) => {
           if (target === '_blank') {
             window.open(url, '_blank');
           } else {
             router.push(url);
           }
         }}
       >
         {children}
       </Frigade.Provider>
     );
   }
   ```

2. If `components/providers.tsx` already exists and doesn't wrap `<Frigade.Provider>`, edit to add it inside the outermost wrapper — same preservation approach as App Router (keep other providers intact; nest Frigade inside them).

3. Edit `pages/_app.tsx` (or `src/pages/_app.tsx`). If `<Providers>` isn't already wrapping `<Component {...pageProps} />`, add:
   ```tsx
   import { Providers } from '@/components/providers';

   export default function MyApp({ Component, pageProps }: AppProps) {
     return (
       <Providers>
         <Component {...pageProps} />
       </Providers>
     );
   }
   ```
   Adjust the import path if the project doesn't use `@/` alias. Preserve existing imports (fonts, globals.css, other providers).

### Plain React

Follow the inline template in `recipes/create-announcement.md` §"Plain-React (Vite / CRA) inline template". Edit `src/main.tsx` / `src/index.tsx` to mount `<FrigadeProviders>` around `<App />`.

**Public key source (all frameworks):** `process.env.NEXT_PUBLIC_FRIGADE_API_KEY` for Next, `import.meta.env.VITE_FRIGADE_API_KEY` for Vite, `process.env.REACT_APP_FRIGADE_API_KEY` for CRA. The **private** key (`FRIGADE_API_KEY_SECRET`) **must never** appear in any client-reachable file — only in `.env.local` where the skill reads it for REST/GraphQL calls. If you catch yourself about to reference the private key from a component, stop.

---

## Step 7 — Mount `<Frigade.Collection>` in the host codebase

Mount `<Frigade.Collection collectionId="<slug>" />` at the right scope. Use the server-returned `slug` from Step 3's response — not the raw user-supplied `name`.

### Default: app-wide (visible on every route)

- **App Router** — mount inside `<Providers>` in `app/layout.tsx`. Because layout is a Server Component and `<Frigade.Collection>` needs to be in a Client Component, create a tiny `'use client'` component for it. If `app/app-flows.tsx` already exists (from a prior `create-announcement` run, for example), append to it rather than overwriting; otherwise create the file fresh.

  ```tsx
  // app/app-flows.tsx  (NEW or extended file)
  'use client';

  import * as Frigade from '@frigade/react';

  export function AppFlows() {
    return (
      <>
        {/* other flows mounted by previous recipes stay here */}
        <Frigade.Collection collectionId="<slug>" />
      </>
    );
  }
  ```

  ```tsx
  // app/layout.tsx — inside <Providers>, add <AppFlows /> if not already present
  import { Providers } from './providers';
  import { AppFlows } from './app-flows';

  export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
      <html lang="en">
        <body>
          <Providers>
            <AppFlows />
            {children}
          </Providers>
        </body>
      </html>
    );
  }
  ```

- **Pages Router** — mount inside `<Providers>` in `pages/_app.tsx`, before `<Component {...pageProps} />`. No `'use client'` boundary needed:

  ```tsx
  <Providers>
    <Frigade.Collection collectionId="<slug>" />
    <Component {...pageProps} />
  </Providers>
  ```

- **Plain React** — mount inside `<App />`, typically at the root of `App.tsx`.

### Page-scoped: "on the dashboard only" / specific route

If the user said "only when they visit `/dashboard`" or "on the settings page":
- **App Router** — mount in the relevant `app/<route>/page.tsx` (or a small client child of it).
- **Pages Router** — mount in `pages/<route>.tsx`.
- **Plain React** — mount in the specific route's component (or use your router's element).

### `defaultCollection` note

`sdk-react.md` §"`<Frigade.Collection>`" notes the Provider auto-renders a built-in **default** Collection when `defaultCollection={true}` (the default) — that's a different thing from the custom Collection this recipe just created. Custom Collections with a user-chosen name/slug always require an explicit `<Frigade.Collection collectionId="<slug>" />` tag. Do not remove it on the assumption that `defaultCollection` covers it.

**Honor user-specified location.** If the user said "mount the Product Updates collection on the settings page," don't default to `app/app-flows.tsx` — mount it in `app/settings/page.tsx` (or the equivalent page file) instead. Snapshot that file before editing; the atomic-batch behavior still applies.

### Atomic batch boundary

Step 6 + Step 7 + any `.env.local` edit form one atomic code-edit batch. Before the first `Edit` or `Write`, snapshot every target file's current contents in memory. If any operation in the batch fails, revert all edits in the batch by re-writing each snapshot. Package install from Step 5 is NOT rolled back — it's cheap and safe to keep.

---

## Step 8 — Grep guard

After code emission (Steps 6 and 7), run a guard to confirm the private key didn't leak into any client-reachable source file:

```bash
grep -rn "FRIGADE_API_KEY_SECRET" src/ app/ pages/ components/ 2>/dev/null || true
```

**Expected: zero hits.** If any hit appears in a `.ts`, `.tsx`, `.js`, or `.jsx` file under those dirs, that's a private-key-leak violation of the hard rule that secrets never enter client code. Actions:

1. Revert the entire Step 6 + 7 batch using the snapshots taken at the batch boundary.
2. Log `create-collection:secret-leak-detected` to `.frigade/skill.log` (redact the key itself; include file path and line number).
3. Halt and surface to the user: "Detected FRIGADE_API_KEY_SECRET in client source (<path>:<line>). Rolled back all code edits. The collection still exists in Frigade; retry after fixing the leak source."

The guard is purely defensive — the templates in Step 6 never reference the private key, so zero hits is the only acceptable outcome.

---

## Step 9 — Ask to start the dev server

Prompt the user with a single yes/no (never auto-start):

> Start the dev server now (`npm run dev` / `yarn dev` / `pnpm dev` / `bun dev`) so you can see the collection at http://localhost:3000? (y/n)

Command picker (same lockfile logic as Step 5):

| Lockfile | Command |
|---|---|
| `yarn.lock` | `yarn dev` |
| `pnpm-lock.yaml` | `pnpm dev` |
| `bun.lockb` | `bun dev` |
| default | `npm run dev` |

- **Yes** → run via Bash with `run_in_background: true`. Report: "Dev server started. Open http://localhost:3000 in your browser — flows attached to this collection should appear." If a port collision occurs, surface the error and hand back without killing processes (dev server lifecycle is out of scope for auto-recovery, per `errors.md` §"Partial failure" item 5).
- **No** → report: "Run `<dev command>` when you're ready; flows attached to the collection will appear at http://localhost:3000."

Note: a freshly created collection with **no flows attached** will render nothing at runtime. That's expected — attaching flows is the job of `recipes/add-flows-to-collection.md` (or the `updateRules` mutation with a `flowIds` array). Step 10's success message surfaces this.

---

## Step 10 — Success message

Emit the success block. Exact template:

```
Collection created: "<name>" (id: <id>, slug: <slug>) in <env>.
   Dashboard: https://app.frigade.com/collections/<slug>

SDK wired into your codebase:
   - Installed @frigade/react (via <pm>)                 [or: "already installed, skipped"]
   - Added <Frigade.Provider> to <provider-file-path>    [or: "already present, skipped"]
   - Mounted <Frigade.Collection collectionId="<slug>" /> in <mount-file-path>

Public env var: NEXT_PUBLIC_FRIGADE_API_KEY (in .env.local, gitignored)

Open http://localhost:3000 — the collection is live, but it will render nothing until flows are attached.

Next steps:
  - Attach flows:       `recipes/add-flows-to-collection.md`
  - Promote to prod:    `recipes/promote-collection-to-prod.md`
```

If `flowIds` were passed to `createRule` at creation time (user attached flows up front), replace the "render nothing until flows are attached" line with:

```
Open http://localhost:3000 — the collection contains <N> flow(s) and they should appear now.
```

---

## Step 11 — Log success

Append a `create-collection:success` event to `.frigade/skill.log` with:
- `op: "create-collection"`
- `slug`, `id` (as string from the response; don't lose precision by coercing to number here)
- `env` (`dev` or `prod`)
- `files_touched` — array of file paths edited/created in Steps 6–7 (provider file, layout/_app file, app-flows file, page file if page-scoped)
- `pm` — the package manager detected in Step 5, or `"skipped"` if `@frigade/react` was already installed
- `authorization_header: "redacted"` — sentinel confirming we did not persist the raw key

Redact any `Authorization` header value and any raw API key anywhere in the log payload. If the user passed `coolOffPeriod`/`coolOffUnit`, include those in the event too for future debugging.

---

## Partial-failure handling

Use the template below **verbatim** when any step between 3 and 7 fails. This is the canonical shape from `errors.md` §"Reporting partial failures".

### Behaviors

1. **Upstream state is preserved.** If Step 3 succeeded and any of Steps 4–7 failed, the collection exists in Frigade. Do **not** call `deleteRule` as silent recovery (per `errors.md` §"Partial failure" item 2). Let the user decide.
2. **Code-edit batches are atomic.** Steps 6–7 (plus any `.env.local` edits) form one atomic batch. Snapshot every file before its first edit; if any edit in the batch fails, revert all file edits in the batch to their pre-batch state. Package installs (Step 5) are NOT rolled back — they're cheap to keep and safe (adding `@frigade/react` to `package.json` breaks nothing).
3. **Idempotency on retry.** A follow-up "retry code wiring only" invocation re-runs parameter resolution but **skips Step 3** (the collection already exists — look it up via `reference/graphql-schema.md` §`rules` query with the known slug). Skips Step 5 if `@frigade/react` is already in `dependencies`. Re-reads file state from disk before re-attempting Steps 6–7. Do NOT trust a stale before-state cache.
4. **Never destructive without confirmation.** The recovery offer includes a `deleteRule` option only as an explicit choice, and the skill emits the canonical `Collection delete` confirmation from `operations.md` §"Collection delete" before acting: `"About to delete collection '<name>' in <env>. Flows attached to this collection will lose the association. Confirm? (y/n)"`
5. **Log everything.** Append a `create-collection:partial-failure` event to `.frigade/skill.log` with step number, operation, failure reason, files rolled back, and user-facing recovery options offered.

### Collection-specific failure points

- **Step 3 succeeded, Steps 5–7 failed** → upstream collection exists; no code edits (or code edits reverted). Offer the 3-option recovery below.
- **Step 5 fails** → upstream collection exists, no code edits applied. Same 3-option recovery, but option 1 re-runs from Step 5.
- **Step 7 fails mid-batch** → revert every file using the snapshot; upstream preserved. Same 3-option recovery.
- **Step 8 (grep guard) flags a leak** → revert the batch and halt; this is a skill bug — report the file + line to the user and log `create-collection:secret-leak-detected`.

### Report template (concrete)

```
Completed:
 Created collection: "<name>" (id: <id>, slug: <slug>) — https://app.frigade.com/collections/<slug>
 Installed @frigade/react via <pm>                    [or: "already installed"]

Failed at step <N> of 11:
 Could not <operation>
   Reason: <specific cause — e.g. "app/layout.tsx was modified externally between my read and write (mtime changed)" or "Edit failed: unique old_string not found">
   Rolled back: <list of files whose edits were reverted, or "no file edits persisted in this batch">.
   Preserved (not rolled back): <package installs, .env.local changes — each is cheap/safe to keep>.

Upstream state preserved:
- The collection "<name>" (slug: <slug>) exists in Frigade <env>. No action has been taken on it.

Recovery options:
  1. Retry code wiring only (I'll re-read file state and resume from step <N>; the collection won't be re-created).
  2. Delete the created collection (I'll call deleteRule(id: <id>) after the canonical confirmation, then re-run this recipe from scratch).
  3. Leave things as they are — the collection exists server-side but isn't mounted in your app. You can wire it manually later, or remove it from the dashboard.

Which would you like? (1/2/3)
```

All three options must be offered; (3) is always available per `errors.md` §"Reporting partial failures" required fields.

---

## Worked example

**User prompt:**
> "Create a 'Product Updates' collection and embed it on the dashboard page."

**Claude's execution (condensed):**

**Step 1 — parse:**
- `name = "Product Updates"` (from quoted substring)
- `description = ""` (user didn't specify → empty string; `createRule` requires the arg, empty is valid)
- `coolOffPeriod = null`, `coolOffUnit = null` (not specified — let the server default)
- `flowIds = []` (user didn't attach flows up front → omit from the mutation)
- `environment = "dev"` (no prod indicator in the prompt)
- Mount location: `app/dashboard/page.tsx` (user said "on the dashboard page" → page-scoped, not app-wide)

**Step 2 — confirmation gate:**

`environment == "dev"` → skip prompt; proceed.

**Step 3 — `createRule` GraphQL:**

```bash
BODY=$(jq -n \
  --arg name "Product Updates" \
  --arg desc "" \
  '{
    query: "mutation CreateCollection($name: String!, $description: String!, $coolOffPeriod: Float, $coolOffUnit: String) { createRule(name: $name, description: $description, coolOffPeriod: $coolOffPeriod, coolOffUnit: $coolOffUnit) { id slug name type } }",
    variables: { name: $name, description: $desc, coolOffPeriod: null, coolOffUnit: null }
  }')

curl -sS -X POST "https://api3.frigade.com/graphql" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d "$BODY"
```

→ HTTP 200, response body:
```json
{ "data": { "createRule": { "id": "4821", "slug": "product-updates", "name": "Product Updates", "type": "CUSTOM" } } }
```

Coerce `id` → `Number("4821")` = `4821` for any future `updateRules` / `deleteRule` calls. Log `create-collection:server-created` with `slug=product-updates`, `id=4821`, `env=dev`.

**Step 4 — framework detection:**

`Glob` finds `app/layout.tsx` and `next.config.ts`; no `pages/_app.tsx`. → **App Router** path (`reference/next-app-router.md`).

**Step 5 — install:**

`package.json` already lists `@frigade/react` (left over from a prior `create-announcement` run) → skip install, log `"already installed, skipped"`.

**Step 6 — provider wiring:**

Read `app/providers.tsx` → already contains `<Frigade.Provider>`. Skip; no edit needed.

**Step 7 — mount collection on the dashboard page:**

Snapshot `app/dashboard/page.tsx`. Since the user said "on the dashboard page," mount in-page rather than in `app-flows.tsx`. The page is a Server Component, so create a small client wrapper:

```tsx
// app/dashboard/dashboard-collection.tsx  (NEW)
'use client';

import * as Frigade from '@frigade/react';

export function DashboardCollection() {
  return <Frigade.Collection collectionId="product-updates" />;
}
```

`Edit` `app/dashboard/page.tsx` to import and render `<DashboardCollection />` near the top of the page body.

**Step 8 — grep guard:**

`grep -rn "FRIGADE_API_KEY_SECRET" src/ app/ pages/ components/` → zero hits. Guard passes.

**Step 9 — dev server:**

Ask: "Start the dev server now (`npm run dev`)? (y/n)". User: `y`. Run `npm run dev` in background. Report: "Open http://localhost:3000/dashboard."

**Step 10 — success message:**

```
Collection created: "Product Updates" (id: 4821, slug: product-updates) in dev.
   Dashboard: https://app.frigade.com/collections/product-updates

SDK wired into your codebase:
   - Installed @frigade/react: already installed, skipped
   - Added <Frigade.Provider> to app/providers.tsx: already present, skipped
   - Mounted <Frigade.Collection collectionId="product-updates" /> in app/dashboard/dashboard-collection.tsx (rendered from app/dashboard/page.tsx)

Public env var: NEXT_PUBLIC_FRIGADE_API_KEY (in .env.local, gitignored)

Open http://localhost:3000/dashboard — the collection is live, but it will render nothing until flows are attached.

Next steps:
  - Attach flows:       `recipes/add-flows-to-collection.md`
  - Promote to prod:    `recipes/promote-collection-to-prod.md`
```

**Step 11 — log success:**

Append to `.frigade/skill.log`:
```json
{"op":"create-collection","slug":"product-updates","id":"4821","env":"dev","files_touched":["app/dashboard/dashboard-collection.tsx","app/dashboard/page.tsx"],"pm":"skipped","authorization_header":"redacted","ts":"<iso8601>"}
```

Recipe done. The collection is authored, mounted, and ready for flow attachment via the next recipe in the chain.
