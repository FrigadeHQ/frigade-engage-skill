# Recipe: Create Announcement

**End-to-end create-an-announcement recipe.** Takes the user's intent ("build me a welcome announcement"), creates the flow in Frigade, then installs `@frigade/react`, wires the `<Frigade.Provider>`, and mounts `<Frigade.Announcement>` in the host codebase. On partial failure (per **D16**), Frigade-side state is preserved and code-edit batches are rolled back atomically.

Referenced decisions: **D02** (full dashboard parity for flow authoring), **D04** (end-to-end wiring, not just "flow created" success), **D07** (public key in client code; private key only in `.env.local` → `Authorization`), **D09/D23/D26** (per-env safety tags per `operations.md`), **D12 (revised)** (cross-flow CTAs are React handlers, not YAML), **D14** (ask before starting dev server), **D16** (atomic code edits, preserved Frigade state on partial failure), **D17** (log to `.frigade/skill.log`), **D21** (`.gitignore` hygiene), **D27** (no `GET /v1/me`; use REST alone), **D28** (403 = bad key, 401 = ownership).

Companion refs:
- `recipes/first-run-setup.md` — pre-condition state check.
- `reference/yaml-spec.md` — ANNOUNCEMENT YAML shape and the v2 CTA `action` enum.
- `reference/rest-endpoints.md` — `POST /v1/flows` contract; `GET /v1/flows/:id` slug existence check; `POST /v1/cdnUpload` for uploads.
- `reference/sdk-react.md` — `<Frigade.Announcement>` component props and `<Frigade.Provider>` surface.
- `reference/next-app-router.md` / `reference/next-pages-router.md` — framework adapters with ready-to-paste snippets.
- `reference/operations.md` — `createFlow` safety row (dev: safe; prod: dangerous) and canonical confirmation prompt templates.
- `reference/errors.md` — REST failure handling (§401/403/404/409/422/429/5xx) and composite-failure reporting.

---

## Pre-conditions

1. **`first-run-setup.md` Section 1 passed.** The current working directory has `.frigade/project.json` (marker) and `.env.local` with at least `NEXT_PUBLIC_FRIGADE_API_KEY` + `FRIGADE_API_KEY_SECRET` that verify against the marker's `workspaceId`. If not, invoke `first-run-setup.md` first — it returns silently on success. Don't proceed until that returns.
2. **Dev private key available in env.** The shell that runs the `curl` in Step 3 has `FRIGADE_API_KEY_SECRET` exported (e.g. `set -a; source .env.local; set +a`). Never paste the raw key into a tool-call argument; always interpolate `$FRIGADE_API_KEY_SECRET` from the shell.
3. **Framework detection succeeds at Step 4.** If the host project is a framework the skill doesn't know how to wire (Vue, Svelte, Remix, Astro…), Step 4 stops the code-emission half and reports "flow is live in Frigade but not wired into this codebase" with a manual-setup link.

---

## Step 1 — Gather inputs

Parse the triggering prompt. Fill these inputs, asking only for what's missing:

| Input | Type | Required | How to resolve |
|---|---|---|---|
| `title` | `string` | **yes** | Extract from the prompt quote (e.g. "'Welcome to my product'"). If absent, ask: "What should the title say?" |
| `body` | `string` | no | Multi-line markdown OK. If the user said "some copy" without specifics, default to `"Get started in a few clicks"` and flag it for replacement. |
| `media` | `{ type, url, alt? }` | no | `{ type: image, url, alt }` or `{ type: video, url }`. If the user said "placeholder image" without a URL, default `type: image`, `url: "https://placehold.co/600x400?text=Welcome"`, and note "(placeholder — swap for your brand image)". For an in-house asset, offer `POST /v1/cdnUpload` (see `rest-endpoints.md` §CDN). |
| `primaryButton` | `{ title, action }` | no | `action` is one of the v2 CTA enum values (see `yaml-spec.md` §"CTA `action` enum"). If the user said "Take a tour" or similar, this CTA links to *another flow* — set `action: false` (non-forwarding) and **record the target tour's slug** for the link-flows recipe (Task 18 / `recipes/link-flows.md`) to wire up the `onPrimary` React handler (per **D12 revised**). Default title if unspecified: `"Get started"`. |
| `secondaryButton` | `{ title, action }` | no | Default: `{ title: "Maybe later", action: "flow.skip" }`. If the user explicitly said "no secondary button", omit it entirely. |
| `slug` | `string` | **yes** (derived) | Derive from `title`: lowercase, kebab-case, strip non-alphanumerics. Then run the collision check below before using. |
| `name` | `string` | no | Dashboard-facing name; default to `title`. |
| `environment` | `"dev" \| "prod"` | no | Default `dev`. If the user said "in prod", "production", or "live", set `prod` and apply the prod confirmation wrapper (see Step 3). |

