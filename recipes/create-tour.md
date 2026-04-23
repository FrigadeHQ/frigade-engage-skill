# Recipe: Create Tour

**End-to-end create-a-tour recipe.** Takes the user's intent ("build a 3-step product tour around the app"), resolves DOM anchors in the host codebase (adding minimal attributes where needed), creates the TOUR flow in Frigade, then installs / verifies `@frigade/react`, wires the `<Frigade.Provider>`, and mounts `<Frigade.Tour>` in the framework-appropriate location. On partial failure (per **D16**), Frigade-side state is preserved and code-edit batches are rolled back atomically.

Structurally parallel to `recipes/create-announcement.md` (commit `5772a24`) — read that first; this recipe deliberately does NOT duplicate the shared scaffolding (framework detection, SDK install, provider wiring, `.env.local` hygiene, dev-server prompt, partial-failure template). It only documents the tour-specific deltas.

Referenced decisions: **D02** (full dashboard parity), **D04** (end-to-end wiring), **D07** (public key only in client code), **D09/D23/D26** (per-env safety tags per `operations.md`), **D12 revised** (cross-flow CTAs are React handlers — same rule as announcement), **D14** (ask before starting dev server), **D15** (single batch confirmation when adding DOM anchors — one prompt per flow, not per step), **D16** (atomic code edits, preserved Frigade state on partial failure), **D17** (log to `.frigade/skill.log`), **D21** (`.gitignore` hygiene), **D27** (no `GET /v1/me`), **D28** (403 = bad key, 401 = ownership).

Companion refs:
- `recipes/create-announcement.md` — **structural template** for the create half of this recipe. Step 4 (flow create), Step 5 (framework detection), Step 6 (install), Step 7 (provider mount), Step 10 (env hygiene), Step 11 (dev server), and the partial-failure template are all inherited from there. Do not duplicate that content; cross-reference and only note tour-specific deltas.
- `recipes/first-run-setup.md` — pre-condition state check.
- `reference/yaml-spec.md` §TOUR — `selector` / `placement` / step `primaryButton` shape, anchor conventions (`#frigade-anchor-<slug>`, `[data-frigade-anchor="<slug>"]`), "behavior if selector doesn't match" (silently skipped) rule.
- `reference/sdk-react.md` §`<Frigade.Tour>` — `TourProps` table (`spotlight`, `modal`, `sequential`, `defaultOpen`, `side`/`align`/`sideOffset`/`alignOffset`, `autoScroll`, `lockScroll`, `container`).
- `reference/rest-endpoints.md` — `POST /v1/flows` contract.
- `reference/next-app-router.md` §"Mounting flows" — page-specific tour example (split `'use client'` component under `app/<route>/page.tsx`).
- `reference/next-pages-router.md` §"Mounting flows" — tour mount template for Pages Router.
- `reference/operations.md` — `createFlow` safety row (dev: safe; prod: dangerous) + canonical prod confirmation template.
- `reference/errors.md` — REST failure handling (§401/403/404/409/422/429/5xx) + "Reporting partial failures" template.
- `recipes/link-flows.md` (Task 18) — wire an Announcement's "Take a tour" CTA to call `tour?.restart()` on the tour authored by this recipe.

---

## Pre-conditions

Same as `recipes/create-announcement.md` §Pre-conditions:

1. `first-run-setup.md` Section 1 passed — `.frigade/project.json` marker present and `.env.local` keys verify.
2. `FRIGADE_API_KEY_SECRET` exported into the shell the `curl` call in Step 4 runs in (e.g. `set -a; source .env.local; set +a`). Never paste the raw key into a tool-call argument.
3. Framework detection (Step 5) succeeds; otherwise the code-emission half halts and reports "flow is live in Frigade but not wired into this codebase."

If any of those fail, route to `first-run-setup.md` (which returns silently on success) and re-enter this recipe.

---

## Step 1 — Gather inputs

Parse the triggering prompt. A tour has a single flow-level envelope plus ≥ 2 steps; most of the complexity is per-step.

### Flow-level inputs

| Input | Type | Required | How to resolve |
|---|---|---|---|
| `tourName` | `string` | **yes** | Extract from prompt ("3-step product tour", "welcome tour", etc.). Default if the user gave no label: `"Product tour"`. |
| `slug` | `string` | **yes** (derived) | Kebab-case of `tourName`; lowercase, strip non-alphanumerics (e.g. `"Product tour"` → `product-tour`, `"3-step product tour"` → `3-step-product-tour`). Then run the collision check below. |
| `name` | `string` | no | Dashboard-facing name; default to `tourName`. |
| `environment` | `"dev" \| "prod"` | no | Default `dev`. If the user said "in prod"/"production"/"live", set `prod` and apply the prod confirmation wrapper in Step 4. |
| `spotlight` | `boolean` | no | Default `false`. If the user said "spotlight" or "highlight the element", set `true` — wired via the `spotlight` React prop on `<Frigade.Tour>` (per `sdk-react.md` §`<Frigade.Tour>`). |
| `modal` | `boolean` | no | Default `false`. Set `true` if the user said "modal tour" or "block interaction during the tour" (renders an overlay scrim behind the tooltip). |

### Per-step inputs (array; **≥ 2 required** — a 1-step "tour" should route to `recipes/create-hint.md` instead)

Each step has:

