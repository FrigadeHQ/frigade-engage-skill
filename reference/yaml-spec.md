# Flow YAML Spec

How flow **content** is structured in Frigade. Every flow record has a `data` field that is a YAML document (parsed server-side into a JSON tree). This reference documents the shape Claude MUST produce when authoring or editing that `data` blob.

**Source of truth.** Canonical examples in this file are drawn verbatim from:
- `frigade-web/src/data/data.ts` — the "new flow" templates the Frigade dashboard ships with (lines 81–696).
- `demo-v2/src/lib/flow-details.ts` — live flows rendered on `https://demo.frigade.com` (lines 1–388).
- `docs/component/*.mdx` — public docs on `https://docs.frigade.com/v2/component/*`.

Cross-references:
- **Targeting DSL** (the `targetingLogic`, `visibilityCriteria`, `startCriteria`, `completionCriteria` strings): **see `targeting-and-rules.md`** (Task 14 — TBD at time of writing; use `user.property('...')`, `user.flowStepData('flowId', 'stepId', 'fieldId')`, boolean ops, and `==`/`!=` as shown in the examples below).
- **Creating / updating flows**: see `rest-endpoints.md` (POST/PUT `/v1/flows`) and `operations.md`. The `data` field transmitted to those endpoints is the YAML string documented here.
- **SDK wiring and the CTA action enum**: see `sdk-react.md`.
- **Cross-flow "start another flow" CTA**: the YAML `action` enum does **NOT** support this declaratively — see `sdk-react.md` "**D12 — starting a different flow from a CTA**" and (forthcoming) `recipes/link-flows.md`.

## Common top-level structure

The `data` YAML is an object. Not every field below is present on every flow — most flows only set `steps`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `steps` | `StepConfig[]` | **yes** | The ordered list of steps. The only required top-level field for most flow types. |
| `title` | `string` | no | Checklist-wide title (checklists only — rendered above the step list). Example: `title: Getting started` in the CHECKLIST_FLOW_ID config. |
| `subtitle` | `string` | no | Checklist-wide subtitle (checklists only). May contain the HTML tags whitelisted for flows — see **HTML in strings** below. |
| `props` | `Record<string, unknown>` | no | Flow-wide UI props merged into the React component. Common keys: `dismissible: true`, `sequential: true`, `alignSelf`, `justifySelf`, NPS `options`/`positiveLabel`/`negativeLabel`. |
| `sequential` | `boolean` | no | Checklist-only. If `true`, steps must be completed in order; later steps are locked. Default `false`. |

The flow **`type`** (`ANNOUNCEMENT`, `TOUR`, ...) is NOT in the YAML — it lives at the top of the flow record alongside `slug`, `name`, `description`, `version`, `targetingLogic`, `active`, etc. That outer envelope is wire-level (REST / GraphQL), not YAML. The YAML is only the `data` field. When this reference says "a CHECKLIST flow's YAML," it means: the `data` string on a flow record whose outer `type` is `CHECKLIST`.

### The `FlowType` enum (wire-level, for the outer flow record)

From `@frigade/js/dist/index.d.ts:597` (the canonical source):

```
ANNOUNCEMENT
CHECKLIST
FORM
TOUR
SUPPORT
CUSTOM
BANNER
EMBEDDED_TIP
NPS_SURVEY
SURVEY
CARD
```

**Notes on types not in the enum but mentioned in the build spec:**
- `NUDGE` — **not a real `FlowType`**. The closest in-product concept is a **Hint**, which is rendered by `<Frigade.Tour sequential={false} defaultOpen={false} />` against a YAML that is structurally identical to a TOUR. Flow `type` on the backend is `TOUR`. See the HINT section below.
- `MODAL` — **not a real `FlowType`**. "Modal" is a rendering style: wrap any flow component in `as={Frigade.Dialog}` (or set the `modal` React prop). The YAML for an announcement-in-a-modal is the same as a regular `ANNOUNCEMENT`. The `MODAL_FLOW_ID` in `demo-v2` is typed as `ANNOUNCEMENT` on the server; "modal" is purely a client-side render choice.

## Step structure (shared across types)

Every `steps[]` entry is an object. Shared keys (confirmed against `docs/component/announcement.mdx` "Flow Configuration" tab):

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | **yes** | Unique step ID within this flow. Do NOT change once created — it is referenced from `user.flowStepData()`, `completionCriteria`, analytics, etc. Kebab-case by convention (`welcome-step`, `nps-score-page`). |
| `title` | `string` | no | Step heading. HTML tags from the whitelist are OK. |
| `subtitle` | `string` | no | Step body/description. Often multi-line in the live flows — use `|` block scalars if needed. HTML tags OK. |
| `imageUri` | `string` | no | HTTPS URL to an image shown in the step. For Frigade-hosted assets, use the CDN (see **Media** below). |
| `iconUri` | `string` | no | HTTPS URL to a small icon. **Only rendered by the carousel Checklist.** |
| `videoUri` | `string` | no | YouTube / Vimeo / direct `.mp4` URL. |
| `primaryButton` | `object` | no | Primary CTA — see **CTA / button** below. If omitted entirely (or if `primaryButton.title` is omitted), the button is hidden. |
| `secondaryButton` | `object` | no | Secondary CTA — same shape. |
| `selector` | `string` | TOUR only | CSS selector (`#id`, `.class`, `[data-…]`) for the DOM anchor. Required for TOUR steps. |
| `fields` | `FormField[]` | FORM only | Form input definitions — see **FORM** below. |
| `props` | `Record<string, unknown>` | no | Per-step UI prop overrides passed to the React renderer (`dismissible`, `zIndex`, `align`, `side`, `sideOffset`, `alignOffset`, …). |
| `completionCriteria` | `string` (DSL) | no | Auto-completes the step when the expression evaluates to true. Example: `user.property('connectedBank') == true`. |
| `startCriteria` | `string` (DSL) | no | Blocks the step from starting until the expression is true. |
| `visibilityCriteria` | `string` (DSL) | no | Hides the step from the render queue unless the expression is true — used for branching in forms. |
| `type` | `string` | no | Custom step-component key (checklist `stepTypes` prop; see `docs/component/checklist/collapsible.mdx`). Not the flow's `FlowType`. |