**Multi-step?** The YAML supports a multi-step wizard (see `yaml-spec.md` §ANNOUNCEMENT Example 1). If the user described multiple pages ("page 1 says…, then page 2 says…"), emit each as its own `steps[]` entry with a unique `id`. Default is single-step.

### Slug collision check

Before proceeding to Step 2, confirm the derived slug is free:

```bash
curl -sS -w "\n---HTTP_STATUS:%{http_code}---\n" \
  "https://api3.frigade.com/v1/flows/<derived-slug>" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
```

- `404` → slug is free; proceed.
- `200` → slug is taken. Append `-2`, `-3`, … and retry until a `404` comes back (see `errors.md` §409 Conflict). Do NOT silently reuse the existing flow — the user may not have meant to collide. Surface:
  > A flow with slug `<slug>` already exists. Use `<slug>-2` instead, or update the existing flow? (1 = new slug, 2 = update existing, 3 = abort)
  - `1` → use the next-available slug.
  - `2` → skip Step 3 and jump to `recipes/update-flow.md` (forthcoming; meanwhile, do not auto-PUT — surface the conflict and halt).
  - `3` → halt.
- `403` → key auth failed; follow `errors.md` §403 (route to `first-run-setup.md`).

### Dogfood CTA note (Eric's acceptance test)

When the user's prompt contains "Take a tour" (or any phrasing that implies "this CTA starts *another flow*"), remember:
- The YAML `action` enum operates only on the *containing* flow. There is **no** `action: flow.start:<other-slug>` value (confirmed in `yaml-spec.md` §"Cross-flow CTAs" and `sdk-react.md` §D12).
- This recipe sets `primaryButton.action: false` on the announcement, then hands off to `recipes/link-flows.md` (Task 18) after the tour is authored (via `recipes/create-tour.md`, Task 17) to attach an `onPrimary` React handler that calls `tour?.restart()`.

Store the CTA's target-flow hint somewhere durable for the follow-up recipe — e.g. pass it as part of the Step 10 report or write it into `.frigade/skill.log` as a `pending_link` event.

---

## Step 2 — Build the YAML

Construct the `data` YAML per `yaml-spec.md` §ANNOUNCEMENT. Single-step template:

```yaml
steps:
  - id: <slug-first-step>         # kebab-case; e.g. "welcome-step"
    title: "<title>"              # from Step 1
    subtitle: |                   # subtitle holds body content (not `body` — field name is `subtitle`)
      <body>
    imageUri: "<media.url>"       # ANNOUNCEMENT uses imageUri (not a `media` block); see yaml-spec.md §"Media / images"
    primaryButton:
      title: "<primaryButton.title>"
      action: <primaryButton.action>   # unquoted `false` for non-forwarding; quoted enum string otherwise
    secondaryButton:
      title: "<secondaryButton.title>"
      action: <secondaryButton.action>
```

**Field-name note — common trap.** `yaml-spec.md` §"Step structure" is authoritative:
- Body text → `subtitle`, NOT `body`. (Flows do not have a `body` field.)
- Image URL → `imageUri`, NOT `media.url`. (There is no `media` block on step objects.)
- Alt text → not a first-class field; embed in the `subtitle` or rely on the image URL itself. The YAML spec does not surface an alt key.

