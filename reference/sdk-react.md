# @frigade/react SDK Reference

**Version:** `2.9.4` (the current major line; the package on npm is `@frigade/react@2.9.4`, which is built from the `reactv2` workspace in the `FrigadeHQ/javascript` monorepo — historically it was tagged `2.0.0-alpha.3` inside that monorepo but shipped as `2.9.4` to npm).

**Source of truth:** `/Users/ericbrownrout/Library/Code/frigade-web/node_modules/@frigade/react` (version 2.9.4, used by the dashboard and `demo-v2`). Raw `.d.ts` at `.../dist/index.d.ts` (2090 lines) is the authoritative type surface. The local monorepo at `/Users/ericbrownrout/Library/Code/frigade-react` (HEAD `a52a620`, "Fix reactv2 version and changelog") is an earlier alpha snapshot and does NOT match what npm ships — prefer the installed `node_modules` types when there is a disagreement. (It has one untracked path `lib/`, but no staged diff.)

- Legacy SDK: `@frigade/reactv1` (aliased from `@frigade/react@1.38.x`). Not covered here. The dashboard pins it as `"@frigade/reactv1": "npm:@frigade/react@1.38.46"` for a small number of legacy screens. **Recipes should always generate code against `@frigade/react@^2.9.x`.**
- Underlying JS runtime: `@frigade/js` (exported from this package as `FrigadeJS`; also imported directly by some dashboard code).

## Install

```bash
npm install @frigade/react
```
```bash
yarn add @frigade/react
```
```bash
pnpm add @frigade/react
```

No peer deps to install manually — the SDK ships with Emotion, Radix primitives, Floating UI, and `react-hook-form` pre-bundled. Requires React 18+ as a peer.

## Environment variables

- **`NEXT_PUBLIC_FRIGADE_API_KEY`** — **PUBLIC** Frigade API key. Begins with `api_public_...`. This is the ONLY key that belongs on the client and the only one that should ever appear in an `apiKey` prop or `NEXT_PUBLIC_*` var. Confirmed in `frigade-web/src/app/layout.tsx`, `frigade-web/src/components/providers/frigade.tsx`, `frigade-web/.env.local.example`, and `demo-v2/src/components/providers.tsx` / `demo-v2/.env.example`. The `NEXT_PUBLIC_` prefix is required by Next.js to expose the variable to the browser; use `PUBLIC_` (Vite), `VITE_` (Vite), `REACT_APP_` (CRA), or your framework's equivalent prefix for other stacks. Recipes generating `.env.local` stubs MUST use `NEXT_PUBLIC_FRIGADE_API_KEY` for Next.js projects.
- **`NEXT_PUBLIC_FRIGADE_API_URL`** *(optional)* — override for the Frigade API base URL; defaults to production. Only set this when the user explicitly wants to hit a dev cluster (e.g. `https://ei.frigade.com/`). Pair with the `apiUrl` prop on `<Frigade.Provider>`.
- **NEVER put a private Frigade API key (any key starting with `api_private_`) in a React SDK env var or the `apiKey` prop.** The SDK is a browser-runtime library and whatever you put in `apiKey` ships to end users. Private keys are for server-side GraphQL/REST only (see `reference/graphql-schema.md` and `reference/rest-endpoints.md`).

### `.env.local` stub (Next.js)

```bash
NEXT_PUBLIC_FRIGADE_API_KEY=api_public_...
```

## Provider

### `<Frigade.Provider>` — a.k.a. `Provider` / `ProviderProps`

The Provider must wrap any subtree that renders a Frigade component or calls a Frigade hook. It initializes the SDK, establishes the user session, and drives background state sync.

Import patterns (both supported; recipes should pick one):

```tsx
// Namespace style (what the official docs and demo-v2 use)
import * as Frigade from '@frigade/react';
// ... <Frigade.Provider apiKey={...} />

// Named style
import { Provider } from '@frigade/react';
// ... <Provider apiKey={...} />
```