| Input | Type | Required | How to resolve |
|---|---|---|---|
| `id` | `string` | **yes** | Kebab-case, stable. Prefer descriptive over ordinal (`step-sidebar`, `step-create-button`, `step-settings`) — `id` is referenced by `user.flowStepData(...)` and analytics, per `yaml-spec.md` §"Step `id` immutability". Ordinal (`step-1`, `step-2`) is OK but avoid if the target is meaningful. |
| `title` | `string` | **yes** | Short (≤ 60 chars). Tour steps are tooltips; long titles wrap awkwardly. |
| `body` | `string` | no | Maps to YAML `subtitle` (not `body` — see `yaml-spec.md` §"Step structure"). 1–2 sentences. HTML whitelist tags (`<a>`, `<b>`, etc.) permitted — see `yaml-spec.md` §"HTML in string fields". |
| `target` | `string` | **yes** | Either a **human description** ("sidebar", "create button", "settings link") OR a **CSS selector** (`#dashboard-nav`, `[data-test-id="create-btn"]`). Human descriptions trigger Step 2's anchor resolution; pre-formed CSS selectors skip it (but Claude still sanity-checks that the selector matches something in the codebase). |
| `placement` | `"top" \| "right" \| "bottom" \| "left" \| "auto"` | no | Default `auto`. Note: the YAML field is `props.side` under the step `props` block (per `yaml-spec.md` §TOUR fields), NOT a top-level `placement` key. `auto` means: don't emit a `props.side`; let Frigade's Floating-UI positioning pick. See "Field-name note" below. |
| `primaryButton` | `{ title, action }` | no | Defaults: `{ title: "Next", action: "flow.forward" }` on non-last steps; `{ title: "Got it", action: "flow.complete" }` on the last step. Both are valid `action` enum values per `yaml-spec.md` §"CTA `action` enum". Omit `primaryButton.title` entirely if the user wants anchor-driven progression (click the anchored element to advance — pair with `completionCriteria`; see `yaml-spec.md` §"Hiding the CTA"). |
| `secondaryButton` | `{ title, action }` | no | Optional. Sensible default when present: `{ title: "Skip", action: "flow.skip" }`. Omit entirely if the user didn't ask for one. |
| `imageUri` | `string` | no | Optional per-step image above the tooltip body. HTTPS URL (per `yaml-spec.md` §"Media / images"). Rare in tours — most tours are anchored-tooltip-only. |

### Disambiguation when the user gave a step count but not details

If the prompt is "3-step tour" / "4-step product tour" but didn't describe what each step points at:

- **Scan the host codebase** for candidate anchors (Step 2 logic, but used here for proposal only). Typical targets in a bare-bones Next.js app: a sidebar `<aside>`/`<nav>`, a top-right settings icon, a "New"/"Create" button, the main content area heading.
- **Propose a plan and ask for confirmation** — one consolidated prompt, not per-step:

  > Based on your codebase I can build a 3-step tour:
  > 1. **step-sidebar** — "Your main navigation" — anchored to `<aside>` in `app/components/Sidebar.tsx`
  > 2. **step-create** — "Create your first item" — anchored to the `<button>New</button>` in `Sidebar.tsx`
  > 3. **step-settings** — "Configure your workspace" — anchored to the `<Link href="/settings">` in `Header.tsx`
  >
  > Look good, or would you like to adjust titles / targets / order? (y = go, or type changes)

  On `y` → proceed to Step 2. On changes → apply them and re-confirm. This mirrors how the create-announcement recipe handles a "some copy" default by proposing a fallback and flagging it.

### Slug collision check

Identical mechanics to `recipes/create-announcement.md` §"Slug collision check". Curl `GET /v1/flows/<slug>` with `Authorization: Bearer $FRIGADE_API_KEY_SECRET` — 404 means free, 200 means taken (append `-2`, `-3`, … or offer update-instead-of-create or abort). Do not silently reuse an existing flow.

### Field-name note (common trap)

Authoritative field names per `yaml-spec.md` §"Step structure":

- Body text → `subtitle`, NOT `body`.
- Anchor selector → `selector`, a top-level step field (NOT `anchor`, NOT `target`).
- Placement side → `props.side`, inside the step's `props` block. NOT top-level `placement` / `side`.
- Alignment → `props.align`; offsets → `props.sideOffset` / `props.alignOffset`.
- Per-step dismissibility → `props.dismissible`.

The skill's **input** shape uses the user-friendly names (`target`, `placement`, `body`) documented above — those are translated into the canonical YAML field names in Step 3. Don't emit `target:`, `placement:`, or `body:` keys to the YAML.

### Cross-flow CTA note (Eric's dogfood loop)

If the user's prompt says "…and when the announcement's 'Take a tour' button is clicked, it opens this tour," **that's a linkage job for `recipes/link-flows.md`** (Task 18). Do NOT try to express it in this tour's YAML — per **D12 revised** (same rule that applies to announcements), there is no `action: flow.start:<other-slug>` enum value.

This recipe focuses on authoring the tour. The link is wired later by `recipes/link-flows.md`, which reads the tour's slug and the announcement's flow id and emits an `onPrimary` handler on the announcement component that calls `tour?.restart()`. The worked example below reflects that handoff.

---

## Step 2 — Anchor resolution (the tour-specific deltas)

For each step whose `target` is a **human description** (not already a CSS selector), resolve it to an actual DOM element in the host codebase. On paper this is grep + a small amount of JSX reading.

### 2.1 — Search for an existing element

For each human-described target, run searches in increasing breadth:

```bash
# 1. Aria-label / role / visible text (most specific; rarely brittle).
grep -rnE 'aria-label="(sidebar|main nav(igation)?)"' src app components 2>/dev/null | head
grep -rnE 'role="(navigation|complementary)"' src app components 2>/dev/null | head

# 2. Existing id / data-test-id / data-testid attributes.
grep -rnE 'id="[^"]*(sidebar|main-?nav)[^"]*"' src app components 2>/dev/null | head
grep -rnE 'data-(test-?id|cy|testid)="[^"]*(sidebar|main-?nav)[^"]*"' src app components 2>/dev/null | head

# 3. Semantic element tags (least specific; walk JSX manually to confirm).
grep -rnE '<(aside|nav|header|footer)\b' src app components 2>/dev/null | head

# 4. className or component name heuristics.
grep -rnE 'className="[^"]*sidebar[^"]*"|function Sidebar\b|export function Sidebar\b' src app components 2>/dev/null | head
```

Adjust the search terms to the user's description ("create button" → `button[^>]*>(\s*)(Create|New)`, "settings link" → `href="/settings"|aria-label="Settings"`, etc.).

### 2.2 — Pick a selector, preferring stable attributes

When a match is found, emit a selector using this precedence (most stable first):

1. **`#<id>`** — if the element already has a non-generated `id`. Unique by HTML spec, stable across CSS refactors. (Accepts Next.js App Router generated section ids too, but those are typically random — prefer a human-meaningful id.)
2. **`[data-test-id="<value>"]`** / `[data-testid="<value>"]` / `[data-cy="<value>"]` — existing test-hook attributes. Usually owned by the product's QA stance and unlikely to change without notice.
3. **`[aria-label="<value>"]`** — semantic, accessibility-driven, stable.
4. **`[data-frigade-anchor="<slug>"]`** — Frigade's own attribute convention (`yaml-spec.md` §"Anchor conventions"). **Prefer this when adding a new anchor** rather than inventing a new `id` (fewer collision risks with app-owned ids).
5. **Element + class combo** — e.g. `aside.sidebar`. Brittle if class names change; use only when nothing else works and the class name looks semantic (not a hashed CSS-module name like `.Sidebar_root_a8fb2`).
6. **Last resort:** `nth-child` / parent chains. Actively avoid — these break on DOM re-orderings. If the only stable match is via `nth-child`, prefer adding a `data-frigade-anchor` attribute instead.

### 2.3 — Handle zero / ambiguous matches by proposing a new anchor

If step 2.1 returns zero matches, or if multiple candidates are all equally plausible and Claude can't pick confidently, **propose adding a `data-frigade-anchor="<slug>"` attribute** to the right element. Default convention per `yaml-spec.md` §"Anchor conventions":

```tsx
// Before
<aside className="sidebar">

// After (single attribute added; nothing else changes)
<aside className="sidebar" data-frigade-anchor="sidebar">
```

Then the step's `selector` becomes `[data-frigade-anchor="sidebar"]`.

**Why `data-frigade-anchor` and not `id`?**
- **Doesn't collide** with app-owned ids (if a developer later adds `id="sidebar"` to a different element, the tour still works).
- **Semantically labeled** — a reader sees `data-frigade-anchor` and immediately knows it's a Frigade hook, not a hashed CSS class or random test id.
- **Namespaced** — `data-frigade-*` is unambiguously a Frigade skill addition, which makes future cleanup trivial (`grep -r 'data-frigade-anchor' app/`).

For each proposed addition, pick the **slug** by kebab-casing the step's target description: "create button" → `create-button`, "settings link" → `settings`, "sidebar" → `sidebar`. Ensure slug uniqueness across the tour's anchors (append `-2` if a collision).

### 2.4 — Batch all proposed anchor additions, confirm ONCE (D15)

**Do NOT ask per step.** Per **D15** (single batch confirmation when adding DOM anchors, one ask per flow not per step), collect every proposed addition, render them as a single list, and ask one confirmation:

> I'll add these anchor attributes so the tour can target elements:
>
>   1. `app/components/Sidebar.tsx:12` — add `data-frigade-anchor="sidebar"` to the `<aside>` element
>   2. `app/components/Sidebar.tsx:22` — add `data-frigade-anchor="create-button"` to `<button>New</button>`
>   3. `app/components/Header.tsx:30` — add `data-frigade-anchor="settings"` to `<Link href="/settings">`
>
> Proceed? (y/n)

- **On `y`** → proceed. Edits happen in Step 9 (code-emission phase), not here — we only confirm intent now.
- **On `n`** → abort creation. Do NOT POST the flow to Frigade. Report to user: "Aborted before creating the tour. Tell me which anchors you'd like to use instead and I'll try again."
- **If the user proposes changes** (e.g. "use `data-frigade-anchor='nav'` instead of `'sidebar'`"), apply the changes to the plan and re-confirm with an updated list.

Steps whose `target` was already a CSS selector (skipping anchor resolution) are still **verified** — Claude greps the codebase to confirm at least one matching element exists. If zero matches found for a user-supplied selector, surface: "Selector `<selector>` didn't match anything in the codebase. Did you mean one of: `<candidates>`?" Don't silently ship a selector that will resolve to zero elements at render time (tours silently skip those steps — see `yaml-spec.md` §TOUR "Behavior if selector doesn't match").

### 2.5 — No anchors needed (pre-formed selectors, all verified)

If all steps came with pre-formed CSS selectors and all resolve, skip the batch confirmation (nothing to confirm). Proceed directly to Step 3. Log to `.frigade/skill.log`: `"create-tour:anchors resolved — no new attributes needed"`.