Correct the task-prompt's "media" / "body" shorthand into the real fields before writing the YAML.

**Multi-step template** (when the user described multiple pages):

```yaml
steps:
  - id: step-1
    title: "<title-1>"
    subtitle: |
      <body-1>
    imageUri: "<media-1.url>"
    primaryButton:
      title: "Next"         # default step.complete action advances to next step
  - id: step-2
    title: "<title-2>"
    subtitle: |
      <body-2>
    imageUri: "<media-2.url>"
    primaryButton:
      title: "<primaryButton.title>"
      action: <primaryButton.action>
    secondaryButton:
      title: "<secondaryButton.title>"
      action: <secondaryButton.action>
```

(Pattern from `yaml-spec.md` §ANNOUNCEMENT Example 1 — the dashboard's default 2-page wizard.)

**Lint locally before POSTing.** Use a quick `python3 -c "import yaml,sys; yaml.safe_load(sys.stdin.read())"` or `node -e "require('js-yaml').load(require('fs').readFileSync('/dev/stdin','utf8'))"` to catch indentation errors before the API call. Server-side YAML parse errors surface as 422 with a parser message (see `errors.md` §422).

---

## Step 3 — Create the flow (API call)

**Endpoint:** `POST /v1/flows` (per `rest-endpoints.md` §"POST /v1/flows/").

**Prod confirmation gate (D09).** If `environment == "prod"`, per the `operations.md` `createFlow` row (`safe` in dev, `dangerous` in prod), emit the canonical confirmation:

> About to create flow '<slug>' in prod. This affects live flow state. Confirm? (y/n)

Wait for an explicit `y`/`yes`. Anything else aborts with no side effects. Dev skips this.

**Auth header:** `Authorization: Bearer $FRIGADE_API_KEY_SECRET` (or `$FRIGADE_API_KEY_SECRET_PROD` when `environment == "prod"`). Per `first-run-setup.md` Section 5, the Section-5 helper picks the right env var.

**Request body** (note: `data` is a **string** containing the YAML, NOT a nested object):

```json
{
  "slug": "<derived-slug>",
  "name": "<name>",
  "type": "ANNOUNCEMENT",
  "data": "<YAML string, newline-joined>",
  "active": true
}
```

**Curl template** (interpolate `$YAML_STRING` from a shell var that holds the Step-2 output; do not paste the YAML into the tool-call argument inline):

```bash
# Shell-side: build the body with a heredoc, interpolate the YAML via jq to stringify safely
BODY=$(jq -n \
  --arg slug "$SLUG" \
  --arg name "$NAME" \
  --arg data "$YAML_STRING" \
  '{slug: $slug, name: $name, type: "ANNOUNCEMENT", data: $data, active: true}')

curl -sS -X POST "https://api3.frigade.com/v1/flows" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  -w "\n---HTTP_STATUS:%{http_code}---\n"
```

(Using `jq` for body assembly avoids shell-quoting bugs around multi-line YAML. Falls back to a one-liner JSON object when `jq` isn't installed — construct the string carefully with `\n` escapes.)

### Handling the response (per `errors.md`)

| Status | Meaning | Action |
|---|---|---|
| `201` (or `200`) | Created | Extract `id` (numeric), `slug` (may differ from requested — e.g. if server auto-generated a `flow_<nanoid>` because your slug was malformed). Proceed to Step 4. |
| `400` with "already exists" message | Slug collision (synthetic 409 per `errors.md` §409). | The Step-1 pre-check should have caught this; if it slipped through (race), bump the slug suffix (`-2`, `-3`) and retry **once** before surfacing to the user. |
| `400` with array `message` (validation) | DTO rejected the body. Per `errors.md` §422: parse each entry, attempt one auto-correction if obvious (e.g. `type` case mismatch, stringified YAML instead of object, missing required field). Show the user a unified diff of the corrected body. Retry once. If still failing, halt and surface the raw messages. | Auto-correct common cases: uppercase `TYPE`, stray `data` object instead of string. Ask for input on anything non-obvious. |
| `401` | Ownership/cross-env mismatch (per `errors.md` §401 / D28). | Halt. Tell the user: "The key appears to belong to a different environment than the resource. Swap key and retry." Do NOT auto-retry with the other env var. |
| `403` | Bad/revoked/public key (per `errors.md` §403 / D28). | Halt. Link to dashboard `https://app.frigade.com/settings/api`. Route user back to `first-run-setup.md` Section 2.7 verification curl. |
| `422` | Rare; treat as 400-array (per `errors.md` §422). | Same handling as 400 array. |
| `429` | MAU cap (per `errors.md` §429 / D29). | Halt with "no retry will help; upgrade at `https://app.frigade.com/settings/billing`." |
| `5xx` / network error | Transient or uncaught server error (per `errors.md` §5xx). | Retry once after 1s. If still failing, halt with timestamp. Do NOT proceed to Step 4 — partial composite failure handling applies (see bottom of recipe). |

**On success**, extract from the response:
- `id` — numeric flow id (for any future `PUT /v1/flows/:numericFlowId` call).
- `slug` — the server-accepted slug; prefer this over the client-sent one (the server may auto-generate if the client-sent slug was malformed).
- Dashboard URL: `https://app.frigade.com/flows/<slug>`.

Log the success to `.frigade/skill.log` (per **D17**) with `Authorization` header redacted.

---

## Step 4 — Framework detection

Look at the host project and dispatch to the right wiring path. Rules:

| Signal | Dispatch |
|---|---|
| `next.config.{js,mjs,ts}` exists AND `app/layout.{tsx,jsx,js}` (or `src/app/layout.*`) exists AND no `pages/_app.*` (or `pages/` has API routes only) | **App Router** → `reference/next-app-router.md` |
| `next.config.{js,mjs,ts}` exists AND `pages/_app.{tsx,jsx,js}` (or `src/pages/_app.*`) exists AND no `app/layout.*` | **Pages Router** → `reference/next-pages-router.md` |
| Both `app/layout.*` AND `pages/_app.*` present (hybrid — e.g. `frigade-web`) | Ask: "This project has both App Router and Pages Router. Which should the announcement mount under?" Default to App Router if the user doesn't answer (per `next-app-router.md` §"Hybrid case"). |
| `vite.config.*` or `src/main.tsx` + `src/App.tsx` (plain React) | **Plain React** — see inline template below. |
| `remix.config.*`, `svelte.config.*`, `vue.config.*`, `nuxt.config.*`, `astro.config.*`, etc. | **Unsupported** — halt the code-emission half. Report to user: "Flow is live in Frigade but I don't know how to wire it into <framework>. See `https://docs.frigade.com/v2/sdk/react` for manual setup; mount `<Frigade.Provider apiKey=...>` at your app root and render `<Frigade.Announcement flowId='<slug>'>` where you want the announcement to appear." |

**Detection order:** framework-specific config → layout/entry file presence → lockfile. Use `Glob` to check path existence before reading package.json.

**Monorepo.** If `turbo.json` is at the repo root AND there are `apps/*/package.json` files, pick the app whose package.json has `next` (or the matching framework) as a dep. Wire into that app's dir; the user's `.env.local` lives next to the app's `package.json`, not at repo root (per `next-app-router.md` §"Edge cases / Monorepo").

### Plain-React (Vite / CRA) inline template

When the project is plain React (no Next), create:

```tsx
// src/FrigadeProviders.tsx
import * as Frigade from '@frigade/react';
import { ReactNode } from 'react';

export function FrigadeProviders({ children }: { children: ReactNode }) {
  const apiKey = import.meta.env.VITE_FRIGADE_API_KEY ?? process.env.REACT_APP_FRIGADE_API_KEY;
  if (!apiKey) {
    throw new Error('Missing VITE_FRIGADE_API_KEY (Vite) or REACT_APP_FRIGADE_API_KEY (CRA) in .env.local.');
  }

  return (
    <Frigade.Provider apiKey={apiKey}>
      {children}
    </Frigade.Provider>
  );
}
```

Edit `src/main.tsx` (or `src/index.tsx` for CRA) to wrap:

```tsx
import { FrigadeProviders } from './FrigadeProviders';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FrigadeProviders>
      <App />
    </FrigadeProviders>
  </React.StrictMode>,
);
```

Mount `<Frigade.Announcement flowId="<slug>" />` inside `<App />` (or at the root of a specific page component) — same contract as the Next flows.

Env-var prefix for plain React is framework-dependent: Vite uses `VITE_`, CRA uses `REACT_APP_`. Use whichever matches the detected lockfile / config; default to Vite since CRA is end-of-life. Record the env var you chose in `.env.local` (Step 8).

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

**On failure** (non-zero exit, network error, resolver error): surface stderr to the user verbatim, halt; do NOT proceed to Steps 6–7. Log the failure per **D17** (redact any tokens in the npm output — rare but possible with private registries). The flow still exists in Frigade — report "flow created but install failed at Step 5" per the partial-failure template at the bottom.

**Idempotency.** If the project already has `@frigade/react` in `dependencies` (check `package.json`), skip the install — just confirm and move on. Do NOT re-install or auto-upgrade without the user's say-so (breaking-change risk).

---

## Step 6 — Ensure provider is mounted

Per the framework adapter picked in Step 4. This step, plus Step 7, plus Step 8 compose one **atomic code-edit batch** (per **D16**): take snapshots of every file you're about to edit; if any edit fails, revert all prior edits in the batch.

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

1. If `components/providers.tsx` (or `src/components/providers.tsx`) does not exist, create it from the **full version** template. Note: Pages Router uses `next/router`, not `next/navigation`:
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

2. If `components/providers.tsx` already exists and doesn't wrap `<Frigade.Provider>`, edit to add it inside the outermost wrapper — same preservation rules as App Router.

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

Follow the inline template in Step 4. Edit `src/main.tsx` / `src/index.tsx` to mount `<FrigadeProviders>` around `<App />`.

**Public key source (all frameworks):** `process.env.NEXT_PUBLIC_FRIGADE_API_KEY` for Next, `import.meta.env.VITE_FRIGADE_API_KEY` for Vite, `process.env.REACT_APP_FRIGADE_API_KEY` for CRA. Per **D07**, the **private** key (`FRIGADE_API_KEY_SECRET`) **must never** appear in any client-reachable file — only in `.env.local` where the skill reads it for REST calls. If you catch yourself about to reference the private key from a component, stop.

---

## Step 7 — Mount the announcement component

Mount `<Frigade.Announcement flowId="<slug>" />` at the right scope.

### Default: app-wide (visible on every route)

- **App Router** — mount inside `<Providers>` in `app/layout.tsx`. Because layout is a Server Component and `<Frigade.Announcement>` needs to be in a Client Component, create a tiny `'use client'` component for it. Pattern from `next-app-router.md` §"Mounting flows":

  ```tsx
  // app/app-flows.tsx  (NEW file, or add <Frigade.Announcement> to an existing client file)
  'use client';

  import * as Frigade from '@frigade/react';

  export function AppFlows() {
    return <Frigade.Announcement flowId="<slug>" />;
  }
  ```

  ```tsx
  // app/layout.tsx — inside <Providers>, add <AppFlows />
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
    <Frigade.Announcement flowId="<slug>" />
    <Component {...pageProps} />
  </Providers>
  ```

- **Plain React** — mount inside `<App />`, typically at the root of `App.tsx`.

### Page-scoped: "on the homepage only" / specific route

If the user said "on the homepage" or "only when they visit `/dashboard`":
- **App Router** — mount in the relevant `app/<route>/page.tsx` (or a small client child of it).
- **Pages Router** — mount in `pages/<route>.tsx`.
- **Plain React** — mount in the specific route's component (or use your router's element).

### `defaultCollection` note

`next-app-router.md` §"Mounting flows" notes the Provider auto-renders a built-in Collection when `defaultCollection={true}` (the default) — which means announcements published through the dashboard may appear **without** an explicit `<Frigade.Announcement>` tag. That's fine, but for dogfood clarity and precise mounting control, this recipe always emits the explicit tag. The user is welcome to remove it and rely on `defaultCollection` later.

**Announcement component props worth surfacing in the emitted code** (from `sdk-react.md` §"`<Frigade.Announcement>`"):
- `dismissible` — whether the user can close it. Safe default: rely on the YAML `props.dismissible` if set, otherwise let the component's default take over (consult the SDK — the recipe doesn't force a value).
- `modal` — force single-modal behavior (prevents collisions with other modal flows).
- `onPrimary` / `onSecondary` — **leave unset in this recipe.** These are where the link-flows recipe (Task 18) hooks cross-flow actions. Emitting them here would conflict with Task 18's output.