**Props (from `ProviderProps` at `dist/index.d.ts:1852`):**

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `apiKey` | `string` | **Yes** | Public API key (`api_public_...`). Never use a private key here. |
| `apiUrl` | `string` | No | API base URL prefix. Defaults to `https://api.frigade.com/v1/public`. |
| `children` | `ReactNode` | No | Your app. |
| `css` | `Record<string, unknown>` | No | Global Emotion CSS attached to `:root` (e.g. tweaking `.fr-dialog-wrapper`). |
| `defaultCollection` | `boolean` | No | When `true` (default), the Provider renders a built-in Collection that auto-surfaces Announcements and other floating flows from the dashboard with zero manual component placement. Set `false` to disable. |
| `generateGuestId` | `boolean` | No | Defaults `true`. If no `userId` is supplied, Frigade mints a guest ID and stores it in `localStorage` so unauthenticated users can have persistent flow state. |
| `syncOnWindowUpdates` | `boolean` | No | Defaults `true`. Re-syncs flow state on URL change or window focus. |
| `groupId` | `string` | No | Group/organization the current user belongs to. |
| `groupProperties` | `PropertyPayload` | No | Properties to attach to `groupId` at init. |
| `userId` | `string` | No | App's own user identifier. If omitted and `generateGuestId` is true, a guest ID is minted. |
| `userProperties` | `PropertyPayload` | No | Properties to attach to `userId` at init. |
| `navigate` | `(url: string, target?: string) => void` | No | Custom router. By default Frigade calls `window.location` / `window.open`. For Next.js App Router you almost always want to wire this to `useRouter().push`. See the Next.js example below. |
| `theme` | `Theme` | No | Global design-token overrides. Deep-partial of the `tokens` export. |
| `themeSelector` | `string` | No | CSS selector to scope Frigade CSS variables into. Defaults to `:root`. |
| `preloadImages` | `boolean` | No | Defaults `true`. Preloads flow images. |
| `variables` | `Record<string, unknown>` | No | Global template variables available to every flow/collection (e.g. i18n strings). |

**Minimal usage (any React app):**

```tsx
import * as Frigade from '@frigade/react';

export function App({ children }: { children: React.ReactNode }) {
  return (
    <Frigade.Provider
      apiKey={process.env.NEXT_PUBLIC_FRIGADE_API_KEY!}
      userId="auth-user-id-from-your-auth-system"
      userProperties={{ email: 'john@doe.com', name: 'John Doe' }}
    >
      {children}
    </Frigade.Provider>
  );
}
```

**Next.js App Router (recommended; also wires router-aware navigation):**

```tsx
// app/frigade-provider.tsx
'use client';

import * as Frigade from '@frigade/react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

export function FrigadeProvider({ children }: { children: ReactNode }) {
  const router = useRouter();

  return (
    <Frigade.Provider
      apiKey={process.env.NEXT_PUBLIC_FRIGADE_API_KEY!}
      userId="auth-user-id"
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

```tsx
// app/layout.tsx
import { FrigadeProvider } from './frigade-provider';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <FrigadeProvider>{children}</FrigadeProvider>
      </body>
    </html>
  );
}
```

## Components

All renderable flow components accept the base `FlowPropsWithoutChildren` shape unless noted. Shared props (see `dist/index.d.ts:1349`):

- `flowId: string` (**required**) — the dashboard flow slug to render.
- `autoStart?: boolean` — defaults `true`. When `false`, you must call `flow.start()` or `step.start()` manually.
- `as?: React.ElementType` — wrapper element (e.g. `as={Dialog}` to force modal).
- `css?` — Emotion CSS prop. Override Frigade parts with selectors like `{ '.fr-button-primary': { backgroundColor: 'fuchsia' } }`.
- `dismissible?: boolean` — whether the user can close the flow.
- `forceMount?: boolean` — mount even if the flow was already completed/dismissed (still respects targeting).
- `modal?: boolean` — register as modal (only one modal flow renders at a time — prevents popup collisions).
- `onComplete?: FlowHandlerProp` — fires when the flow is completed. Signature `(flow, event?) => boolean | Promise<boolean | void>`. Return `false` to cancel the state update.
- `onDismiss?: FlowHandlerProp` — fires when the flow is dismissed. Same signature as `onComplete`.
- `onPrimary?: StepHandlerProp` — fires when the primary button of any step is clicked. Signature `(step, event?, properties?) => boolean | Promise<boolean | void>`. Return `false` to prevent automatic step completion.
- `onSecondary?: StepHandlerProp` — same as above for the secondary button.
- `variables?: Record<string, unknown>` — per-flow template variables; merged over provider `variables`.

### `<Frigade.Announcement>` — modal announcement

`AnnouncementProps extends FlowPropsWithoutChildren, DialogProps`. Intended for interrupt-style modal callouts; also accepts Radix Dialog props (`onEscapeKeyDown`, `onPointerDownOutside`, `onInteractOutside`, `onOpenAutoFocus`, `onCloseAutoFocus`, `onOpenChange`).

```tsx
import * as Frigade from '@frigade/react';