---

## Step 3 — Build the YAML

Construct the `data` YAML per `yaml-spec.md` §TOUR. Canonical TOUR template (3-step, aligned with `demo-v2`'s `TOUR_FLOW_ID` and the dashboard's default Tour template):

```yaml
steps:
  - id: step-sidebar
    title: "Your main navigation"
    subtitle: |
      Click items here to explore the app.
    selector: "[data-frigade-anchor='sidebar']"
    props:
      side: right
    primaryButton:
      title: "Next"
      action: flow.forward
  - id: step-create
    title: "Create your first item"
    subtitle: |
      Use this button to create a new item.
    selector: "[data-frigade-anchor='create-button']"
    props:
      side: bottom
    primaryButton:
      title: "Next"
      action: flow.forward
  - id: step-settings
    title: "Configure your workspace"
    subtitle: |
      Open Settings to customize your workspace.
    selector: "[data-frigade-anchor='settings']"
    props:
      side: left
    primaryButton:
      title: "Got it"
      action: flow.complete
```

### Translation rules (user inputs → YAML)

| User-facing input (Step 1) | YAML emission |
|---|---|
| `id` | `steps[].id` |
| `title` | `steps[].title` |
| `body` | `steps[].subtitle` (**renamed**; not `body`) |
| `target` (CSS selector, direct or derived via Step 2) | `steps[].selector` |
| `placement: "auto"` | **omit** `props.side` entirely (let Floating-UI pick). Don't emit `side: auto` — that's not a valid value. |
| `placement: "top" \| "right" \| "bottom" \| "left"` | `steps[].props.side: <value>` |
| `primaryButton.title / .action` | `steps[].primaryButton.title / .action` (identical shape) |
| `secondaryButton.title / .action` | `steps[].secondaryButton.title / .action` |
| `imageUri` | `steps[].imageUri` |

### Button defaults

- **Last step's `primaryButton.action`** → `flow.complete` (not `step.complete`, which would just complete the last step but not formally mark the flow complete; `flow.complete` does both). Verified against `yaml-spec.md` §"CTA `action` enum".
- **Non-last steps' `primaryButton.action`** → `flow.forward` (moves forward without completing the current step — useful if a later step might branch back via `flow.back`). Alternative: `step.complete` (the default; advances identically for non-last steps). Either works; this recipe defaults to `flow.forward` for clarity.
- **Hiding the Next button** — omit `primaryButton.title` entirely (per `yaml-spec.md` §"Hiding the CTA"). Use for anchor-click-driven progression (pair with a `completionCriteria` or an in-product `step.complete()` call).

### Flow-level `props`

If the user asked for a dismissible tour, emit the dismissible flag at flow-level — NOT per-step — unless the user specifically asked for per-step control:

```yaml
props:
  dismissible: true
steps:
  - id: step-1
    ...
```

`props.dismissible: true` is supported flow-wide and per step (`yaml-spec.md` §"Common top-level structure" and §TOUR fields table). Prefer flow-wide for simpler YAML.

### Lint before POSTing

Same rule as `recipes/create-announcement.md` Step 2: run a local YAML parse sanity check (`python3 -c "import yaml,sys; yaml.safe_load(sys.stdin.read())"` piping in `$YAML_STRING`, or `node -e "require('js-yaml').load(require('fs').readFileSync('/dev/stdin','utf8'))"`) to catch indentation errors before the API call. Server-side YAML parse errors surface as 422 (see `errors.md` §422).

---

## Step 4 — Create the flow (API call)

Identical to `recipes/create-announcement.md` Step 3, with **one change**: `type: TOUR` instead of `type: ANNOUNCEMENT`.

**Prod confirmation gate (D09).** If `environment == "prod"`, per the `operations.md` `createFlow` safety row, emit the canonical prompt:

> About to create flow '<slug>' in prod. This affects live flow state. Confirm? (y/n)

(Dev skips this — `createFlow` is `safe` in dev per `operations.md`.)

**Curl template:**

```bash
BODY=$(jq -n \
  --arg slug "$SLUG" \
  --arg name "$NAME" \
  --arg data "$YAML_STRING" \
  '{slug: $slug, name: $name, type: "TOUR", data: $data, active: true}')

curl -sS -X POST "https://api3.frigade.com/v1/flows/" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  -w "\n---HTTP_STATUS:%{http_code}---\n"
```

(`$FRIGADE_API_KEY_SECRET_PROD` when `environment == "prod"`.)

### Response handling

Same response matrix as `recipes/create-announcement.md` Step 3 — see that table for the full status-code handling (201 / 400 / 401 / 403 / 422 / 429 / 5xx) per `errors.md`.

On success, extract `id` (numeric) and `slug` (server-accepted — may differ from client-sent if the server auto-rewrote a malformed slug). Dashboard URL: `https://app.frigade.com/flows/<slug>`. Log to `.frigade/skill.log` with Authorization header redacted.

**Important:** If Step 4 succeeds and any of Steps 5–9 later fails, the flow exists upstream; do **NOT** `DELETE /v1/flows/:id` as silent recovery — per `errors.md` §"Partial failure rules" and **D16**. Offer the standard 3-option recovery (retry wiring / delete + restart / leave as-is) in the partial-failure report.

---

## Step 5 — Framework detection

Same as `recipes/create-announcement.md` Step 4. Dispatch:

| Signal | Path |
|---|---|
| `next.config.*` + `app/layout.*` (App Router) | `reference/next-app-router.md` |
| `next.config.*` + `pages/_app.*` (Pages Router) | `reference/next-pages-router.md` |
| Hybrid (both present) | Ask which router to mount under; default App Router. For a page-scoped tour, pick the router that owns the page with the anchored elements. |
| Vite / CRA (plain React) | Inline template from `create-announcement.md` §"Plain-React … inline template" |
| Remix / Svelte / Vue / Nuxt / Astro | Unsupported — halt code-emission half, report "flow is live in Frigade but I don't know how to wire it into <framework>." |

**Monorepo.** Same rule: pick the app whose `package.json` has `next` (or matching framework) as a dep; wire into that app's directory. `.env.local` lives next to the app's `package.json`.

---

## Step 6 — Install `@frigade/react`

Same as `recipes/create-announcement.md` Step 5. Lockfile-driven package manager selection (yarn / pnpm / bun / npm). Run in background (`run_in_background: true`). On failure, surface stderr and halt — do NOT proceed to Steps 7–9. Idempotent if already installed.

---

## Step 7 — Ensure `<Frigade.Provider>` is mounted

Same as `recipes/create-announcement.md` Step 6. Create or edit `app/providers.tsx` (App Router) or `components/providers.tsx` (Pages Router) using the router-aware `navigate` template. Preserve existing auth/theme providers in canonical order.

**Idempotency with the announcement recipe.** If the user already ran `recipes/create-announcement.md` in this project, the provider is already mounted — detect it (`<Frigade.Provider>` visible in `providers.tsx`) and skip this step. Tours re-use the same Provider as announcements; one Provider per app.

---

## Step 8 — Mount the `<Frigade.Tour>` component

This is the step that materially differs from `<Frigade.Announcement>` mounting. Key deltas:

### Delta 1 — Mount location depends on anchor scope

Tours are anchored to DOM elements. The `<Frigade.Tour>` component itself can live anywhere inside the Provider tree — but the anchored elements must be rendered on the same page(s) the tour runs on.

| Anchor scope | Mount location |
|---|---|
| All anchors are on a single route (e.g. anchors only exist on `/dashboard`) | **Page-scoped:** mount inside that route's `page.tsx` (App Router) or `pages/<route>.tsx` (Pages Router). See `reference/next-app-router.md` §"Mounting flows" Example — tour on a specific page. |
| Anchors span multiple routes but share a layout (e.g. sidebar + header anchors visible on every app route) | **Layout-scoped:** mount in the shared layout (`app/layout.tsx` or `app/(app)/layout.tsx` for a route group, or `pages/_app.tsx` for Pages Router). |
| Anchors are in the root layout (sidebar/header of the whole app) | **App-wide:** mount in `app/layout.tsx` / `pages/_app.tsx`, same scope as an app-wide announcement. |

Defaulting rule when the anchor scope is ambiguous: **mount in the shared layout** that contains all anchored elements. If that's the root layout (common for bare-bones Next.js apps where the anchors are in the Header and Sidebar components rendered globally), mount in `app/layout.tsx` / `pages/_app.tsx`.

### Delta 2 — App Router requires a `'use client'` boundary (same as Announcement)

`<Frigade.Tour>` is a client-only component (touches `document.querySelector`, portals, Emotion CSS). In App Router, wrap it in a small `'use client'` component. Per `reference/next-app-router.md` §"Mounting flows" Example (the tour-specific snippet):

```tsx
// app/app-flows.tsx  — ADD <Tour> alongside any existing <Announcement>.
'use client';

import * as Frigade from '@frigade/react';

export function AppFlows() {
  return (
    <>
      {/* existing <Frigade.Announcement flowId="..." /> stays if present */}
      <Frigade.Tour flowId="<slug>" />
    </>
  );
}
```

```tsx
// app/layout.tsx — already imports <AppFlows /> if the Announcement recipe ran.
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

**If `app-flows.tsx` already exists** (from `create-announcement.md`), `Edit` the existing file to add `<Frigade.Tour flowId="<slug>" />` alongside the existing component — don't create a duplicate file. Preserve existing imports and components.

### Delta 3 — Pages Router — no `'use client'` needed

Pages Router pages are client-rendered by default (per `reference/next-pages-router.md`). For an app-wide tour, mount inside `<Providers>` in `pages/_app.tsx`:

```tsx
<Providers>
  <Frigade.Announcement flowId="<announcement-slug>" />   {/* if the announcement recipe ran */}
  <Frigade.Tour flowId="<slug>" />
  <Component {...pageProps} />
</Providers>
```

For a page-specific tour, mount directly in the route's page file — no extra boundary:

```tsx
// pages/dashboard.tsx
import * as Frigade from '@frigade/react';

