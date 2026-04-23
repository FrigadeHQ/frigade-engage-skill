# Recipe: Link Flows

**Cross-flow linking recipe.** Given two flows that already exist in Frigade (source + target — typically an announcement whose CTA starts a tour), wire the source's `primary` (or `secondary`) button on the **React component** to call the target flow's `.restart()` method. This is the step that closes Eric's dogfood loop: announcement "Take a tour" CTA → starts the tour.

**Why a React handler and not YAML?** Per **D12 (revised)**, the v2 SDK's YAML `action` enum (`flow.start`, `flow.complete`, `flow.forward`, `flow.back`, `flow.restart`, `flow.skip`, `false`) operates only on the *containing* flow. There is **no** `action: flow.start:<other-slug>` or `nextFlowId` value. Cross-flow linking must be done from the React side via `onPrimary`/`onSecondary` handlers on the source flow's mounted component, which call `useFlow(<target-slug>).flow.restart()`. Confirmed in `reference/sdk-react.md` §D12 and `reference/yaml-spec.md` §"CTA `action` enum".

Referenced decisions: **D04** (end-to-end wiring), **D12 (revised)** (cross-flow linking is a React handler, not YAML), **D14** (ask before starting dev server — not applicable here; this recipe only edits code), **D15** (single batch confirmation for code edits), **D16** (atomic code-edit batch with rollback on failure), **D17** (log to `.frigade/skill.log`), **D28** (403 = bad key, 401 = ownership).

Companion refs:
- `recipes/first-run-setup.md` — pre-condition state check (Section 1).
- `recipes/create-announcement.md` (commit `5772a24`) — authors the source flow; leaves `primaryButton.action: false` and records a `pending_link` event that this recipe reads.
- `recipes/create-tour.md` (commit `12e84d6`) — authors the target flow; its closing `NEXT` block hands off here.
- `reference/sdk-react.md` §"D12 — starting a *different* flow from a CTA" — the authoritative snippet for the React handler pattern. §`useFlow` — hook contract (`{ flow: Flow | undefined; isLoading: boolean }`). §`<Frigade.Announcement>` props — `onPrimary` / `onSecondary` signatures.
- `reference/yaml-spec.md` §"CTA `action` enum" — enumerates what YAML actions *do* exist; confirms cross-flow is NOT among them.
- `reference/rest-endpoints.md` — `GET /v1/flows/<slug>` contract (this recipe uses it twice, read-only, to verify both flows exist).
- `reference/errors.md` — §404 handling (halt with pointer to the create recipe) and §"Partial failure rules" (rollback snapshot on edit failure).
- `reference/next-app-router.md` §"Mounting flows" — where `<Frigade.Announcement>` / `<Frigade.Tour>` live in an App Router project; the `'use client'` boundary rule.
- `reference/next-pages-router.md` §"Mounting flows" — same, Pages Router.

---

## Pre-conditions

1. **`first-run-setup.md` Section 1 passed.** `.frigade/project.json` marker present; `.env.local` keys verify against the marker's `workspaceId`. If not, invoke `first-run-setup.md` first — it returns silently on success. Don't proceed until that returns.
2. **Both source and target flows exist in Frigade.** Slugs for both are known. This recipe **does not create flows** — it only wires existing flows together. If either flow doesn't exist, halt and route the user to the appropriate recipe:
   - Source missing → `recipes/create-announcement.md` (for ANNOUNCEMENT), or the applicable `create-<type>.md` recipe for other source types.
   - Target missing → `recipes/create-tour.md` (for TOUR), or the applicable `create-<type>.md` recipe.
3. **Source flow's component is already mounted in the host codebase.** The create-announcement recipe (or whichever authored the source flow) has emitted a `<Frigade.Announcement flowId="<source-slug>" />` tag (or `<Frigade.Tour .../>`, `<Frigade.Checklist .../>`, etc.). This recipe locates that mount site and adds a handler; it does not create new mount sites. If the mount is absent, halt and route the user to the original create recipe's Step 7/8 (mount phase).
4. **`@frigade/react` is installed** in the host project. Confirm via `package.json`. If absent, the create-announcement / create-tour recipe's Step 5/6 installs it — route there.
5. **`FRIGADE_API_KEY_SECRET` is exported** into the shell that runs the verification `curl`s in Step 1 (e.g. `set -a; source .env.local; set +a`). Never paste the raw key into a tool-call argument.