export function HomePage() {
  return <Frigade.Announcement flowId="flow_abc123" dismissible />;
}
```

### `<Frigade.Banner>` — top/bottom banner

`BannerProps extends FlowPropsWithoutChildren`. Renders inline wherever you place it.

```tsx
<Frigade.Banner flowId="flow_banner_xyz" />
```

### `<Frigade.Tour>` — product tour / tooltips

`TourProps extends FlowPropsWithoutChildren, Omit<HintProps, 'anchor'>`. Steps are anchored via CSS selectors in the flow YAML (`selector: "#my-element"`). Key extras:

| Prop | Type | Purpose |
| --- | --- | --- |
| `align` | `'start'\|'center'\|'end'\|'before'\|'after'` | Tooltip alignment relative to anchor. |
| `alignOffset` | `number` | Offset along the align axis. |
| `side` | `'top'\|'right'\|'bottom'\|'left'` | Preferred side. |
| `sideOffset` | `number` | Pixels from anchor. |
| `autoScroll` | `boolean \| ScrollIntoViewOptions` | Scroll anchor into view on step activation. |
| `defaultOpen` | `boolean` | Initial open state. Set `false` for hint-marker-only behavior. |
| `modal` | `boolean` | Render an overlay behind the tooltip. |
| `spotlight` | `boolean` | Highlight the anchor with a spotlight/scrim. |
| `sequential` | `boolean` | Defaults `true`. Set `false` to show all steps at once (hint mode). |
| `container` | `Element \| DocumentFragment \| string` | Portal target. |
| `open`, `onOpenChange` | — | Controlled open state. |
| `lockScroll` | `boolean` | Default `true` when spotlight is on. |

```tsx
<Frigade.Tour flowId="flow_tour_123" spotlight modal />
```

Hint usage is a Tour with `sequential={false}` and `defaultOpen={false}`.

### `<Frigade.Checklist>` — namespace of checklist layouts

Exported as a **namespace**; you choose a layout:

- `<Frigade.Checklist.Collapsible>` — vertical accordion checklist. Accepts `stepTypes?: Record<string, (props: CollapsibleStepProps) => JSX.Element>` to register custom step components keyed by the step's YAML `type`. The namespace also re-exports `CollapsibleStep.{Root, Trigger, Content}` for building custom step renderers.
- `<Frigade.Checklist.Carousel>` — horizontal carousel checklist. `sort?: 'default' | 'completed-last'`.
- `<Frigade.Checklist.Floating>` — floating checklist attached to an anchor (extends Popover props).

```tsx
<Frigade.Checklist.Collapsible flowId="flow_checklist" />
<Frigade.Checklist.Carousel flowId="flow_checklist" sort="completed-last" />
```

### `<Frigade.Card>` — inline card (and sub-parts)

`Card` is a component with static subcomponents: `Card.Dismiss`, `Card.Header`, `Card.Footer`, `Card.Media`, `Card.Primary`, `Card.Secondary`, `Card.Subtitle`, `Card.Title`. Use the subcomponents for fully custom layouts when the default isn't enough.

```tsx
<Frigade.Card flowId="flow_card_xyz">
  <Frigade.Card.Header title="Welcome" dismissible />
  <Frigade.Card.Media />
  <Frigade.Card.Title />
  <Frigade.Card.Subtitle />
  <Frigade.Card.Footer>
    <Frigade.Card.Secondary />
    <Frigade.Card.Primary />
  </Frigade.Card.Footer>