export default function DashboardPage() {
  return (
    <main>
      {/* ...dashboard content with anchored elements... */}
      <Frigade.Tour flowId="<slug>" />
    </main>
  );
}
```

### Delta 4 — Tour component props to surface

Some `TourProps` the recipe may emit based on Step 1 inputs (from `reference/sdk-react.md` §`<Frigade.Tour>`):

| React prop | When to emit |
|---|---|
| `spotlight` | When the user asked for spotlight/highlight on anchored elements. Default off. |
| `modal` | When the user asked for "modal tour" / "block interaction." Renders an overlay scrim behind the tooltip. Default off. |
| `sequential` | Defaults `true`. **Don't emit `false`** here — a non-sequential tour is a Hint; route to `recipes/create-hint.md` (forthcoming) instead. |
| `defaultOpen` | Defaults `true`. Leave unset. |
| `dismissible` | Surface only if the flow YAML didn't already set `props.dismissible`. Otherwise the YAML wins. |
| `autoScroll` | Defaults on. Set `false` only when the user specifically doesn't want anchor auto-scroll (rare). |
| `onPrimary` / `onSecondary` | **Leave unset here.** These are where `recipes/link-flows.md` hooks cross-flow actions. Emitting them in this recipe would conflict with Task 18's output. |

Example emission when the user asked for a spotlight tour:

```tsx
<Frigade.Tour flowId="<slug>" spotlight />
```

### Delta 5 — `defaultCollection` interaction

Unlike announcements, tours are **not** auto-rendered by the Provider's built-in `defaultCollection` (the default Collection renders modal/floating flows like announcements, banners, cards — not tours, which need DOM anchors). You **must** emit the explicit `<Frigade.Tour flowId="<slug>" />` tag; there's no implicit rendering to fall back on.

This is the biggest Tour-vs-Announcement mounting asymmetry: an announcement *can* omit the explicit tag (rely on `defaultCollection`), a tour cannot.

---

## Step 9 — Apply anchor edits (if any from Step 2.4)

If Step 2.4 confirmed a batch of anchor additions, **apply them now** — not in Step 2. This keeps all file-edit side effects in the code-emission phase and lets us roll back atomically (per **D16**) if Step 7 or Step 8 fails.

### 9.1 — Snapshot first

Before any `Edit`, snapshot every target file's current content:

```
snapshots = {
  "app/components/Sidebar.tsx": <full file contents, pre-edit>,
  "app/components/Header.tsx": <full file contents, pre-edit>,
}
```

### 9.2 — Apply edits sequentially, but treat the batch as atomic

For each proposed addition from Step 2.4, run an `Edit` that inserts the attribute on the specific line. Use tight, uniquely-matching `old_string`s (the full opening tag with surrounding context if needed) — avoid `replace_all` here, each anchor addition is a surgical one-line change:

```
# Example Edit arguments:
old_string: '<aside className="sidebar">'
new_string: '<aside className="sidebar" data-frigade-anchor="sidebar">'
```

If any `Edit` fails (non-unique `old_string`, file-locked, external mtime change), **stop the batch and revert every already-applied anchor edit** using the snapshots from 9.1 — per **D16** rule 2 (code-edit batches are atomic). Surface the failure in the partial-failure report.

### 9.3 — Scope of the atomic batch

Per `recipes/create-announcement.md` Step 6 intro note, **Steps 7 + 8 + 9 compose one atomic code-edit batch**. Any failure in any of them rolls back every file edit made in the batch. Package install (Step 6) is NOT rolled back — it's cheap/safe to keep.

### 9.4 — Selector-only steps (no new anchors)

If Step 2 found existing anchors for every step (no additions proposed), skip this step entirely. The YAML's `selector` values point at already-existing attributes — no code edit needed.

---

## Step 10 — Env var hygiene

Same as `recipes/create-announcement.md` Step 8. If `.env.local` already has `NEXT_PUBLIC_FRIGADE_API_KEY` matching the project's public key (from `first-run-setup.md`), leave it. Otherwise append with `Edit` (preserving existing env vars).

**Key rules (restated for emphasis):** `NEXT_PUBLIC_FRIGADE_API_KEY` belongs in the browser bundle (`api_public_...`). `FRIGADE_API_KEY_SECRET` (`api_private_...`) **must never** leave `.env.local` — not in any `.tsx`, `.ts`, `.md`, commit message, or skill log line. If this recipe ever causes the private key to appear outside `.env.local`, that's a bug.

---

## Step 11 — Ask to start the dev server (D14)

Same as `recipes/create-announcement.md` Step 9. Single yes/no prompt:

> Start the dev server now (`npm run dev` / `yarn dev` / `pnpm dev` / `bun dev`) so you can see the tour at http://localhost:3000? (y/n)

Lockfile-based command picker (same table as `create-announcement.md`). On `y`, run via Bash with `run_in_background: true`. On `n`, report the command for the user to run when ready.

**Idempotency with the announcement recipe:** if the dev server was already started by the preceding `create-announcement.md` run, no need to prompt again — report "dev server already running" and move on.

---

## Step 12 — Report

Emit the success block. Exact template:

```
Tour created: "<tourName>"
   Slug: <slug>
   Dashboard: https://app.frigade.com/flows/<slug>
   Flow ID: <id>
   Steps: <n>

<m> anchor attributes added to:
   - <file>:<line> — data-frigade-anchor="<slug>"
   - <file>:<line> — data-frigade-anchor="<slug>"
   - <file>:<line> — data-frigade-anchor="<slug>"

SDK wired into your codebase:
   - Verified @frigade/react (installed via <pm>)
   - Verified <Frigade.Provider> in <provider-file-path>
   - Mounted <Frigade.Tour flowId="<slug>" /> in <mount-file-path>

Public env var: NEXT_PUBLIC_FRIGADE_API_KEY (in .env.local, gitignored)

Open http://localhost:3000 and run the tour. If it doesn't appear, check:
  - Are you on the route where the anchors live? (scope: <mount scope>)
  - Does the tour have a completion record for your userId? Clear with "reset user <userId> on flow <slug>".