**Deprecated step keys** (supported for back-compat; do NOT author new flows with these): `primaryButtonTitle`, `primaryButtonUri`, `primaryButtonUriTarget`, `secondaryButtonTitle`, `secondaryButtonUri`, `secondaryButtonUriTarget`. Use the nested `primaryButton: { title, uri, target, action }` form. The `docs/component/form.mdx` "Branching Forms" example (line 290) still uses `primaryButtonTitle` — treat as legacy.

## CTA / button shape

From `docs/component/*.mdx` "Flow Configuration (Advanced Editor)" tab (identical across Announcement, Tour, Checklist, Banner, Card, Form, NPS):

```yaml
primaryButton:
  title: Next            # string — REQUIRED. If omitted, the button is hidden.
  action: step.complete  # string | false — defaults to step.complete
  uri: https://...       # string — optional URL to navigate to
  target: _self          # "_self" (default) or "_blank"
secondaryButton:
  title: Learn more
  action: false
  uri: https://docs.frigade.com/v2/component/form
  target: _blank
```

### CTA `action` enum (v2 SDK, @frigade/react 2.9.4)

Confirmed identical across `docs/component/announcement.mdx:182` (and every other component doc's config tab) and `sdk-react.md` (CTA action enum table). The full set of values:

| Value | Meaning |
|---|---|
| `flow.start` | Mark the containing flow started (in-progress). |
| `flow.complete` | Mark the containing flow completed and close it. |
| `flow.skip` | Mark the containing flow skipped (dismissed). |
| `flow.restart` | Reset the containing flow to step 1. |
| `flow.forward` | Advance the containing flow to the next step (no state change on current step). |
| `flow.back` | Go to the previous step. |
| `step.complete` | Mark the current step complete (default for most CTAs). |
| `step.start` | Mark the current step started. |
| `step.skip` | Mark the current step skipped. |
| `step.reset` | Reset the current step to "not started". |
| `false` | No built-in action — rely entirely on the `onPrimary`/`onSecondary` React handler. `uri` navigation still runs. |

**Default when `action` is omitted:** `step.complete` (per `docs/component/*.mdx` line 181 on each component doc).

**`action` + `uri` interaction:** navigation runs *after* the state update, via the Provider's `navigate` hook. Set `target: _blank` to open in a new tab without dismissing the flow; `target: _self` navigates the current window.

### Cross-flow CTAs (starting a different flow)

**Not expressible in YAML.** The enum above operates only on the *containing* flow. There is no `action: flow.start:<other-flow-id>` or `nextFlowId` key. Confirmed: the SDK's enum matches the dashboard's rendering code — no hidden declarative value exists.

To wire a CTA in flow A that starts flow B, use a React handler:

```yaml
# Flow A (Announcement) YAML
steps:
  - id: welcome
    title: Welcome to Acme
    primaryButton:
      title: Take the tour
      action: false   # or leave default; React handler does the work
```

```tsx
// Flow A's mounting component
import * as Frigade from '@frigade/react';
import { useFlow } from '@frigade/react';

export function WelcomeAnnouncement() {
  const { flow: tour } = useFlow('flow_product_tour');
  return (
    <Frigade.Announcement
      flowId="flow_welcome_announcement"
      onPrimary={async () => {
        await tour?.restart();
        return true;
      }}
    />
  );
}
```

See `sdk-react.md` section **D12** for the full decision rationale and the alternate `uri`-based pattern.

## Media / images

- **Keys:** `imageUri`, `iconUri` (carousel checklist only), `videoUri`.
- **HTTPS required.** Browsers block mixed content on HTTPS pages.
- **Hosting:** point to any HTTPS URL (`https://cdn.frigade.com/...`, your own S3/Cloudflare, etc.). For in-house assets, upload to the Frigade CDN first:

```bash
curl -sS -X POST "https://api3.frigade.com/v1/cdnUpload" \
  -H "Authorization: Bearer $FRIGADE_PRIVATE_KEY" \
  -F "file=@./hero-image.png"
# → {"url": "https://cdn.frigade.com/<uuid>.png"}
```

Paste the returned `url` into `imageUri`. See `rest-endpoints.md` §"CDN (Uploads)" (POST `/v1/cdnUpload`) for accepted mime types (`image/png|webp|jpeg|jpg|gif|svg+xml`, `video/mp4|mov|webm`, 100 MB cap).

## HTML in string fields

`title` and `subtitle` accept a small whitelist of HTML tags (`docs/platform/html-in-strings.mdx`): `<b>`, `<i>`, `<u>`, `<a href target>`, `<br>`, `<p>`, `<img>`, `<div>`, `<span>`. `style` and `class` attrs work on all of them. Live examples from `demo-v2/src/lib/flow-details.ts`:

```yaml
subtitle: This is a Frigade banner that uses <a href='https://docs.frigade.com/v2/platform/targeting' target='_blank' style='color:#0171F8;'>targeting</a> to automatically show after the tour.
```

## Dynamic variables (template substitution)

Anywhere a string is expected, you may reference provider/flow variables with `${name}` (`docs/platform/dynamic-variables.mdx`). Passed via the React component's `variables` prop or the `<Frigade.Provider variables={...} />`.

```yaml
steps:
  - id: welcome-page
    title: "Welcome to Acme, ${firstName}!"
    subtitle: "Your plan renews on ${renewalDate}."
```

## Targeting block (outer flow record)

Flow-level targeting lives on the **outer flow record** as `targetingLogic` (a DSL string), not in the YAML `data` blob. See `targeting-and-rules.md` (TBD) for the full DSL. Step-level targeting (`completionCriteria`, `startCriteria`, `visibilityCriteria`) IS in the YAML — see the shared step fields above.

---

## ANNOUNCEMENT

Modal callout with title, subtitle, optional media, and up to two CTAs. Can be single-page or multi-page (wizard-style). Rendered by `<Frigade.Announcement>` — wrap in `as={Frigade.Dialog}` for a modal overlay.

### Fields

Root: just `steps[]` (and optionally `props` for flow-level dismissibility).

Each step uses the shared step shape above. Commonly set: `id`, `title`, `subtitle`, `imageUri`, `primaryButton`, `secondaryButton`.

### Example 1 — default dashboard template (2-page wizard)

Verbatim from `frigade-web/src/data/data.ts:107-129` (the template emitted when a user creates a new Announcement in the dashboard):

```yaml
steps:
  - id: step-1
    title: Here's a cool announcement
    subtitle: You can use this space to share more with your users about your update or message.
    primaryButton:
      title: Next
    secondaryButton:
      title: Learn more
      action: false
      uri: https://frigade.com/
      target: _blank
    imageUri: https://cdn.frigade.com/19b2ccb0-363f-471d-870e-a25fe6dabe1e.svg
  - id: step-2
    title: And here is another one
    subtitle: Wow! There is so much space for activities. Check out the docs for all the options.
    primaryButton:
      title: Finish
    secondaryButton:
      title: Visit docs
      action: false
      uri: https://docs.frigade.com/component/announcement
      target: _blank
    imageUri: https://cdn.frigade.com/19b2ccb0-363f-471d-870e-a25fe6dabe1e.svg
```

Key points: the first step's primary action is omitted — so it defaults to `step.complete`, which advances to step-2. The second step's `Finish` button (also default `step.complete`) completes the last step, which completes the flow. Secondary buttons all use `action: false` + `uri` + `target: _blank` — a pure outbound link that does not dismiss the flow.

### Example 2 — live modal announcement from demo-v2

Verbatim from `demo-v2/src/lib/flow-details.ts:138-159` (`MODAL_FLOW_ID = 'flow_OMJL2QzR'`, rendered on `https://demo.frigade.com/modals`):

```yaml
steps:
  - id: feature-announcement
    title: This is a basic announcement
    subtitle: It is a standard, non-styled version.
    primaryButton:
      title: Next
    secondaryButton:
      title: Learn more
      uri: https://frigade.com/engage
      target: _blank
      action: false
    imageUri: https://cdn.frigade.com/b7540f8f-1690-4234-b92b-adb9a42ebe36.svg
  - id: feature-announcement-2
    title: Announcements can be multi-page
    subtitle: Check out the other variations on this page
    primaryButton:
      title: Finish
    imageUri: https://cdn.frigade.com/3258935a-a150-46da-9026-54df34729b55.svg
```

This is rendered via:

```tsx
<Frigade.Announcement flowId="flow_OMJL2QzR" as={Frigade.Dialog} dismissible />
```

The `MODAL`-looking styling comes from `as={Frigade.Dialog}`, not from the YAML. Same YAML inline is an inline announcement.

---

## TOUR

Sequential step-by-step walkthrough anchored to DOM elements. Each step's `selector` points at an existing element; a tooltip renders next to it. Rendered by `<Frigade.Tour>`.

### Fields (in addition to shared)

| Field | Type | Required | Notes |
|---|---|---|---|
| `selector` | `string` (CSS) | **yes** | CSS selector of the anchor. `#id`, `.class`, `[data-attr=value]` all work. Use IDs for stability — classnames can change with CSS refactors. |
| `props.side` | `"top"\|"right"\|"bottom"\|"left"` | no | Preferred side of the anchor. |
| `props.align` | `"start"\|"center"\|"end"\|"after"\|"before"` | no | Alignment along the chosen side. |
| `props.sideOffset` | `number` | no | Pixel offset perpendicular to the anchor. |
| `props.alignOffset` | `number` | no | Pixel offset along the alignment axis. |
| `props.zIndex` | `number` | no | Override the default z-index (9999). |
| `props.dismissible` | `boolean` | no | Per-step dismissibility override. |

### Anchor conventions

`selector` can be any valid CSS selector. The `create-tour` recipe (Task forthcoming) adds `id` attributes to the user's codebase rather than inventing fragile class selectors. Two stable conventions:

- `#frigade-anchor-<slug>` — e.g. `#frigade-anchor-sidebar-settings` — namespaced so it's obviously a Frigade hook.
- `data-frigade-anchor="<slug>"` → selector `[data-frigade-anchor="sidebar-settings"]` — good when the host element already has an `id` you don't want to overwrite.

`demo-v2` uses short unique IDs (`#demo-card-subtitle`, `#stock-1`, `#demo-button-group`) directly — those exist because the codebase owns them.

**Behavior if the selector doesn't match:** from `docs/guides/tours.mdx` — the tour step is skipped silently if the selector matches zero elements, and the first match wins if multiple elements match. Enable Verbose console logging in Chrome DevTools to see which selectors fail.

### Hiding the CTA (anchor-driven progression)

Omit `primaryButton.title` to hide the Next button (from `docs/guides/tours.mdx`, lines 167–180). Use this when the user is expected to complete the step by interacting with the anchored element itself (e.g. clicking it) — pair with `completionCriteria` or a `step.complete()` call from the handler.

### Example 1 — 3-step product tour with mixed interactions

Verbatim from `demo-v2/src/lib/flow-details.ts:239-264` (`TOUR_FLOW_ID = 'flow_F0MP8vnI'`):

```yaml
steps:
  - id: tour-step-one
    title: This is a Frigade tour
    subtitle: It can be customized to fit your brand, or built from the ground up with your own UI components.
    primaryButton:
      title: Next
    selector: "#demo-card-subtitle"
  - id: tour-step-two
    title: Tours can interact with user inputs
    subtitle: Enter a number larger than 100 to advance to the next step of the tour.
    secondaryButton:
      title: Learn more
      action: false
      uri: https://docs.frigade.com/v2/component/tour
      target: _blank
    selector: "#stock-1"
  - id: tour-step-three
    imageUri: https://cdn.frigade.com/bde697dd-445e-4d70-a395-340096a97a29.png
    title: Push the button
    subtitle: Select the Medium (M) button to complete the final step of this tour.
    selector: "#demo-button-group"
```

Note `tour-step-two` has no `primaryButton` — the button is hidden so the user must advance by interacting with the input. The demo wires this via `step.complete()` in React when the input value exceeds 100. `tour-step-three` also has no `primaryButton` — click on the button group completes the step (and therefore the tour).

### Example 2 — tour with per-step layout props

Verbatim from `frigade-web/src/data/data.ts:559-576` (the dashboard's default Tour template):

```yaml
steps:
  - id: step-1
    title: This is a tour
    subtitle: Tours are open by default and generally sequential. They can highlight specific UI or guide users through advanced workflows.
    primaryButton:
      title: Next
    selector: "#tooltip-select-0"
    props:
      dismissible: true
  - id: step-2
    title: This is the second step
    subtitle: Tours can also be connected to actions and events in your product as shown in <a href="https://demo.frigade.com/tours" target="_blank">this example</a>.
    primaryButton:
      title: Got it
    selector: "#tooltip-select-1"
    props:
      dismissible: true
```

`props.dismissible: true` per step means each step has its own close X. HTML `<a>` tag is inlined in `subtitle`.

### HINT (TOUR variant)

Hints are a TOUR rendered with `sequential={false}` and `defaultOpen={false}`. Flow `type` on the server is `TOUR`. YAML is identical to a TOUR but typically includes `props.align`/`props.side` per step (since they aren't sequential). Verbatim from `demo-v2/src/lib/flow-details.ts:1-44` (`HINT_FLOW_ID = 'flow_QoSHPAnV'`):

```yaml
steps:
  - id: new-step-1
    title: Use Hints to drive adoption
    subtitle: Hints can be used to call attention to specific UI elements on the page.
    selector: "#model-card"
    primaryButton:
      title: Got it
      action: step.complete
    props:
      align: start
      side: left
    secondaryButton:
      title: View docs
      action: false
      uri: https://docs.frigade.com/v2/component/hint
      target: _blank
  - id: new-step-2
    title: Create subtle callouts
    subtitle: Hints are closed by default. They provide user education in a less intrusive way than pop-ups.
    selector: "#model"
    props:
      align: after
      side: top
  - id: new-step-3
    title: Complete in any order
    subtitle: Hints tend to be non-sequential, and they can be fully customized and styled.
    selector: "#top-p"
    imageUri: https://cdn.frigade.com/bde697dd-445e-4d70-a395-340096a97a29.png
    props:
      align: before
      side: left
    primaryButton:
      title: Cool
      action: step.complete
    secondaryButton:
      title: Visit Frigade
      action: false
      target: _blank
      uri: https://frigade.com/engage
```

Rendered by:

```tsx
<Frigade.Tour flowId="flow_QoSHPAnV" defaultOpen={false} sequential={false} dismissible />
```

---

## CHECKLIST

Ordered list of tasks the user completes over multiple sessions. Renders as a carousel (`<Frigade.Checklist.Carousel>`) or collapsible list (`<Frigade.Checklist.Collapsible>`). Supports both pre-built UIs from one YAML.

### Fields (in addition to shared)

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` (root) | `string` | no | Checklist header text (above the step list). |
| `subtitle` (root) | `string` | no | Checklist subheader. HTML tags OK. |
| `sequential` (root) | `boolean` | no | Default `false` — steps completable in any order. `true` locks later steps until earlier ones complete. |
| `steps[].primaryButton.action` | enum | no | Very commonly `step.complete` for a "Mark done" button, or omitted (= also `step.complete`). |
| `steps[].completionCriteria` | DSL string | no | Auto-complete the step on a user-property or flow-step-data condition. Pattern: `user.property('connectedBank') == true`. |
| `steps[].startCriteria` | DSL string | no | Gate a step on an earlier step's completion to create a branching checklist. |
| `steps[].iconUri` | URL | no | Small icon in the carousel form factor. Ignored by Collapsible. |

### Example 1 — default dashboard template (carousel-style, 4 steps)

Verbatim from `frigade-web/src/data/data.ts:256-286`:

```yaml
title: Checklist title
subtitle: Copy about the group of tasks a user needs to complete to finish setup.
steps:
  - id: step-1
    title: Task 1 title
    subtitle: Copy about the task users need to complete. Remember to provide context and clear, actionable direction. Include visual references like images, gifs or videos when possible.
    primaryButton:
      title: Button CTA
    iconUri: https://cdn.frigade.com/31329c7f-7ba2-40d9-a557-ba977629a81b.svg
  - id: step-2
    title: Task 2 title
    subtitle: Copy about the task users need to complete. Remember to provide context and clear, actionable direction. Include visual references like images, gifs or videos when possible.
    primaryButton:
      title: Button CTA
    secondaryButton:
      title: Skip
    iconUri: https://cdn.frigade.com/31329c7f-7ba2-40d9-a557-ba977629a81b.svg
  - id: step-3
    title: Task 3 title
    subtitle: Copy about the task users need to complete. Remember to provide context and clear, actionable direction. Include visual references like images, gifs or videos when possible.
    primaryButton:
      title: Button CTA
    iconUri: https://cdn.frigade.com/31329c7f-7ba2-40d9-a557-ba977629a81b.svg
  - id: step-4
    title: Task 4 title
    subtitle: Copy about the task users need to complete. Remember to provide context and clear, actionable direction. Include visual references like images, gifs or videos when possible.
    primaryButton:
      title: Button CTA
    secondaryButton:
      title: Skip
    iconUri: https://cdn.frigade.com/31329c7f-7ba2-40d9-a557-ba977629a81b.svg
```

The default secondary button on even steps is `Skip` with omitted action → defaults to `step.complete` (which in a checklist marks the step "skipped" from the user's POV because they didn't actually do the work, but state-wise it completes). Use `action: step.skip` for an explicit skip.

### Example 2 — live checklist with conditional logic (demo-v2)

Verbatim from `demo-v2/src/lib/flow-details.ts:161-204` (`CHECKLIST_FLOW_ID = 'flow_lSjFTcXz'`):

```yaml
title: Getting started
subtitle: Build effective onboarding checklists with Frigade <a
  href='https://docs.frigade.com/v2/component/checklist/carousel'
  target='_blank' style='color:#0171F8;'>pre-built UI</a> or custom components.
steps:
  - id: checklist-step-one
    title: State Management
    subtitle: Frigade automatically tracks and remembers completion statuses for
      every user. Mark this step complete, then try closing and reopening this
      tab in your browser.
    primaryButton:
      title: Mark complete
      action: step.complete
    secondaryButton:
      title: Learn more
      action: false
      uri: https://frigade.com/engage
      target: _blank
  - id: checklist-step-two
    title: Dynamic Completion
    subtitle: Sometimes you want to mark a step complete after the user completes a
      specific action. Frigade makes this easy. Complete this step by selecting
      <strong>`User action`</strong> below.
    secondaryButton:
      title: Learn more
      action: false
      uri: https://docs.frigade.com/v2/sdk/advanced/completing-a-step
      target: _blank
  - id: checklist-step-three
    title: Conditional Logic
    subtitle: Add your own logic to automatically lock steps or mark them complete.
      For example, complete the final step to unlock this step.
    startCriteria: user.property('hasFinishedStepFour') == true
    primaryButton:
      title: Mark complete
  - id: checklist-step-four
    title: Native UI Components
    subtitle: Style every part of our pre-built UI components to fit seamlessly in
      your product, or build headless with our SDK. Write
      <strong>native</strong> in the box below to complete this step.
```

Highlights:
- `checklist-step-two` has **no `primaryButton`** — the user completes it by clicking an in-product button wired to `step.complete()` from the React handler.
- `checklist-step-three` uses `startCriteria` so the step is locked until `user.property('hasFinishedStepFour') == true`. This creates inverse ordering: completing the last step unlocks step three.
- `checklist-step-four` has no primary button either — completion is driven by an in-product event (text input matching "native").
- HTML `<a href>` and `<strong>` are inlined in `subtitle`; newlines from YAML folded scalars render as spaces.

---

## NUDGE (not a distinct type — see HINT above)

Frigade's `FlowType` enum does not include `NUDGE`. When the skill is asked to "create a nudge," route to one of:
- **Hint** — small, non-sequential tooltips. Flow type = `TOUR`, `sequential: false`, `defaultOpen: false`. See the HINT example under TOUR above.
- **Banner** — top/bottom persistent strip. See BANNER below.
- **Card** — inline in the UI. See CARD below.

Ask the user which they mean before authoring; do not guess.

---

## FORM

Multi-step input collection (registration, survey, feedback). Rendered by `<Frigade.Form>` — wrap in `as={Frigade.Dialog}` for modal surveys. Supports conditional fields (`visibilityCriteria`), field-level validation (`pattern`), and custom field types.

### Fields (in addition to shared)

Each form step has an additional `fields: FormField[]` array. Each `FormField` has:

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | **yes** | Unique within the step. Referenced by `user.flowStepData(flowId, stepId, fieldId)`. |
| `type` | `string` | **yes** | Built-ins: `text`, `textarea`, `select`, `radio`, `checkbox`, `nps`. Any other string maps to a custom `fieldTypes={{...}}` component. |
| `label` | `string` | no | Visible label. |
| `placeholder` | `string` | no | HTML placeholder. |
| `required` | `boolean \| string` | no | `true` for the default message; a string for a custom error message (e.g. `required: Email is required`). |
| `maxLength` | `int` | no | `text`/`textarea` only. |
| `multiple` | `boolean` | no | `select` only — becomes a multi-select. |
| `options` | `{label, value}[]` | yes for `select`/`radio` | Choice list. `value` can be string, number, or other JSON scalar. |
| `value` | `string` | no | Default/prefill value. For `checkbox` use `'true'` or `'false'` (strings). Supports `${variable}` substitution. |
| `pattern.value` | regex string | no | Client-side regex validation. |
| `pattern.message` | `string` | no | Error message shown on regex mismatch. |
| `props` | `Record<string, unknown>` | no | Passed through to the HTML element as attributes — e.g. `type: email`, `className`, `data-*`, `style`. |

NPS fields (`type: nps`) additionally accept `positiveLabel` and `negativeLabel` in-line; the scale defaults to 0–10 but can be overridden with `props.options` (see NPS_SURVEY below).

### Example 1 — dashboard default multi-field form

Verbatim from `frigade-web/src/data/data.ts:437-489`:

```yaml
steps:
  - id: step-1
    title: Form title
    subtitle: Copy about the information users are being asked to give, why it is
      required and how it benefits them.
    primaryButton:
      title: Submit
    fields:
      - id: test-text
        type: text
        label: Text input
        maxLength: 10
        placeholder: Text input placeholder
        required: This field is required
      - id: email
        type: text
        label: Your email
        placeholder: your@email.com
        required: Email is required
        pattern:
          message: Please provide a valid email
          value: ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$
      - id: test-textarea
        type: textarea
        label: Textarea input
        placeholder: Textarea input placeholder
        pattern:
          value: /foo/
          message: This textarea is invalid with a custom message
      - id: test-select
        type: select
        label: Select input
        required: true
        options:
          - label: Option 1
            value: 1
          - label: Option 2
            value: 2
          - label: Option 3
            value: 3
      - id: test-radio
        type: radio
        label: Radio group
        options:
          - label: Radio 1
            value: 1
          - label: Radio 2
            value: 2
          - label: Radio 3
            value: 3
      - id: test-checkbox
        type: checkbox
        label: I accept the terms of use
```

Shows all six built-in field types in one step: `text` (with `required` as a string message + `pattern` regex), `textarea`, `select`, `radio`, `checkbox`.

### Example 2 — branching multi-page form

Verbatim from `demo-v2/src/lib/flow-details.ts:266-387` (`FORM_FLOW_ID = 'flow_kTB2fci9'`, the demo form with branching):

```yaml
steps:
  - id: welcome
    title: Forms
    subtitle: Build powerful, native forms with Frigade. Flexible like Typeform, but
      fully customizable and within your own product –&nbsp;not just iframes.
    primaryButton:
      title: Get started
  - id: branching
    title: Branching
    subtitle: Frigade supports form branching based on user inputs. Try it yourself
      by choosing an option below.
    secondaryButton:
      title: Back
      action: flow.back
    primaryButton:
      title: Continue
    fields:
      - id: input
        type: radio
        required: true
        options:
          - label: "Show me a dropdown "
            value: dropdown
          - label: Show me a text input
            value: text
          - label: Show me a multi-select
            value: multi
  - id: choice-dropdown
    title: Frigade has dropdown components
    visibilityCriteria: user.flowStepData('flow_kTB2fci9', 'branching', 'input') == 'dropdown'
    secondaryButton:
      title: Back
      action: flow.back
    primaryButton:
      title: Next
    fields:
      - id: dropdown
        type: select
        label: Dropdown
        required: true
        options:
          - label: One
            value: one
          - label: Two
            value: two
          - label: Three
            value: three
  - id: choice-text
    title: Frigade has text components
    visibilityCriteria: user.flowStepData('flow_kTB2fci9', 'branching', 'input') == 'text'
    secondaryButton:
      title: Back
      action: flow.back
    primaryButton:
      title: Next
    fields:
      - id: text
        type: text
        label: Text
        required: true
        placeholder: Write anything...
  - id: choice-multi
    title: Frigade has multi-select components
    visibilityCriteria: user.flowStepData('flow_kTB2fci9', 'branching', 'input') == 'multi'
    secondaryButton:
      title: Back
      action: flow.back
    primaryButton:
      title: Next
    fields:
      - id: multi
        type: select
        multiple: true
        label: Multi-select
        required: true
        options:
          - label: One
            value: one
          - label: Two
            value: two
          - label: Three
            value: three
  - id: custom-components
    title: Custom components
    subtitle: Frigade supports embedding components within forms. This page of the
      form is a custom component that talks to an external movie API and
      populates the dropdown list dynamically.
    secondaryButton:
      title: Back
      action: flow.back
    primaryButton:
      title: Continue
    fields:
      - id: movie-typeahead
        type: movie-typeahead
  - id: custom-components-video
    title: Mandatory video
    subtitle: Please watch the following video to continue
    primaryButton:
      title: Continue
    fields:
      - id: mandatory-video
        required: true
        type: mandatory-video
  - id: contact-us
    title: Learn more
    subtitle: Visit our developer docs to see all Form options, or feel free to grab
      time with our team to discuss your usecase.
    secondaryButton:
      title: Visit docs
      action: false
      uri: https://docs.frigade.com/v2/component/form
      target: _blank
    primaryButton:
      title: Finish
    fields:
      - id: custom-typeahead
        type: custom-typeahead
```

Highlights:
- `visibilityCriteria: user.flowStepData('flow_kTB2fci9', 'branching', 'input') == 'dropdown'` skips the step entirely unless the user picked `dropdown` on the `branching` step. Each branch step has its own criterion.
- `secondaryButton.action: flow.back` moves the user backward (only meaningful across steps).
- `type: movie-typeahead`, `type: mandatory-video`, `type: custom-typeahead` are **custom field types** — they map to a component provided via `<Frigade.Form fieldTypes={{ 'movie-typeahead': MyComponent, ... }} />`. The YAML key must match the `fieldTypes` object key.

---

## NPS_SURVEY / SURVEY

`SURVEY` is the `FlowType`; the NPS variant uses `type: nps` on a form field. Rendered by `<Frigade.Survey.NPS>`. Structurally: a FORM flow where the first step contains an `nps` field. See the `type: nps` field + `props.options` override for custom scales.

### Example 1 — default NPS (0–10) scale

Verbatim from `demo-v2/src/lib/flow-details.ts:74-96` (`NPS_FLOW_ID = 'flow_Gd8oTupY'`):

```yaml
props:
  dismissible: true
steps:
  - id: nps-score-page
    title: How likely are you to recommend us to a friend or colleague?
    fields:
      - id: nps-score
        type: nps
        label: NPS input field
        positiveLabel: Extremely likely
        negativeLabel: Not likely at all
  - id: nps-feedback-page
    title: Why did you choose this rating?
    primaryButton:
      title: Submit
    fields:
      - id: nps-feedback-text
        type: textarea
        placeholder: Your answer goes here
```

Top-level `props.dismissible: true` makes the whole survey closeable. The first step has no `primaryButton` — picking an NPS value auto-advances. The second step's `Submit` button uses the default `step.complete` action (implicitly → `flow.complete` since it's the last step).

### Example 2 — custom emoji scale via `props.options`

Verbatim from `frigade-web/src/data/data.ts:616-647` (the "Emoji Survey" dashboard template):

```yaml
props:
  dismissible: true
  alignSelf: "flex-end"
  justifySelf: "flex-end"
  negativeLabel: Very bad
  positiveLabel: Very good
  options:
    - label: "😞"
      value: "0"
    - label: "😕"
      value: "1"
    - label: "😐"
      value: "2"
    - label: "🙂"
      value: "3"
    - label: "😍"
      value: "4"
steps:
  - id: nps-score-page
    title: Please rate your experience
    fields:
      - id: nps-score
        type: nps
        label: NPS input field
  - id: nps-feedback-page
    title: Why did you choose this rating?
    primaryButton:
      title: Submit
    fields:
      - id: nps-feedback-text
        type: textarea
        placeholder: Your answer goes here
```

`props.options` overrides the default 0–10 numeric scale with 5 emoji. `alignSelf`/`justifySelf` pin the survey to the bottom-right corner of the container.

---

## BANNER

Persistent strip (usually top or bottom of a page/container) with title, subtitle, and optional CTA. Rendered by `<Frigade.Banner>`. Single-step flows are the norm.

### Fields

Just the shared step shape. Banners rarely have more than one step, so `primaryButton.action` defaults (`step.complete`) close the banner. Use `action: flow.skip` on a dismiss CTA if you want the banner state marked "dismissed" rather than "completed" — semantics matter for analytics.

### Example 1 — dashboard default (1 step, primary CTA only)

Verbatim from `frigade-web/src/data/data.ts:168-173`:

```yaml
steps:
  - id: step-1
    title: Banner title
    subtitle: Copy that provides context about what is being shown in the modal. Give specific instruction if needed and focus on what users value.
    primaryButton:
      title: Button CTA
```

### Example 2 — live banner chained after a TOUR (demo-v2)

Verbatim from `demo-v2/src/lib/flow-details.ts:206-215` (`BANNER_FLOW_ID = 'flow_LrVN8xha'`):

```yaml
steps:
  - id: banner-announcement
    title: You completed the tour!
    subtitle: This is a Frigade banner that uses <a
      href='https://docs.frigade.com/v2/platform/targeting' target='_blank'
      style='color:#0171F8;'>targeting</a> to automatically show after the tour.
```

No `primaryButton`, no `secondaryButton` — the banner has only the built-in close X (and appears because the outer flow's `targetingLogic` fires after the tour completes). HTML `<a>` tag is inlined. The targeting ("show after tour X completes") is on the outer flow record, not here — see `targeting-and-rules.md`.

---

## CARD

Inline UI content card (in-flow promotion, sidebar tip, inline setup nudge). Rendered by `<Frigade.Card>`. Single-step is typical.

### Fields

Shared step shape. Structurally similar to BANNER but rendered as a card component, not a horizontal bar.

### Example 1 — minimal dashboard default

Verbatim from `frigade-web/src/data/data.ts:212-217`:

```yaml
steps:
  - id: my-card
    title: Card title
    subtitle: Copy about the specific feature or functionality. Be specific and suggest other actions if possible.
    primaryButton:
      title: Button CTA
```

### Example 2 — live demo card (no CTAs, dismiss-only)

Verbatim from `demo-v2/src/lib/flow-details.ts:217-228` (`BANNER_CARD_FLOW_ID = 'flow_yupOQHJs'`, despite the name it is registered as a CARD in the demo's rendering):

```yaml
steps:
  - id: banner-announcement
    title: Inline UI Components
    subtitle: Frigade components like this banner and the below card sit within your
      product, not on top of it.
    primaryButton:
      title: Hide
      action: step.complete
```

Also `demo-v2/src/lib/flow-details.ts:230-237` (`CARD_FLOW_ID = 'flow_89rqfLTS'`) — a truly minimal single-step card with no buttons at all:

```yaml
steps:
  - id: my-card
    title: Frigade Card
    subtitle: Dismiss this card.
```

---

## MODAL (rendering variant — not a FlowType)

"Modal" is a rendering choice, not a flow type. Any flow component can be rendered modally by passing `as={Frigade.Dialog}` (or the `modal` prop). The YAML is identical to a non-modal version. `demo-v2`'s `STYLED_MODAL_FLOW_ID`, `CUSTOM_MODAL_FLOW_ID`, `MODAL_FLOW_ID` are all stored with `FlowType = ANNOUNCEMENT` server-side. See ANNOUNCEMENT Example 2.

For a single-step modal survey from `docs/component/form.mdx`:

```yaml
steps:
  - id: waitlist-page
    title: Join the waitlist
    subtitle: Get pumped! We are launching soon.
    primaryButton:
      title: Join the waitlist
    fields:
      - id: company-size
        type: radio
        label: Company size
        options:
          - label: 1-10
            value: 1-10
          - label: 20-100
            value: 20-100
          - label: 100+
            value: 100
      - id: industry
        type: select
        label: Industry
        options:
          - label: Icecream making
            value: icecream
          - label: Guitar riffing
            value: guitar-riffing
      - id: name
        type: text
        label: Your name
        placeholder: John Doe
```

Rendered by `<Frigade.Form flowId="my-flow-id" as={Frigade.Dialog} dismissible />`. YAML is a plain FORM.

---

## EMBEDDED_TIP / SUPPORT / CUSTOM

These three `FlowType` values exist in the SDK enum but are not exposed in the dashboard's "new flow" UI (they are absent from `frigade-web/src/data/data.ts`). They are used by legacy flows and by the `<Frigade.Support>` headless primitive.

- `SUPPORT` — headless help-hub flow. YAML structure is checklist-like; rendered by custom UI or `<Frigade.Support>`. **No real example in the read-only source set — awaiting real example from team.**
- `EMBEDDED_TIP` — inline hint variant. **No real example in source — awaiting real example from team.**
- `CUSTOM` — when the user builds a fully bespoke UI from `useFlow()`/`useStep()`. YAML structure is open-ended: typically just `steps[]` with `id`/`title`/`subtitle` used as content for the custom renderer.

Synthetic minimal example (labeled — do NOT copy to customers without confirmation):

```yaml
# synthetic — awaiting real example from team
steps:
  - id: my-custom-step
    title: Custom step
    subtitle: Rendered by a user-supplied React component via useFlow()/useStep().
```

---

## Common validation gotchas

- **`slug` uniqueness** — the flow record's outer `slug` must be unique per workspace (not per environment). Collision returns HTTP 400 with a "slug already exists" message. See `errors.md` for the canonical REST error shape and `operations.md` §Flow operations for the createFlow surface.
- **`selector` (TOUR)** — must resolve to exactly one element at render time. Zero matches → step skipped silently. Multiple matches → first match used. Prefer stable `id` selectors over class chains.
- **`imageUri` / `videoUri` HTTPS** — browsers block mixed content. For Frigade-hosted images upload via POST `/v1/cdnUpload` (`rest-endpoints.md`) and paste the returned URL.
- **YAML indentation** — use two spaces. Server-side parse errors from tabs or odd indentation surface as 422 with a YAML parser message in `body.message`. Always lint locally with `yaml.load()` before POSTing.
- **Keys are camelCase** — match the TS types (`imageUri`, `primaryButton`, `visibilityCriteria`). Snake_case or kebab-case will silently ignore unknown fields.
- **Step `id` immutability** — changing a step's `id` after users have state against it orphans the state (user's completion for the old ID is no longer reachable by the new step). If renaming, follow the dev→prod promotion path with a flow version bump (`operations.md` §Flow operations, `createFlowVersion`).
- **Cross-flow CTA** — there is no `action` value that starts another flow. Use the React `onPrimary`/`onSecondary` handler pattern documented in `sdk-react.md` D12.
- **`NUDGE` / `MODAL` are not FlowTypes** — if the user asks for one, clarify which real type (Hint/Banner/Card for "nudge"; set `as={Frigade.Dialog}` on any flow for "modal").
- **Secondary-button default action** — same as primary: defaults to `step.complete`. For an outbound link that must NOT complete the step, set `action: false` explicitly (as every example in this reference does).

## Round-trip

- The dashboard's "Advanced Editor" renders from and writes to exactly this YAML. There are no dashboard-specific fields that aren't in the YAML.
- Flow records also have an `internalData` blob (separate from `data`) that the backend uses for dev-prod pairing and promotion metadata. **Do not author `internalData` via YAML.** The skill MUST NOT touch it on create/update — the server manages it during promotion (`operations.md` §Flow operations, `promoteFlow`).
- `version` on the outer record is server-managed. Don't set it on create. To cut a new version of an existing flow, use `createFlowVersion` (POST `/v1/flows/:id/versions`) rather than PUT-ing a version field.