</Frigade.Card>
```

### `<Frigade.Form>` — multi-step form / survey

`FormProps extends FlowPropsWithoutChildren`. Extras:

- `fieldTypes?: Record<string, React.ComponentType<FormFieldProps>>` — register custom field renderers. The YAML step's `type` field selects the renderer.

Built-in field components (each takes `FormFieldProps`): `TextField`, `TextareaField`, `SelectField`, `RadioField`, `BaseField`, `Label`. Use these as the base for custom fields or to extend the default field registry.

```tsx
import * as Frigade from '@frigade/react';
import { FormFieldProps } from '@frigade/react';

function CalendarField({ field }: FormFieldProps) {
  return <input type="date" onChange={field.onChange} value={field.value} />;
}

<Frigade.Form flowId="flow_survey_123" fieldTypes={{ calendar: CalendarField }} />
```

### `<Frigade.Survey.NPS>` — Net Promoter Score survey

A specialized `<Form>`. Extra props:

- `options?: Array<{ label: string; value: string }>` — defaults to 0–10.
- `positiveLabel?: string` — defaults to "Extremely likely".
- `negativeLabel?: string` — defaults to "Not likely at all".

```tsx
<Frigade.Survey.NPS flowId="flow_nps_xyz" dismissible />
```

### `<Frigade.Hint>` — standalone anchored tooltip

`HintProps extends BoxProps` with `anchor: string` (CSS selector) **required**. Same align/side/offset/spotlight/modal/autoScroll prop family as Tour. For building one-off tooltips not tied to a full Tour.

### `<Frigade.Tooltip>` — primitive popover

Low-level wrapped Radix Popover. Props: `anchor?`, `align?`, `spotlight?`, `zIndex?`, plus Radix `defaultOpen`/`modal`/`onOpenChange`/`open`. Static sub-parts: `Tooltip.Title`, `Tooltip.Subtitle`, `Tooltip.Media`, `Tooltip.Primary`, `Tooltip.Secondary`, `Tooltip.Progress`, `Tooltip.Close`. Used internally by Tour; also usable standalone.

### `<Frigade.Dialog>` — primitive modal

Low-level wrapped Radix Dialog. Pass as `as={Dialog}` to other components to force modal rendering. Static sub-parts: `Dialog.Title`, `Dialog.Subtitle`, `Dialog.Media`, `Dialog.Primary`, `Dialog.Secondary`, `Dialog.Dismiss`, `Dialog.ProgressDots`.

### `<Frigade.Popover>` — primitive popover namespace

Namespace with `Popover.Root`, `Popover.Content`, `Popover.Trigger`. Use with align/side/offset/autoScroll/modal/spotlight props. Backing store for Checklist.Floating.

### `<Frigade.Collection>` — render a named collection of flows

```tsx
<Frigade.Collection collectionId="welcome-collection" variables={{ name: 'John' }} />
```

Renders every flow in the named dashboard Collection in order. The Provider already renders the default Collection if `defaultCollection` is not false, so explicit `<Collection>` is only needed for secondary groupings.

### `<Frigade.Flow>` — headless render-prop flow

When you want full control of markup. `FlowProps extends FlowPropsWithoutChildren` with `children?: (props: FlowChildrenProps) => ReactNode`.

```tsx
<Frigade.Flow flowId="flow_custom">
  {({ flow, step, handleDismiss, handlePrimary, handleSecondary }) => (
    <MyCustomRenderer
      title={step.title}
      subtitle={step.subtitle}
      onPrimary={handlePrimary}
      onSecondary={handleSecondary}
      onDismiss={handleDismiss}
    />
  )}