```

If the "<m> anchor attributes added" section is empty (all selectors pre-existed), replace that block with:

```
No new anchors needed — all <n> selectors matched existing elements.
```

If the user's prompt implied the tour should be started by another flow's CTA (e.g. the announcement's "Take a tour" button), add this follow-up:

```
NEXT: wire the trigger — the tour is authored but needs to be started by <triggering flow>'s "<CTA title>" button.
  Run `recipes/link-flows.md` to emit the React handler on <triggering flow slug> that calls tour.restart() when the button is clicked.
```

Log the `create-tour:success` event to `.frigade/skill.log` per **D17** with: op name, flow id/slug, number of steps, list of files touched (provider, mount, anchor files), environment. Redact the `Authorization` header and any raw keys.

---

## Partial-failure handling (D16)

Use the partial-failure template **verbatim** from `recipes/create-announcement.md` §"Partial-failure handling (D16)". Tour-specific failure points:

- **Step 2.4 (batch confirmation)** — user said `n`. No flow created, no files edited. Report "Aborted before creation"; nothing to roll back.
- **Step 4 (POST /v1/flows)** — see `errors.md` handling table. On 5xx, retry once; on persistent failure, halt. No files touched yet.
- **Steps 7 + 8 + 9 (atomic code-edit batch)** — per `create-announcement.md` Step 6 intro: snapshot all files before the batch; on any edit failure, revert all edits in the batch. Flow is preserved upstream; don't delete. Package install is preserved (cheap to keep).

### Tour-specific failure shape

If Step 9 (anchor application) fails partway through — e.g. the first anchor edit succeeds but the second file's `old_string` is no longer unique because the file was externally modified — revert every anchor edit in the batch (using the Step 9.1 snapshots), then follow the standard partial-failure template:

```
Completed:
 Created TOUR flow: <slug> (id: <id>) — https://app.frigade.com/flows/<slug>
 Verified / Installed @frigade/react via <pm>

Failed at step 9 of 12:
 Could not apply anchor edit to <file>:<line>
   Reason: <specific — e.g. "Edit's old_string was not unique; Sidebar.tsx may have been modified externally between my read and write">
   Rolled back: <n> anchor edit(s) to <files-list> — reverted to pre-batch state.
   Preserved (not rolled back): @frigade/react install; .env.local changes.

Upstream state preserved:
- The TOUR flow <slug> exists in Frigade <env>. No action has been taken on it.

Recovery options:
  1. Retry code wiring only — I'll re-read the files and re-attempt the anchor edits + mount.
  2. Delete the created tour — I'll call DELETE /v1/flows/<id> after the canonical confirmation, then re-run this recipe.
  3. Leave as-is — flow exists server-side, not mounted. You can wire it manually later.