---

## Step 8 — Update `.env.local`

If `.env.local` exists and already has `NEXT_PUBLIC_FRIGADE_API_KEY` set to the matching public key (from `first-run-setup.md` Section 1's bind), leave it alone.

Otherwise, append (using `Edit`, not `Write` — preserve any non-Frigade env vars):

```bash
# Frigade Engage (managed by frigade-engage skill — do not commit)
NEXT_PUBLIC_FRIGADE_API_KEY=<dev public value>
FRIGADE_API_KEY_SECRET=<dev private value>
```

**Key handling rules (per `first-run-setup.md` §"Hard rules"):**
- `NEXT_PUBLIC_FRIGADE_API_KEY` ships to the browser bundle — that's expected for a public key (`api_public_...`).
- `FRIGADE_API_KEY_SECRET` (`api_private_...`) **must never** leave `.env.local`. Do not write it to `app/providers.tsx`, any component, any `.ts`/`.tsx` source file, any commit message, or the skill log. If this recipe ever causes the private key to appear outside `.env.local`, that's a skill bug.
- `.gitignore` must cover `.env.local` (Section 2.5 of first-run-setup handles this; double-check here and re-add if somehow removed).

For **plain React** (Step 4 fallback), use the appropriate public-key var name (`VITE_FRIGADE_API_KEY` for Vite, `REACT_APP_FRIGADE_API_KEY` for CRA).

---

## Step 9 — Ask to start the dev server (D14)

Prompt the user with a single yes/no (per **D14**, never auto-start):

> Start the dev server now (`npm run dev` / `yarn dev` / `pnpm dev` / `bun dev`) so you can see the announcement at http://localhost:3000? (y/n)

Command picker (same lockfile logic as Step 5):

| Lockfile | Command |
|---|---|
| `yarn.lock` | `yarn dev` |
| `pnpm-lock.yaml` | `pnpm dev` |
| `bun.lockb` | `bun dev` |
| default | `npm run dev` |

- **Yes** → run via Bash with `run_in_background: true`. Report: "Dev server started. Open http://localhost:3000 in your browser — the announcement should appear." If a port collision occurs, surface the error and hand back without killing processes (D14 — dev server lifecycle is out of scope for auto-recovery, per `errors.md` §"Partial failure rules" rule 5).
- **No** → report: "Run `<dev command>` when you're ready; the announcement will appear at http://localhost:3000."

---

## Step 10 — Report

Emit the success block. Exact template:

```
Announcement created: "<title>"
   Slug: <slug>
   Dashboard: https://app.frigade.com/flows/<slug>
   Flow ID: <id>

SDK wired into your codebase:
   - Installed @frigade/react (via <pm>)
   - Added <Frigade.Provider> to <provider-file-path>
   - Mounted <Frigade.Announcement flowId="<slug>" /> in <mount-file-path>

Public env var: NEXT_PUBLIC_FRIGADE_API_KEY (in .env.local, gitignored)

Open http://localhost:3000 and the announcement should appear.
To clear state and see it again, ask me: "reset user <userId> on flow <slug>".
```

If the primary CTA was flagged as "starts another flow" (see Step 1 dogfood note), **add this follow-up** line:

```
NEXT: the primaryButton "<primaryButton.title>" needs to be wired to a tour.
  1. Create the tour:  `recipes/create-tour.md`
  2. Link the CTA:     `recipes/link-flows.md`
After running (1) and (2), the "<primaryButton.title>" button will start your tour on click.
```

Log the `create-announcement:success` event to `.frigade/skill.log` with operation name, flow id/slug, files touched. Redact the `Authorization` header and any raw keys.

---

## Partial-failure handling (D16)

Use the template below **verbatim** when any step between 3 and 7 fails. This is the canonical shape from `errors.md` §"Reporting partial failures".

### Rules

1. **Frigade state is preserved.** If Step 3 succeeded and any of Steps 4–7 failed, the flow exists in Frigade. Do **not** `DELETE /v1/flows/:id` as silent recovery (per **D16** rule 4 and `errors.md` §"Partial failure rules" rule 2). Let the user decide.
2. **Code-edit batches are atomic.** Steps 6–7 (and the parts of Step 8 that touch files) form one atomic batch. Snapshot every file before its first edit; if any edit in the batch fails, revert all file edits in the batch to their pre-batch state. Package installs (Step 5) are NOT rolled back — they're cheap to keep and safe (adding `@frigade/react` to `package.json` breaks nothing).
3. **Idempotency on retry.** A follow-up "retry code wiring only" invocation re-runs the Step 1 slug existence check (the flow should still exist), skips Steps 3 and 5 (already complete), and re-reads file state from disk before re-attempting Steps 6–7. Do NOT trust a stale before-state cache.
4. **Never destructive without confirmation.** The recovery offer includes a `DELETE /v1/flows/<id>` option only as an explicit choice, and the skill emits the canonical `Flow delete` confirmation from `operations.md` before acting.
5. **Log everything.** Append a `create-announcement:partial-failure` event to `.frigade/skill.log` with step number, operation, failure reason, files rolled back, and user-facing recovery options offered.

### Report template (concrete)

```
Completed:
 Created flow: <slug> (id: <numeric-id>) — https://app.frigade.com/flows/<slug>
 Installed @frigade/react via <pm>

Failed at step <N> of 10:
 Could not <operation>
   Reason: <specific cause — e.g. "app/layout.tsx was modified externally between my read and write (mtime changed)" or "Edit failed: unique old_string not found">
   Rolled back: <list of files whose edits were reverted, or "no file edits persisted in this batch">.
   Preserved (not rolled back): <package installs, .env.local changes — each is cheap/safe to keep>.

Upstream state preserved:
- The flow <slug> exists in Frigade <env>. No action has been taken on it.

Recovery options:
  1. Retry code wiring only (I'll re-read file state and resume from step <N>; the flow won't be re-created).
  2. Delete the created flow (I'll call DELETE /v1/flows/<id> after the canonical confirmation, then re-run this recipe from scratch).
  3. Leave things as they are — the flow exists server-side but isn't mounted in your app. You can wire it manually later, or remove it from the dashboard.

Which would you like? (1/2/3)
```

All three options must be offered; (3) is always available per `errors.md` §"Reporting partial failures" required fields.

---

## Worked example — Eric's dogfood loop

**User prompt:**
> "Build me a welcome announcement — 'Welcome to my product' with some copy and a placeholder image — with a 'Take a tour' CTA that launches a 3-4 step product tour around the app."

**Claude's execution (condensed):**

**Step 1 — parse:**
- `title = "Welcome to my product"` (from quoted substring)
- `body = "Get started in a few clicks"` (user said "some copy" without specifics → default + flag for user to replace)
- `media.url = "https://placehold.co/600x400?text=Welcome"` (user said "placeholder image" → default; flag "swap for your brand image")
- `primaryButton = { title: "Take a tour", action: "false" }` (user said "Take a tour" → cross-flow CTA; `action: false` per D12 revised; record target-tour hint for Task 18 / `recipes/link-flows.md`)
- `secondaryButton = { title: "Maybe later", action: "flow.skip" }` (default)
- `slug = "welcome-to-my-product"` (kebab-cased title)
- `name = "Welcome to my product"` (default to title)
- `environment = "dev"` (no prod indicator in the prompt)

Slug collision check: `GET /v1/flows/welcome-to-my-product` → `404` → slug is free.

**Step 2 — build YAML:**

```yaml
steps:
  - id: welcome-step
    title: "Welcome to my product"
    subtitle: |
      Get started in a few clicks
    imageUri: "https://placehold.co/600x400?text=Welcome"
    primaryButton:
      title: "Take a tour"
      action: false
    secondaryButton:
      title: "Maybe later"
      action: flow.skip
```

Lint: `yaml.safe_load(...)` → parses clean.

**Step 3 — `POST /v1/flows`:**

```bash
BODY=$(jq -n \
  --arg slug "welcome-to-my-product" \
  --arg name "Welcome to my product" \
  --arg data "$YAML_STRING" \
  '{slug:$slug, name:$name, type:"ANNOUNCEMENT", data:$data, active:true}')

curl -sS -X POST "https://api3.frigade.com/v1/flows" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d "$BODY"
```

→ `201 Created`, response `{ "id": 12345, "slug": "welcome-to-my-product", "type": "ANNOUNCEMENT", ... }`.

**Step 4 — framework detection:**

`Glob` finds `app/layout.tsx` and `next.config.ts`; no `pages/_app.tsx`. → **App Router** path (`reference/next-app-router.md`).

**Step 5 — install:**

Only `package-lock.json` found → `npm install @frigade/react`. Runs in background, completes cleanly.

**Step 6 — provider wiring:**

Snapshot `app/layout.tsx` (exists). `app/providers.tsx` does not exist → `Write` the full router-aware template. `Edit` `app/layout.tsx` to import `Providers` and wrap `{children}`.

**Step 7 — mount announcement:**

`Write` `app/app-flows.tsx` (new file) with `'use client'` + `<Frigade.Announcement flowId="welcome-to-my-product" />`. `Edit` `app/layout.tsx` to render `<AppFlows />` inside `<Providers>`, before `{children}`.

**Step 8 — env check:**

`.env.local` already has `NEXT_PUBLIC_FRIGADE_API_KEY` + `FRIGADE_API_KEY_SECRET` from `first-run-setup.md`. No edits needed.

**Step 9 — dev server:**

Ask: "Start the dev server now (`npm run dev`)? (y/n)". User: `y`. Run `npm run dev` in background. Report: "Open http://localhost:3000."

**Step 10 — report:**

```
Announcement created: "Welcome to my product"
   Slug: welcome-to-my-product
   Dashboard: https://app.frigade.com/flows/welcome-to-my-product
   Flow ID: 12345

SDK wired into your codebase:
   - Installed @frigade/react (via npm)
   - Added <Frigade.Provider> to app/providers.tsx
   - Mounted <Frigade.Announcement flowId="welcome-to-my-product" /> in app/app-flows.tsx (rendered from app/layout.tsx)

Public env var: NEXT_PUBLIC_FRIGADE_API_KEY (in .env.local, gitignored)

Open http://localhost:3000 and the announcement should appear.
To clear state and see it again, ask me: "reset user <userId> on flow welcome-to-my-product".

NEXT: the primaryButton "Take a tour" needs to be wired to a tour.
  1. Create the tour:  `recipes/create-tour.md`
  2. Link the CTA:     `recipes/link-flows.md`
After running (1) and (2), the "Take a tour" button will start your tour on click.
```

That NEXT block is what routes Eric's dogfood loop into Task 17 (create-tour) and Task 18 (link-flows). This recipe's job is done.