</Frigade.Flow>
```

`FlowChildrenProps = { flow, step, handleDismiss, handlePrimary, handleSecondary, parentProps }`. Each handler is pre-bound to optimistically update flow state and call the API.

### `<Frigade.ProgressBadge>` — progress pill

`ProgressBadgeProps extends FlowPropsWithoutChildren` with optional `title` override. Shows a badge indicating how far the user has progressed in a given flow; useful for sidebar nav.

### `<Frigade.Progress>` — progress primitives namespace

Namespace: `Progress.Bar`, `Progress.Dots`, `Progress.Fraction`, `Progress.Ring`, `Progress.Segments`. Each takes `{ current: number; total: number }`. Use to render progress in custom layouts.

### Auxiliary renderables

- `<Frigade.Spotlight>` — standalone scrim/spotlight over an `anchor` CSS selector.
- `<Frigade.Ping>` — animated pulsing dot, good as a "new feature" affordance on an icon; `clickable?: boolean`.
- `<Frigade.Image>`, `<Frigade.Video>`, `<Frigade.Media>` — media primitives auto-detecting video vs image by URL.
- `<Frigade.Box>`, `<Frigade.Flex>` (with `Flex.Row`, `Flex.Column`), `<Frigade.Text>` (with `Text.H1..H4`, `Text.Display1/2`, `Text.Body1/2`, `Text.Caption`), `<Frigade.Button>` (with `Button.Primary`, `Button.Secondary`, `Button.Link`, `Button.Plain`) — layout + text + button primitives built on Emotion and used internally by the stock components.
- `<Frigade.ClientPortal>` — portals children into an arbitrary DOM container.

### Low-level handler hooks (for custom render-prop flows)

- `useFlowHandlers(flow, { onComplete, onDismiss })` → `{ handleDismiss }`.
- `useStepHandlers(step, { onPrimary, onSecondary })` → `{ handlePrimary, handleSecondary }`.
- `useBoundingClientRect()` → `{ node, rect, ref }` for measuring anchors.
- `useAutoScroll(element, enabled?)` — auto-scroll an element into view.

## Hooks (application-facing)

All four must be called inside a `<Frigade.Provider>`.

### `useFlow(flowId: string | null, config?: FlowConfig) → { flow: Flow | undefined; isLoading: boolean }`

Primary hook. Access the `Flow` object for a given ID to read/write state imperatively. `FlowConfig = { variables?: Record<string, unknown> }`.

The returned `flow` (from `@frigade/js`) has:
- `flow.id`, `flow.title`, `flow.subtitle`, `flow.metadata`, `flow.rawData`
- `flow.isStarted`, `flow.isCompleted`, `flow.isSkipped`
- `flow.steps: Map<string, FlowStep>` — each step has `.start(props?)`, `.complete(props?)`, plus the YAML fields (`title`, `subtitle`, `primaryButtonTitle`, `primaryButtonUri`, `primaryButtonUriTarget`, `secondaryButton*`, `completionCriteria`, `startCriteria`, `visibilityCriteria`, `props`, `isCompleted`, `isStarted`, `isHidden`, `isBlocked`, etc.).
- `flow.start(props?)`, `flow.complete(props?)`, `flow.skip(props?)`, `flow.restart()`.
- `flow.getCurrentStep()`, `flow.getStepByIndex(i)`, `flow.getNumberOfCompletedSteps()`.

```tsx
import { useFlow } from '@frigade/react';

function MyNav() {
  const { flow } = useFlow('flow_onboarding');
  if (!flow) return null;
  return <span>{flow.getNumberOfCompletedSteps()} / {flow.steps.size} done</span>;
}
```

Use this when: building a custom UI for a flow, programmatically starting/skipping/completing a flow, reading progress for a sidebar/progress-badge.

### `useUser() → { userId, addProperties, track, isLoading }`

- `addProperties(properties: Record<string, unknown>) → Promise<void>` — merges props onto the current user.
- `track(eventName: string, properties?: Record<string, unknown>) → Promise<void>` — sends a tracking event keyed to the current user. Useful for triggering targeting rules.

Standardized user properties: `email`, `name`, `firstName`, `lastName`, `imageUrl`.

### `useGroup() → { groupId, setGroupId, addProperties, track, isLoading }`

- `setGroupId(groupId, properties?) → Promise<void>` — switch the active group context. **Warning:** mixing this with the `groupId` Provider prop leads to undefined behavior; pick one.
- `addProperties`, `track` — same shape as `useUser`.

Standardized group properties: `name`, `imageUrl`.

### `useFrigade() → { frigade: Frigade; isLoading }`

Escape hatch exposing the underlying `@frigade/js` `Frigade` class. Rarely needed; use for event subscriptions (`frigade.on('flow.start', ...)`) or bulk `getFlows`/`getCollections` calls.

```tsx
import { useFrigade } from '@frigade/react';
import { useEffect } from 'react';