Which would you like? (1/2/3)
```

All three options are always offered (per `errors.md` §"Reporting partial failures" required fields).

Log the `create-tour:partial-failure` event to `.frigade/skill.log`: step number, operation, failure reason, files rolled back, user-facing recovery options offered.

---

## Worked example — Eric's dogfood tour

**User's earlier ask** (see `recipes/create-announcement.md` §"Worked example"): a 3-4 step product tour around the app, launched by the announcement's "Take a tour" CTA. The announcement already exists from Task 16's worked example (`welcome-to-my-product`, primaryButton `action: false`, flagged `pending_link` in `.frigade/skill.log`).

**Claude's actions:**

1. **Assume the announcement already exists.** `.frigade/skill.log` has a `pending_link` event: `{"event":"pending_link","flow":"welcome-to-my-product","cta":"Take a tour","target":"a 3-4 step product tour"}`. This recipe fulfills the "target" half; `recipes/link-flows.md` (Task 18) closes the loop.

2. **Gather tour inputs.** Eric's bare-bones Next.js app has: a `Header` component with a logo + settings link in the top-right, a left `Sidebar` with nav + a "New" button, and a main content area. Parse from the prompt:
   - `tourName = "Welcome tour"` (defaulted from "product tour around the app")
   - `slug = "welcome-tour"` (derived)
   - `environment = "dev"`
   - `steps` count = 3 (user said "3-4"; default to 3 for a minimal viable tour — ask to confirm in Step 1)

3. **Propose a 3-step plan:**
   > Based on your codebase I can build a 3-step tour:
   > 1. **step-sidebar** — "Your main navigation" — anchored to the `<aside>` in `app/components/Sidebar.tsx:8`
   > 2. **step-create** — "Create your first item" — anchored to the `<button>New</button>` in `Sidebar.tsx:22`
   > 3. **step-settings** — "Configure your workspace" — anchored to `<Link href="/settings">` in `Header.tsx:30`
   >
   > Look good, or would you like to adjust? (y = go)

   User: `y`.

4. **Slug collision check.** `GET /v1/flows/welcome-tour` → `404`. Free.

5. **Anchor resolution (Step 2).** For each target:
   - "sidebar" → `<aside>` in `app/components/Sidebar.tsx:8`. No existing `id`; className is a hashed CSS-module name. **Propose:** add `data-frigade-anchor="sidebar"`.
   - "create button" → `<button>New</button>` in `app/components/Sidebar.tsx:22`. No existing id or test id. **Propose:** add `data-frigade-anchor="create-button"`.
   - "settings link" → `<Link href="/settings">` in `app/components/Header.tsx:30`. No existing test id. **Propose:** add `data-frigade-anchor="settings"`.

6. **Single batch confirmation (D15):**

   > I'll add these anchor attributes so the tour can target elements:
   >   1. `app/components/Sidebar.tsx:8` — add `data-frigade-anchor="sidebar"` to the `<aside>` element
   >   2. `app/components/Sidebar.tsx:22` — add `data-frigade-anchor="create-button"` to `<button>New</button>`
   >   3. `app/components/Header.tsx:30` — add `data-frigade-anchor="settings"` to `<Link href="/settings">`
   >
   > Proceed? (y/n)

   User: `y`. (No edits applied yet — confirmation only.)

7. **Build tour YAML (Step 3):**

   ```yaml
   steps:
     - id: step-sidebar
       title: "Your main navigation"
       subtitle: |
         Click items here to explore the app.
       selector: "[data-frigade-anchor='sidebar']"
       props:
         side: right
       primaryButton:
         title: "Next"
         action: flow.forward
     - id: step-create
       title: "Create your first item"
       subtitle: |
         Use this button to create a new item.
       selector: "[data-frigade-anchor='create-button']"
       props:
         side: bottom
       primaryButton:
         title: "Next"
         action: flow.forward
     - id: step-settings
       title: "Configure your workspace"
       subtitle: |
         Open Settings to customize your workspace.
       selector: "[data-frigade-anchor='settings']"
       props:
         side: left
       primaryButton:
         title: "Got it"
         action: flow.complete
   ```

   Lint: `yaml.safe_load(...)` → clean.

8. **POST /v1/flows with `type: TOUR` (Step 4):**

   ```bash
   BODY=$(jq -n \
     --arg slug "welcome-tour" \
     --arg name "Welcome tour" \
     --arg data "$YAML_STRING" \
     '{slug:$slug, name:$name, type:"TOUR", data:$data, active:true}')

   curl -sS -X POST "https://api3.frigade.com/v1/flows/" \
     -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
     -H "Content-Type: application/json" \
     -d "$BODY"
   ```

   → `201 Created`, response `{ "id": 12346, "slug": "welcome-tour", "type": "TOUR", ... }`.

9. **Framework detection (Step 5):** `app/layout.tsx` + `next.config.ts` → App Router (same as the preceding announcement run).

10. **Install check (Step 6):** `@frigade/react` already in `package.json` from the announcement recipe run. Skip.

11. **Provider check (Step 7):** `app/providers.tsx` already exists with `<Frigade.Provider>` inside (from the announcement recipe). Skip.

12. **Mount `<Frigade.Tour>` (Step 8):** anchors span the root layout (sidebar + header render on every route), so **layout-scoped** mounting. `app/app-flows.tsx` already exists from the announcement recipe with `<Frigade.Announcement flowId="welcome-to-my-product" />`. `Edit` it to also render `<Frigade.Tour flowId="welcome-tour" />`:

    ```tsx
    'use client';

    import * as Frigade from '@frigade/react';

    export function AppFlows() {
      return (
        <>
          <Frigade.Announcement flowId="welcome-to-my-product" />
          <Frigade.Tour flowId="welcome-tour" />
        </>
      );
    }
    ```

13. **Apply 3 anchor edits atomically (Step 9):**
    - Snapshot `app/components/Sidebar.tsx` + `app/components/Header.tsx`.
    - Edit Sidebar.tsx:8 — add `data-frigade-anchor="sidebar"` to `<aside>`.
    - Edit Sidebar.tsx:22 — add `data-frigade-anchor="create-button"` to `<button>`.
    - Edit Header.tsx:30 — add `data-frigade-anchor="settings"` to `<Link>`.
    - All three succeed → commit the batch (no rollback).

14. **`.env.local` check (Step 10):** already configured from the announcement recipe; skip.

15. **Dev server (Step 11):** already running from the announcement recipe (background process still alive); skip prompt, report "dev server already running."

16. **Report (Step 12):**

    ```
    Tour created: "Welcome tour"
       Slug: welcome-tour
       Dashboard: https://app.frigade.com/flows/welcome-tour
       Flow ID: 12346
       Steps: 3

    3 anchor attributes added to:
       - app/components/Sidebar.tsx:8 — data-frigade-anchor="sidebar"
       - app/components/Sidebar.tsx:22 — data-frigade-anchor="create-button"
       - app/components/Header.tsx:30 — data-frigade-anchor="settings"

    SDK wired into your codebase:
       - Verified @frigade/react (installed via npm)
       - Verified <Frigade.Provider> in app/providers.tsx
       - Mounted <Frigade.Tour flowId="welcome-tour" /> in app/app-flows.tsx (rendered from app/layout.tsx)

    Public env var: NEXT_PUBLIC_FRIGADE_API_KEY (in .env.local, gitignored)

    Open http://localhost:3000 and run the tour.

    NEXT: wire the trigger — the tour is authored but needs to be started by welcome-to-my-product's "Take a tour" button.
      Run `recipes/link-flows.md` to emit the React handler on welcome-to-my-product that calls tour.restart() when the button is clicked.
    ```

17. **Log** `create-tour:success` to `.frigade/skill.log`: op, flow id `12346`, slug `welcome-tour`, 3 steps, files touched (`app/app-flows.tsx`, `app/components/Sidebar.tsx`, `app/components/Header.tsx`), environment `dev`, Authorization redacted.

That `NEXT` block hands off to `recipes/link-flows.md` (Task 18), which reads the `welcome-to-my-product` announcement's `pending_link` event from the log and this tour's slug, and emits an `onPrimary` React handler wiring the announcement's "Take a tour" button to `tour?.restart()`. This recipe's job is done.