If any pre-condition fails, halt with a clear pointer at the prerequisite recipe and do not edit any files. Log a `link-flows:precondition-failed` event to `.frigade/skill.log` per **D17**.

---

## Step 1 — Identify source, target, and CTA

Parse the triggering prompt. This recipe expects enough information to answer three questions: which flow is the source, which flow is the target, and which button on the source (primary or secondary) should trigger the target.

### 1.1 — Parse intent

Typical phrasings and their interpretations:

| Prompt shape | Source | Target | Button |
|---|---|---|---|
| "Wire the announcement's 'Take a tour' to start the tour." | `welcome-to-my-product` (the announcement) | `welcome-tour` (the tour) | `primary` (the "Take a tour" button) |
| "Link the 'Take a tour' CTA on my announcement to open the welcome tour." | announcement slug | tour slug | `primary` |
| "When the user clicks 'Skip for now' on the tour, start the checklist." | tour slug | checklist slug | `secondary` ("Skip for now" is the non-primary CTA) |
| "Connect the welcome announcement to the product tour." | announcement slug | tour slug | `primary` (default — "connect" usually implies primary CTA) |

### 1.2 — Resolve slugs

- **Source slug** — the flow whose component already renders in the host codebase. Extract from the prompt; if ambiguous, check `.frigade/skill.log` for the most recent `create-*:success` event with `pending_link: true` (the create-announcement recipe writes `pending_link` events when it leaves a CTA unwired).
- **Target slug** — the flow to be started. Extract from the prompt; if ambiguous, ask the user once: "Which flow should the button start? Give me the slug."

### 1.3 — Which button (`primary` vs `secondary`)

- Default: `primary`. Most "Take a tour" / "Get started" / "Learn more" CTAs are primary buttons.
- Set to `secondary` only when the prompt specifically mentions the secondary CTA's title or says "dismiss-then-start-tour" / "the skip button" / "the cancel button." Secondary-button cross-flow links are rare.

### 1.4 — Verify both flows exist in Frigade

Run two read-only REST calls per `reference/rest-endpoints.md` §"GET /v1/flows/:slugOrFlowId":

```bash
curl -sS -w "\n---HTTP_STATUS:%{http_code}---\n" \
  "https://api3.frigade.com/v1/flows/<source-slug>" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"

curl -sS -w "\n---HTTP_STATUS:%{http_code}---\n" \
  "https://api3.frigade.com/v1/flows/<target-slug>" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
```

Interpretation (per `reference/errors.md`):

| Status | Action |
|---|---|
| `200` (both) | Both flows exist. Proceed to Step 2. |
| `404` on source | Halt. Tell user: "Source flow `<source-slug>` doesn't exist in Frigade. Run `recipes/create-announcement.md` (or the matching create recipe for this flow type) first." |
| `404` on target | Halt. Tell user: "Target flow `<target-slug>` doesn't exist in Frigade. Run `recipes/create-tour.md` (or the matching create recipe) first." |
| `401` | Ownership/cross-env mismatch per **D28**. Halt; surface error message. |
| `403` | Bad/revoked key per **D28**. Halt; route to `first-run-setup.md` Section 2.7. |
| `5xx` / network | Retry once after 1s. If still failing, halt with timestamp in the log. |

**No write calls are made in this recipe.** Both curls above are GETs (see `reference/operations.md` — `lookupFlow` is `safe` in all environments). This recipe is purely code-side; Frigade-side state is never mutated.

### 1.5 — Log the inputs

Append to `.frigade/skill.log` (per **D17**) a `link-flows:start` event with: source slug, target slug, button side, both GET statuses. Redact the `Authorization` header.

---

## Step 2 — Locate the source component mount

Find the file + line where `<Frigade.<Type> flowId="<source-slug>" />` is rendered. This is where the handler gets added.

### 2.1 — Search

Run a grep over the host codebase's typical source roots:

```bash
grep -rnE "flowId=['\"]<source-slug>['\"]" src app components pages 2>/dev/null
```

For the bare-bones Next.js App Router project that the `create-announcement` / `create-tour` recipes produce, the mount lives in `app/app-flows.tsx`. Broaden the search if nothing matches there — some projects will have renamed the file or moved the mount into a layout group.