function Telemetry() {
  const { frigade } = useFrigade();
  useEffect(() => {
    const handler = (flow) => console.log('flow changed:', flow.id);
    frigade.on('flow.any', handler);
    return () => frigade.off('flow.any', handler);
  }, [frigade]);
  return null;
}
```

`Frigade` class surface (from `@frigade/js`):
- `getFlow(flowId) → Promise<Flow>`
- `getFlows() → Promise<Flow[]>`
- `getCollections() → Promise<CollectionsList>`
- `identify(userId, properties?) → Promise<void>`
- `group(groupId?, properties?) → Promise<void>`
- `on(event, handler)` / `off(event, handler)` — `event` is a `FlowChangeEvent`, one of: `flow.any`, `flow.complete`, `flow.restart`, `flow.skip`, `flow.start`, `step.complete`, `step.skip`, `step.reset`, `step.start`.
- `onStateChange(handler)` — **deprecated**, use `frigade.on('flow.any', handler)`.
- `hasFailedToLoad() → boolean`
- `getConfig() → FrigadeConfig`

Prefer `useFlow`/`useUser`/`useGroup` over `useFrigade` unless you specifically need event subscriptions or the raw Frigade instance.

## CTA action types

CTAs live in the **flow YAML** (authored in the dashboard or via the GraphQL flow-save mutations in `reference/graphql-schema.md`). Each step has a `primaryButton` and a `secondaryButton` block with the following shape:

```yaml
steps:
  - id: welcome
    title: Welcome!
    subtitle: Take a quick tour
    primaryButton:
      title: "Take the tour"
      action: flow.start       # see table below
      uri: "/onboarding"       # used when action navigates (or when action is unset and fallbacks to navigate-on-complete)
      target: _self            # _self (same tab) or _blank (new tab); omit for SDK-default
    secondaryButton:
      title: "Maybe later"
      action: step.skip
```

**Key fields:**

| Field | Type | Meaning |
| --- | --- | --- |
| `steps[].primaryButton.title` | `string` | Button label. If omitted, the button is hidden. |
| `steps[].primaryButton.action` | `string \| false` | Side effect to apply when the button is clicked (see enum below). `false` disables the default action entirely; the `onPrimary` React prop can still fire. |
| `steps[].primaryButton.uri` | `string` | URL to navigate to. Combined with `action`, navigation runs *after* the action's state update. |
| `steps[].primaryButton.target` | `string` | `_self` (default) or `_blank`. Passed to the Provider's `navigate` handler. |
| `steps[].secondaryButton.*` | same as above | Same shape for the secondary button. |
| Deprecated flat fields: `primaryButtonTitle`, `primaryButtonUri`, `primaryButtonUriTarget`, `secondaryButtonTitle`, `secondaryButtonUri`, `secondaryButtonUriTarget` | `string` | Older flow YAMLs used these instead of the nested object. Still accepted for backward compatibility, but recipes should emit the new nested `primaryButton: { ... }` form. |

**`action` enum values** (from `/docs/component/announcement.mdx:181` and the parallel Tour/Checklist/Form/NPS/Banner/Card docs — all share this enum):

| Value | Effect |
| --- | --- |
| `step.complete` | **Default.** Mark the current step completed and advance. |
| `step.start` | Mark the current step started. |
| `step.skip` | Mark the current step skipped. |
| `step.reset` | Reset the current step. |
| `flow.start` | Mark the **containing flow** as started. |
| `flow.complete` | Mark the containing flow completed, closing it. |
| `flow.skip` | Mark the containing flow skipped/dismissed. |
| `flow.forward` | Advance to the next step (no completion state change). |
| `flow.back` | Move to the previous step. |
| `flow.restart` | Reset the containing flow to step 1. |
| `false` | No built-in action; rely entirely on `onPrimary`/`onSecondary` React handlers. |

### Cross-flow CTAs — starting a *different* flow from a CTA

**The YAML `action` enum operates only on the containing flow** — there is no `action: flow.start:<target_id>` or `nextFlowId` syntax in the v2 SDK. The verdict: **Frigade does not ship a native declarative "start another flow" CTA action.** To wire a flow-to-flow CTA, the link-flows recipe (Task 18) should emit one of these patterns:

**Preferred — React `onPrimary`/`onSecondary` handler (purely client-side, no YAML changes to the first flow beyond `action: false`):**

```tsx
'use client';

import * as Frigade from '@frigade/react';
import { useFlow } from '@frigade/react';

export function Onboarding() {
  const { flow: tour } = useFlow('flow_product_tour');

  return (
    <Frigade.Announcement
      flowId="flow_welcome_modal"
      onPrimary={async () => {
        // Start the tour flow after the user clicks "Take the tour"
        await tour?.restart(); // or tour?.start() if it hasn't been started
        return true; // allow the announcement to complete + close
      }}
    />
  );
}
```

In the first flow's YAML, set the primary button's `action: false` (or leave the default `step.complete`) and omit `uri`. The React `onPrimary` handler does the flow-to-flow jump.

**Alternate — `uri` + Provider `navigate` hook:** if the target flow is gated behind a route, emit the first flow with `primaryButton.uri: /tour-page` and `target: _self`, and let the route change naturally render the second flow component. This is simpler but couples the linkage to URL structure.

The link-flows recipe should default to the first pattern (React handler with `useFlow(targetId).restart()`) because it doesn't require a page navigation and works with modal announcements that don't belong to any route.

## SSR / hydration notes

- **Next.js App Router — the Provider MUST be in a `'use client'` component.** Frigade uses `localStorage` for guest IDs, Emotion CSS-in-JS, and Radix portals, all of which touch the DOM. Wrap the Provider in a tiny client component (see the App Router example above) and mount that component inside your root `layout.tsx`.
- **Next.js Pages Router** — instantiate directly in `_app.tsx` (no directive needed).
- Flow components themselves are client-only too; always wrap any page that renders one with `'use client'` or split the branch into a client component.
- Hydration warnings: none typically required. If you see `suppressHydrationWarning` coming up, it's usually from the surrounding `<html>`/`<body>` for a theme toggle, not from Frigade — the Provider and components are stable once mounted.
- Frigade does NOT pre-render any HTML on the server; during SSR every component returns `null` / nothing until the client bootstrap completes. Count on a brief no-flash on first paint.

## User identification

- `userId` is set via the Provider prop. It is whatever identifier your auth system uses (e.g. your user's DB row id, Clerk `user.id`, etc.). **Send the same `userId` across sessions** so state persists.
- `userProperties` (Provider prop) attaches properties at init. You can also mutate properties later with `useUser().addProperties({...})`.
- **Anonymous / guest users** — omit `userId` (and leave `generateGuestId` at its default `true`). Frigade generates a guest ID, stores it in `localStorage`, and flow state persists across reloads. When the guest registers or logs in, you can merge their guest state into the authenticated user by calling the REST `POST /v1/public/users` endpoint with `{ userId, linkGuestId }` (see `reference/rest-endpoints.md`). Merge only applies if the authenticated user has no prior state.
- **Group context** — set `groupId` + `groupProperties` at the Provider. Alternatively, after mount, call `useGroup().setGroupId(groupId, properties)`. Do **not** do both; pick one source of truth. Group-scoped targeting uses `group.property('x') == y` in flow YAML.
- `useUser().track(event, props?)` sends a user-scoped tracking event; `useGroup().track(...)` is the group equivalent. These can fire targeting rules and trigger flows that depend on events.

## Navigation

When a step has a `primaryButton.uri` or `secondaryButton.uri`, Frigade calls the `navigate` function on the Provider (falling back to `window.location` / `window.open(url, '_blank')` when no handler is supplied).

Next.js handler (both App Router and Pages Router):

```tsx
import { useRouter } from 'next/navigation'; // use 'next/router' in Pages Router