### 2.2 — Interpret the result

- **Exactly one hit** → record file path + line range. Proceed to Step 3.
- **Zero hits** → halt. Tell user: "Source flow `<source-slug>` isn't mounted anywhere in this codebase. Run the appropriate create recipe first, or mount `<Frigade.Announcement flowId='<source-slug>' />` manually in a client component inside the Provider tree." Log a `link-flows:mount-not-found` event.
- **Multiple hits** (rare — e.g. the same flow mounted in two different routes) → ask the user once: "Found `<source-slug>` mounted in <n> places. Which should I add the handler to? (list the files + line numbers)". Do NOT modify any of them without user choice.

### 2.3 — Read the surrounding context

Once the file path is confirmed, `Read` the full file. This is necessary for Step 3 (confirmation diff) and Step 4 (to apply the edit correctly, including `'use client'` / `useFlow` import checks).

Note three structural facts to collect from the read:

1. **Is `'use client'` present at the top of the file?** If this is Next.js App Router and the file is directly imported by a Server Component (e.g. `app/layout.tsx`), it must be. App Router adapter rules per `reference/next-app-router.md` §"Mounting flows".
2. **Is `useFlow` already imported from `@frigade/react`?** (Either `import { useFlow } from '@frigade/react'` or destructured from a `* as Frigade` namespace import — the namespace import doesn't expose hooks conveniently, so prefer the named-import form.)
3. **Is the `<Frigade.Announcement>` (or equivalent) tag inside a functional React component body, or is it in a module-level expression?** 99% of the time it's inside a functional component (Pattern A below). The 1% fallback is Pattern B — extract a tiny client wrapper component to host the hook call.

Log a `link-flows:mount-found` event to `.frigade/skill.log` with file path, line number, and the three structural facts above.

---

## Step 3 — Confirm the change (D15)

Emit a **single consolidated confirmation prompt** with the plan. This is one user-facing prompt — not a per-file ask — per **D15** (single batch confirmation for code edits). The prompt shows the exact diff the recipe will apply.

### 3.1 — Confirmation template (Pattern A — the common case)

```
Wiring: <source-slug> <button-side> CTA → start flow <target-slug>.

File to edit: <file-path>:<line>

Pre-edit structural facts:
 - 'use client' directive: <present / absent — will add if App Router>
 - `useFlow` import from '@frigade/react': <present / absent — will add if absent>
 - Mount is inside a functional component: <yes — Pattern A / no — Pattern B (wrapper)>

Change:

  <Frigade.Announcement flowId="<source-slug>" />

becomes (plus a top-of-component `const <varName> = useFlow('<target-slug>');`):

  <Frigade.Announcement
    flowId="<source-slug>"
    <handler-prop>={() => <varName>.flow?.restart()}
  />

`<handler-prop>` = onPrimary (primary CTA) or onSecondary.
`<varName>` = a short identifier derived from the target slug
  (e.g. target slug "welcome-tour" → varName "tour"; "welcome-checklist" → "checklist").

Proceed? (y/n)
```

**On `y`** → proceed to Step 4.
**On `n`** → abort. Report: "No changes made. Tell me what you'd like different and I'll try again." Log a `link-flows:aborted-by-user` event.

### 3.2 — Pattern B variant (rare — mount not in a component body)

If Step 2.3 found that the `<Frigade.Announcement>` tag is at module top-level (e.g. a stray JSX expression exported as a const, not inside a function), the handler can't be added inline because `useFlow` is a React hook and must be called inside a functional component per the Rules of Hooks. In this case the confirmation prompt says:

```
Wiring: <source-slug> <button-side> CTA → start flow <target-slug>.

Current mount (<file-path>:<line>) is not inside a functional component, so I'll:

  1. Extract `<Frigade.Announcement flowId="<source-slug>" />` into a new wrapper component
     `Wired<Source-PascalCase>` (in the same file) that hosts the `useFlow` call.
  2. Replace the original tag with `<Wired<Source-PascalCase> />`.

After:

  'use client';
  import * as Frigade from '@frigade/react';
  import { useFlow } from '@frigade/react';

  function WiredWelcomeToMyProduct() {
    const tour = useFlow('<target-slug>');
    return (
      <Frigade.Announcement
        flowId="<source-slug>"
        <handler-prop>={() => tour.flow?.restart()}
      />
    );
  }

  export <whatever the original export was> (...) {
    return (
      <>
        <WiredWelcomeToMyProduct />
        ...
      </>
    );
  }

Proceed? (y/n)
```

Same `y`/`n` handling as Pattern A.

### 3.3 — Rules-of-Hooks note (why the inline form doesn't work)

A naive recipe might try to write `onPrimary={(_step, _flow) => useFlow('<target-slug>').flow.start()}` — calling `useFlow` *inside* the arrow function. That **violates the Rules of Hooks** (hooks must be called at the top level of a functional component, not inside event handlers, callbacks, or JSX attributes). React will throw a runtime error. The correct pattern — in both A and B — is:

1. Call `useFlow('<target-slug>')` **at the top of the functional component body**, assigning the result to a local variable.
2. Close over that variable in the handler: `onPrimary={() => <varName>.flow?.restart()}`.

The recipe emits (1) + (2) as a single atomic edit. Do not shortcut this by inlining `useFlow` into the JSX attribute.

Use `.restart()` rather than `.start()` for two reasons:
- `restart()` works regardless of whether the target flow was already started (e.g. if the user has already seen the tour, clicking "Take a tour" again should re-open it from step 1).
- `start()` is a no-op on an already-started flow (per `reference/sdk-react.md` §`useFlow` — `flow.isStarted` gates it).

If the user specifically wants the CTA to be ignored on already-started flows, emit `.start()` instead and surface that choice in the confirmation prompt (rare).

---

## Step 4 — Apply the code change (D16 — atomic edit)

Single-file edit, wrapped in the D16 snapshot-and-revert pattern.

### 4.1 — Snapshot

Before any `Edit`, read the full current contents of the target file and keep them in a variable (e.g. `snapshot = <file contents>`). This is the pre-edit state that gets restored on failure.

### 4.2 — Apply the edits in order

For **Pattern A** (the common case), the edit is up to three `Edit` calls on the same file. Treat them as one atomic unit — if any fails, revert using the snapshot.

**Edit 1 — ensure `'use client'` at the top** (only if the file is App Router and missing the directive). Skip if already present or if framework is Pages Router. `old_string` = the current first non-empty line (typically `import * as Frigade from '@frigade/react';`). `new_string` = `'use client';\n\n<original first line>`.

**Edit 2 — add `useFlow` to the imports** (only if not already imported). Two sub-cases:
- If `import * as Frigade from '@frigade/react';` is present, add a **separate named import** on the next line: `import { useFlow } from '@frigade/react';`. (The namespace import doesn't expose hooks at `Frigade.useFlow`.)
- If a named import from `@frigade/react` already exists (e.g. `import { Announcement, Tour } from '@frigade/react';`), add `useFlow` to the existing named-import list: `import { Announcement, Tour, useFlow } from '@frigade/react';`.

**Edit 3 — hoist the hook call into the component body AND add the handler prop on the tag.** This is one `Edit` call with a larger `old_string` that captures the function body + the tag, and a `new_string` that adds the `const <varName> = useFlow(...)` line plus the `<handler-prop>` attribute:

```
old_string:
  export function AppFlows() {
    return (
      <>
        <Frigade.Announcement flowId="welcome-to-my-product" />
        ...
      </>
    );
  }

new_string:
  export function AppFlows() {
    const tour = useFlow('welcome-tour');
    return (
      <>
        <Frigade.Announcement
          flowId="welcome-to-my-product"
          onPrimary={() => tour.flow?.restart()}
        />
        ...
      </>
    );
  }
```

Keep the `old_string` tight and uniquely-matching — the whole function body is usually unique. If multiple functional components exist in the file, scope to the one that contains the mount (from Step 2's line-range record).

### 4.3 — Rollback on failure

If any `Edit` in Step 4.2 fails (non-unique `old_string`, file-locked, external mtime change, permission error), **immediately write the full snapshot back to disk** (with a `Write` call restoring the pre-edit contents), then surface the failure per Step 6's partial-failure template. Do **not** leave the file in a half-applied state. Do **not** `DELETE` anything in Frigade (this recipe has no server-side writes to undo).

### 4.4 — Pattern B variant

For Pattern B (rare — mount not in a functional component), the edit is one `Write` that replaces the file content wholesale (since we're inserting a brand-new wrapper component). Snapshot rules still apply: keep the pre-edit content, restore on any failure (e.g. a later verification in Step 5 catches a syntax error).

### 4.5 — No-op case

If Step 2.3 found that `<handler-prop>` (e.g. `onPrimary`) is **already set** on the target tag, halt with: "This flow already has an `onPrimary` handler wired on `<file-path>:<line>`. I won't silently overwrite it. Tell me what the correct behavior should be (keep existing / replace with tour-start / add a second handler)." Log a `link-flows:handler-already-present` event. Do not edit.

---

## Step 5 — Consider the reverse direction (optional)

If the user's prompt also implied a reverse link — e.g. "and when the tour finishes, re-open the announcement" — document the pattern and ask once. Default: skip (tours complete naturally; the announcement doesn't need to re-appear after dismissal).

The reverse-direction pattern is symmetric: add an `onPrimary` (or `onSecondary`, or lifecycle) handler on the tour's `<Frigade.Tour>` tag that calls `useFlow('<announcement-slug>').flow?.restart()`. If the user wants this, surface a second Step 3–4 pass over the tour's mount file (which is the same `app/app-flows.tsx` in the dogfood example).

Because this is a secondary path, do not prompt unless the user's intent explicitly includes a reverse-direction hint. Most uses of this recipe are one-way (announcement → tour).

---

## Step 6 — Verify the result

After the edit lands, re-read the target file and confirm three things:

1. **The handler prop is present** on the source tag. Grep for `<handler-prop>={.*<varName>\.flow\?\.restart\(\)}` in the file content.
2. **`useFlow` is imported** from `@frigade/react`. Grep for `useFlow` in the file's import block.
3. **`'use client'`** is at the top (only if Next.js App Router). Grep for `^['"]use client['"]` at line 1 (ignoring blank lines above).

If any of the three checks fails, revert the edit using the Step 4.1 snapshot, then surface the failure per Step 7's partial-failure template. This is a sanity check against an `Edit` that "succeeded" but didn't land the expected text (e.g. whitespace-sensitive match drift).

Log a `link-flows:verify-ok` event to `.frigade/skill.log` on success, with the three check outcomes.

---

## Step 7 — Report

Emit the success block. Exact template:

```
Linked: <source-slug> <button-side> CTA → starts <target-slug>

   File modified: <file-path>
   Changes:
     - Added (if missing): 'use client' directive
     - Added (if missing): import { useFlow } from '@frigade/react'
     - Added: const <varName> = useFlow('<target-slug>') at top of <component-name>
     - Added: <handler-prop>={() => <varName>.flow?.restart()} on <Frigade.<SourceType>>

Open http://localhost:3000, see the <source-slug> flow, click "<button-title>" —
the <target-slug> flow should start immediately.

If the target flow doesn't start:
 - Check the browser console for React errors (especially "Rendered more hooks than during the previous render" or "Rules of Hooks" warnings).
 - Confirm @frigade/react version is >= 2.9.x (run `npm ls @frigade/react` / `yarn why @frigade/react` / `pnpm ls @frigade/react` — useFlow must be exported from the `@frigade/react` package).
 - If you've already dismissed the source flow: ask me to "reset user <userId> on flow <source-slug>" to clear state.
 - Verify both flows are `active: true` in the dashboard (https://app.frigade.com/flows/<source-slug> and .../flows/<target-slug>).
```

If Step 5 also wired a reverse link, add a second `Linked:` block for that direction.

Log a `link-flows:success` event to `.frigade/skill.log` per **D17** with: source slug, target slug, button side, file path touched, varName chosen, Frigade environment (`dev` unless the user specified prod — prod is treated identically here since this recipe makes no server-side writes). Redact any `Authorization` header from the Step 1 GET log entries.

---

## Partial-failure handling (D16)

This recipe is **simpler** than `create-*` recipes in one important way: **it makes no Frigade-side writes**. The only mutations are to a single file in the host codebase. That means:

- There is **no server-side rollback** needed. Both flows already existed before this recipe ran, and they still exist after it (in their unchanged state).
- There is **one file's worth** of code rollback needed, using the Step 4.1 snapshot.

### Failure modes and their handling

| Failure point | Rollback | User-facing message |
|---|---|---|
| Step 1 — `GET /v1/flows/<source>` returns 404 | None needed (no edits yet) | "Source flow `<source-slug>` doesn't exist. Run `recipes/create-announcement.md` first." |
| Step 1 — `GET /v1/flows/<target>` returns 404 | None needed (no edits yet) | "Target flow `<target-slug>` doesn't exist. Run `recipes/create-tour.md` first." |
| Step 2 — zero grep hits for the source mount | None needed (no edits yet) | "Source flow `<source-slug>` isn't mounted anywhere in this codebase. Run the create recipe's mount phase first." |
| Step 3 — user answers `n` | None needed (no edits yet) | "No changes made. Tell me what you'd like different." |
| Step 4 — an `Edit` call fails mid-batch | Write the Step 4.1 snapshot back to disk. | Partial-failure template (below). |
| Step 4.5 — handler already present on tag | None needed (halted before editing) | "Existing `onPrimary` handler found. Tell me: keep existing / replace / compose." |
| Step 6 — post-edit verification fails | Write the Step 4.1 snapshot back. | Partial-failure template (below). |

### Partial-failure report template

```
Completed:
 Verified source flow <source-slug> exists (GET /v1/flows/<source-slug> → 200)
 Verified target flow <target-slug> exists (GET /v1/flows/<target-slug> → 200)
 Located source mount at <file-path>:<line>

Failed at step <N> of 7:
 Could not <operation>
   Reason: <specific — e.g. "Edit's old_string was not unique; <file-path> may have been modified externally between my read and write">
   Rolled back: restored <file-path> to pre-edit state from snapshot.
   Preserved (not rolled back): nothing — this recipe made no Frigade-side writes or package installs.

Upstream state preserved:
- Both flows (<source-slug>, <target-slug>) are unchanged in Frigade. No action has been taken on either.

Recovery options:
  1. Retry — I'll re-read the file and re-attempt the edit (useful if the failure was a transient mtime race).
  2. Show me the current file contents of <file-path> and I'll hand-edit instead.
  3. Leave things as they are — no link has been added; the source CTA remains unwired.

Which would you like? (1/2/3)
```

All three options are always offered (per `reference/errors.md` §"Reporting partial failures" required fields).

Log the `link-flows:partial-failure` event to `.frigade/skill.log`: step number, operation, failure reason, file snapshot restored, recovery options offered.

---

## Worked example — Eric's dogfood loop, step 3

This is the third and final step of the dogfood loop that began with `recipes/create-announcement.md` (Task 16) and continued with `recipes/create-tour.md` (Task 17).

**Prior state** (carried over from the worked examples in those two recipes):

- `welcome-to-my-product` (ANNOUNCEMENT) exists in Frigade dev; mounted in `app/app-flows.tsx` via `<Frigade.Announcement flowId="welcome-to-my-product" />`.
- `welcome-tour` (TOUR) exists in Frigade dev; mounted in `app/app-flows.tsx` via `<Frigade.Tour flowId="welcome-tour" />` (added by the `create-tour` recipe alongside the announcement).
- The announcement's primary CTA has `title: "Take a tour"` and `action: false` (flagged `pending_link` in `.frigade/skill.log` by the `create-announcement` recipe).
- `@frigade/react` is installed; `<Frigade.Provider>` is mounted in `app/providers.tsx`; `.env.local` has `NEXT_PUBLIC_FRIGADE_API_KEY` + `FRIGADE_API_KEY_SECRET`.

**User's prompt:**

> "Now wire the announcement's 'Take a tour' CTA to start the tour."

**Claude's actions:**

1. **Pre-conditions check.** Run `first-run-setup.md` Section 1 — marker + keys match, silent success. Confirm `@frigade/react` in `package.json` (it is). Skim `.frigade/skill.log` for a recent `pending_link` event — found: `{"event":"pending_link","flow":"welcome-to-my-product","cta":"Take a tour","target":"welcome-tour"}`. This disambiguates source/target without needing to ask the user.

2. **Parse intent (Step 1.1 / 1.2 / 1.3).**
   - Source = `welcome-to-my-product` (from the prompt "the announcement" + the `pending_link` log entry).
   - Target = `welcome-tour` (from the `pending_link.target` field).
   - Button = `primary` (from "'Take a tour' CTA" matching the announcement's primary button title).

3. **Verify both flows (Step 1.4):**
   ```bash
   curl -sS "https://api3.frigade.com/v1/flows/welcome-to-my-product" \
     -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
   # → 200

   curl -sS "https://api3.frigade.com/v1/flows/welcome-tour" \
     -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
   # → 200
   ```
   Both exist. Log a `link-flows:start` event with both slugs.

4. **Locate the mount (Step 2):**
   ```bash
   grep -rnE "flowId=['\"]welcome-to-my-product['\"]" src app components 2>/dev/null
   # app/app-flows.tsx:6:        <Frigade.Announcement flowId="welcome-to-my-product" />
   ```
   One hit. Read `app/app-flows.tsx` in full:
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
   Structural facts:
   - `'use client'` present: yes
   - `useFlow` imported: no
   - Mount inside functional component body: yes (`AppFlows`) → Pattern A

5. **Confirmation prompt (Step 3):**
   ```
   Wiring: welcome-to-my-product primary CTA → start flow welcome-tour.

   File to edit: app/app-flows.tsx:6

   Pre-edit structural facts:
    - 'use client' directive: present
    - `useFlow` import from '@frigade/react': absent — will add
    - Mount is inside a functional component: yes (AppFlows) — Pattern A

   Change:

     <Frigade.Announcement flowId="welcome-to-my-product" />

   becomes (plus a top-of-component `const tour = useFlow('welcome-tour');`):

     <Frigade.Announcement
       flowId="welcome-to-my-product"
       onPrimary={() => tour.flow?.restart()}
     />

   Proceed? (y/n)
   ```
   User: `y`.

6. **Apply edits (Step 4):**
   - Snapshot `app/app-flows.tsx` (full contents).
   - Edit 1 — skip (`'use client'` already present).
   - Edit 2 — add `import { useFlow } from '@frigade/react';` after the existing `import * as Frigade` line.
   - Edit 3 — rewrite the function body: add `const tour = useFlow('welcome-tour');` at the top, add `onPrimary={() => tour.flow?.restart()}` to the `<Frigade.Announcement>` tag.

   All three edits succeed. Final file state:
   ```tsx
   'use client';

   import * as Frigade from '@frigade/react';
   import { useFlow } from '@frigade/react';

   export function AppFlows() {
     const tour = useFlow('welcome-tour');
     return (
       <>
         <Frigade.Announcement
           flowId="welcome-to-my-product"
           onPrimary={() => tour.flow?.restart()}
         />
         <Frigade.Tour flowId="welcome-tour" />
       </>
     );
   }
   ```

7. **Reverse direction (Step 5):** user's prompt didn't mention a reverse link. Skip.

8. **Verify (Step 6):**
   - `onPrimary={() => tour.flow?.restart()}` present on the Announcement tag: yes.
   - `useFlow` imported from `@frigade/react`: yes.
   - `'use client'` at line 1: yes.
   All three checks pass.

9. **Report (Step 7):**
   ```
   Linked: welcome-to-my-product primary CTA → starts welcome-tour

      File modified: app/app-flows.tsx
      Changes:
        - Added: import { useFlow } from '@frigade/react'
        - Added: const tour = useFlow('welcome-tour') at top of AppFlows
        - Added: onPrimary={() => tour.flow?.restart()} on <Frigade.Announcement>

   Open http://localhost:3000, see the welcome-to-my-product announcement, click "Take a tour" —
   the welcome-tour flow should start immediately.

   If the target flow doesn't start:
    - Check the browser console for React errors.
    - Confirm @frigade/react version is >= 2.9.x (npm ls @frigade/react).
    - If you've already dismissed the source flow: ask me to "reset user <userId> on flow welcome-to-my-product" to clear state.
    - Verify both flows are `active: true` in the dashboard.
   ```

10. **Log** `link-flows:success` to `.frigade/skill.log`: source `welcome-to-my-product`, target `welcome-tour`, button `primary`, file `app/app-flows.tsx`, varName `tour`, env `dev`. Authorization redacted.

Now Eric visits http://localhost:3000: the announcement renders → clicks "Take a tour" → the tour starts → he sees the 3-step tour laid out over the sidebar/create-button/settings anchors. **Dogfood loop complete.**