const router = useRouter();

<Frigade.Provider
  navigate={(url, target) => {
    if (target === '_blank') {
      window.open(url, '_blank');
    } else {
      router.push(url);
    }
  }}
>
```

React Router handler:

```tsx
import { useHistory } from 'react-router-dom';

const history = useHistory();

<Frigade.Provider
  navigate={(url, target) => {
    if (target === '_blank') {
      window.open(url, '_blank');
    } else {
      history.push(url);
    }
  }}
>
```

## Styling

Three knobs, in increasing override strength:
1. **Provider `theme` prop** — deep-partial of the `tokens` export (semantic colors `primary`, `secondary`, `neutral`, `negative`, `positive` + color scales, `radii`, `shadows`, `space`, `fontSizes`, etc.). This is where you match Frigade to your app's brand.
2. **Component `css` prop** — Emotion CSS for one-off overrides; target internal `fr-*` parts via nested selectors (e.g. `.fr-button-primary`, `.fr-dialog-wrapper`).
3. **Global `css` prop on Provider** — attached to `:root`; useful for z-index fixes, e.g. `{ '.fr-dialog-wrapper': { zIndex: 100 } }`.

Exports for custom theming: `tokens`, `themeVariables`, `Theme` (type), `Tokens` (type).

## Exports reference (full)

Direct re-exports (from the installed `dist/index.d.ts` final export block):

**Provider & types:** `Provider`, `ProviderProps`.

**Renderable components:**
- `Announcement` / `AnnouncementProps`
- `Banner` / `BannerProps`
- `Card` / `CardProps` / `CardHeaderProps`
- `Checklist` (namespace: `Carousel`, `Collapsible` / `CollapsibleProps`, `CollapsibleStep` / `CollapsibleStepProps`, `Floating`)
- `Collection`
- `Dialog` / `DialogProps` (primitive; also usable via `as={Dialog}`)
- `Flow` / `FlowProps` / `FlowPropsWithoutChildren` / `FlowChildrenProps` / `FlowConfig`
- `Form` / `FormProps` / `FormFieldData` / `FormFieldProps` / `FieldTypes`
- `Hint`
- `Popover` (namespace: `Root`, `Content`, `Trigger` — plus `PopoverRootProps` / `PopoverContentProps` / `PopoverTriggerProps`)
- `Progress` (namespace: `Bar`, `Dots`, `Fraction`, `Ring`, `Segments`, plus `ProgressProps`)
- `ProgressBadge` / `ProgressBadgeProps`
- `Ping`
- `Spotlight`
- `Survey` (namespace: `NPS` / `NPSProps`)
- `Tooltip` / `TooltipProps`
- `Tour` / `TourProps`

**Primitives & layout:** `Box` / `BoxProps`, `Button` / `ButtonProps`, `Flex`, `Text` / `TextProps`, `Image`, `Video`, `Media`, `ClientPortal` / `ClientPortalProps`, `Label`.

**Form fields (use or register as `fieldTypes`):** `BaseField`, `RadioField`, `SelectField`, `TextField`, `TextareaField`.

**Handler types:** `DismissHandler`, `FlowHandlerProp`, `FlowHandlerProps`, `StepHandler`, `StepHandlerProp`, `StepHandlerProps`.

**Hooks:** `useFlow`, `useUser`, `useGroup`, `useFrigade`, `useFlowHandlers`, `useStepHandlers`, `useAutoScroll`, `useBoundingClientRect`.

**Theming:** `Theme`, `Tokens`, `tokens`, `themeVariables`.

**Re-exported namespaces:** `FrigadeJS` (the underlying `@frigade/js` module), `FloatingUI` (the underlying `@floating-ui/react` module — useful for custom positioning logic).

## Companion references

- `reference/graphql-schema.md` — authoring flows / collections / targeting / organizations via the private GraphQL endpoint.
- `reference/rest-endpoints.md` — REST operations (flow CRUD, user state, flow responses, etc.) via private key on `https://api3.frigade.com`.
