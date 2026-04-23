# Next.js App Router — Frigade Adapter

How the skill installs and wires `@frigade/react` into a Next.js **App Router** project.

**Canonical sources** (read when cross-checking anything below):
- `frigade-web` — Next.js 15 hybrid app. App Router at `src/app/` (auth routes), Pages Router at `src/pages/` (the main dashboard). Its `src/app/layout.tsx` is the canonical App-Router-under-Clerk wiring; its `src/components/providers/frigade.tsx` is the canonical `useRouter`-wired Frigade provider.
- `@frigade/react@2.9.4` (pinned in `frigade-web/package.json`).
- `NEXT_PUBLIC_FRIGADE_API_KEY` — confirmed in `frigade-web/.env.local.example` (also used by the Pages-Router section of `frigade-web` and by `demo-v2/.env.example`).

**This reference covers the wire-up only.** SDK surface (component props, hooks, CTA action enum, SSR nuances) lives in `sdk-react.md`.

## Detection

Claude should treat a project as App Router when **all** of:

1. `package.json` has `next` at `^13.0.0` or newer (App Router is stable from Next 13.4; `frigade-web` is on `15.5.12`, `demo-v2` is on `14.2.5`).
2. The repo contains an `app/` or `src/app/` directory with a `layout.tsx` (or `layout.js`) inside it. The presence of `layout.{tsx,js}` is the strongest signal — Pages Router has no such file.
3. Either there is **no** `pages/` / `src/pages/` directory, or there is one but it does not contain a `_app.tsx` (i.e. pages are colocated only for API routes).

**Hybrid case.** `frigade-web` ships with **both** an App Router (`src/app/`) AND a Pages Router (`src/pages/_app.tsx`). When Claude sees both, it should:
- Pick the router under which the route that will host the flow lives. An announcement on `/sign-in` wires via App Router (`src/app/layout.tsx`); an announcement on `/settings` (a pages-router route) wires via `pages/_app.tsx` (see `next-pages-router.md`).
- If uncertain, default to the App Router (it is the only one Next 13+ considers idiomatic; pages is in maintenance mode).

## Provider placement

**Canonical pattern** (what the skill emits):

1. Create a **client component** that wraps `<Frigade.Provider>` and re-exports a `Providers` wrapper. File lives at `app/providers.tsx` (or `src/app/providers.tsx` if the project uses a `src/` root).
2. Edit `app/layout.tsx` (the existing root `RootLayout` component) to import `Providers` and wrap `{children}` with it inside `<body>`.

**Why a separate file.** `layout.tsx` is a Server Component by default and may export `metadata` / use `next/font`. Making it `'use client'` would forfeit those. Keeping the `'use client'` boundary on `providers.tsx` and mounting it from the Server Component root is the canonical Next.js App Router pattern and what `frigade-web/src/app/layout.tsx` + `frigade-web/src/components/providers/frigade.tsx` do.

**Import style.** The skill should emit the namespace import — `import * as Frigade from '@frigade/react'` + `<Frigade.Provider>`. That is what `frigade-web/src/app/layout.tsx` uses and what the public docs favour. Named imports (`import { Provider } from '@frigade/react'`) also work and are what `frigade-web/src/components/providers/frigade.tsx` uses for its stricter case.

## Ready-to-paste: new file `app/providers.tsx`

Minimal version (no router-aware navigation; the Provider falls back to `window.location` / `window.open` for `uri` CTAs):

```tsx
'use client';

import * as Frigade from '@frigade/react';
import { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  if (!process.env.NEXT_PUBLIC_FRIGADE_API_KEY) {
    throw new Error(
      'NEXT_PUBLIC_FRIGADE_API_KEY is required. Copy .env.local.example to .env.local.',
    );
  }

  return (
    <Frigade.Provider
      apiKey={process.env.NEXT_PUBLIC_FRIGADE_API_KEY}
      userId={/* TODO: pass your app's auth user id here, e.g. from your session hook */ undefined}
    >
      {children}
    </Frigade.Provider>
  );
}
```

Full version (router-aware — the Provider uses `useRouter().push` instead of a hard reload whenever a CTA has a `uri`):

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

Recipes should emit the **full** version when the project already has routing (nearly always true for a real app) and default the minimal one only for bare starter projects.

## Ready-to-paste: edit `app/layout.tsx`

```tsx
import type { Metadata } from 'next';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Your App',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

If `app/layout.tsx` already exists (almost always the case), the recipe should preserve existing `metadata`, fonts, and `className` wiring and only insert the `<Providers>` wrap around `{children}`.

## Env vars (`.env.local`)

```bash
# Required — the Frigade public key, begins with api_public_...
# The NEXT_PUBLIC_ prefix is what lets Next.js ship this to the browser bundle.
NEXT_PUBLIC_FRIGADE_API_KEY=api_public_xxx

# Optional — only set when pointing at a non-production Frigade cluster
# NEXT_PUBLIC_FRIGADE_API_URL=https://ei.frigade.com/
```

The public key is the **only** Frigade var that belongs in any `NEXT_PUBLIC_*` slot. Private keys (prefix `api_private_`) are server-only and must never appear in a client file. Verified against `frigade-web/.env.local.example` and `demo-v2/.env.example`.

The skill itself uses a **separate** server-side private key (`FRIGADE_API_KEY_SECRET` / `FRIGADE_API_KEY_SECRET_PROD`) for GraphQL / REST calls when authoring flows; that key lives in the skill's own environment, never in the user's client bundle. See `rest-endpoints.md` for details.

## Mounting flows

**Where to mount what:**

| Scope | Where |
|---|---|
| App-wide flows (welcome announcement, dismissable banner) | Inside `<Providers>` in `app/layout.tsx`, before or after `{children}` |
| Route-group scoped (e.g. announcements only in `(marketing)` routes) | In a nested `app/(group)/layout.tsx` |
| Page-specific flows (a tour anchored to selectors only present on one page) | In that page's `page.tsx` (or the page's own `layout.tsx`) — **must** be inside a `'use client'` boundary |

**Any component rendering a Frigade flow must be a Client Component.** Flow components touch `localStorage`, portals, and Emotion CSS — they cannot execute during server render. If the page is a Server Component, split the flow-mounting part into a small `'use client'` component and import that.

Example — app-wide announcement (visible on every route):

```tsx
// app/layout.tsx
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

```tsx
// app/app-flows.tsx
'use client';

import * as Frigade from '@frigade/react';

export function AppFlows() {
  return <Frigade.Announcement flowId="flow_welcome_xxx" />;
}
```

Example — tour on a specific page:

```tsx
// app/dashboard/page.tsx
import { DashboardTour } from './dashboard-tour';

export default function DashboardPage() {
  return (
    <main>
      {/* ...server-rendered dashboard content... */}
      <DashboardTour />
    </main>
  );
}
```

```tsx
// app/dashboard/dashboard-tour.tsx
'use client';

import * as Frigade from '@frigade/react';

export function DashboardTour() {
  return <Frigade.Tour flowId="flow_tour_xxx" spotlight />;
}
```

**Provider `defaultCollection`.** When left at its default (`true`), the Provider auto-renders a built-in Collection that surfaces announcements and floating flows from the dashboard without any explicit `<Announcement>` placement. Most recipes should rely on this and only emit an explicit `<Frigade.Announcement flowId="...">` when the user asks for precise control or wants to pin the flow to a specific subtree. Set `defaultCollection={false}` on the Provider to turn it off. See `sdk-react.md` → "Provider props" for the prop and → "`<Frigade.Collection>`" for explicit collections.

## Edge cases

- **Monorepo / Turborepo.** When the App Router lives under `apps/web/app/...` (presence of `turbo.json` at repo root, or `apps/*/package.json`), the provider-placement pattern is identical — the skill should put `providers.tsx` inside the web app's `app/` dir (`apps/web/app/providers.tsx`) and edit `apps/web/app/layout.tsx`. `.env.local` goes in `apps/web/` next to the web app's `package.json`, not at the repo root (Next reads env from the app's cwd).

- **Existing auth providers (Clerk, NextAuth, Apollo, etc.).** `FrigadeProvider` needs a `userId`; auth providers supply it. Order them so Frigade is **inside** the auth provider, so `userId` can be read from a session hook inside the Frigade provider's component. Frigade should be **outside** pure UI providers (theme, UI kits) that don't need to wrap it.

  Canonical order, as used by `frigade-web/src/app/layout.tsx` (simplified):
  ```tsx
  <ClerkProvider>
    <ThemeProvider>
      <Frigade.Provider apiKey={...} userId={clerkUser.id} /* ... */>
        {children}
      </Frigade.Provider>
    </ThemeProvider>
  </ClerkProvider>
  ```
  For NextAuth, the same pattern using `<SessionProvider>`; for Supabase, wrap `<SupabaseProvider>`; etc. If the host app has a session-loading hook that returns `undefined` while loading (like Clerk's `useUser()`), the Frigade provider component should handle the loading case — see `frigade-web/src/components/providers/frigade.tsx:54-64` for the pattern (render a spinner or children without the provider until the user id is known).

- **Server Components / streaming.** Flow components only render inside a `'use client'` boundary. If the user asks the skill to mount `<Frigade.Announcement />` directly inside a Server Component (e.g. a `page.tsx` without `'use client'`), the recipe must either wrap it in a small client component or refuse with a pointer to this rule. `metadata` export and `generateStaticParams` live on Server Components only; do not try to co-locate flows with those.

- **Middleware.** Next.js middleware (`middleware.ts`) runs on the Edge runtime before the React tree mounts. It has no interaction with Frigade. The public API key is read on the client, and Frigade does not require any custom route config. `frigade-web/src/middleware.ts` shows the typical Clerk-only middleware — no Frigade plumbing.

- **`metadata` export.** `export const metadata` only works in Server Components. Do **not** place it in `providers.tsx` (`'use client'`). Keep it in `layout.tsx` or `page.tsx` as normal; Frigade does not affect it.

- **Provider `userId` for unauthenticated users.** If the user is not logged in, leave `userId` undefined. The Provider will mint a guest id (stored in `localStorage`) as long as `generateGuestId` is at its default `true`. On sign-in, call the REST `POST /v1/public/users` endpoint with `{ userId, linkGuestId }` to merge guest state into the authenticated account — see `sdk-react.md` → "User identification" and `rest-endpoints.md`.

- **Turbopack / `next dev --turbo`.** Works out of the box. `frigade-web` runs `next dev --turbo` in production-like conditions with `@frigade/react` 2.9.4 — no special compiler config needed.

- **React Strict Mode / double-mount in dev.** `@frigade/react` handles the dev-mode double mount cleanly; no flicker or duplicate-API-call behaviour has been observed. No workaround needed.

## Hot reload

Editing a flow in the dashboard does **not** trigger a Next.js rebuild — the flow content is fetched at runtime from the Frigade API. To see the updated flow:
- Refresh the browser tab.
- If the flow has already been dismissed or completed by the current user, it won't re-appear without resetting that user's state. Use the skill's reset-user recipe (`useFrigade().frigade.identify(...)` or the REST `DELETE /v1/users/{userId}/state/flows/{flowId}` call; the skill's reset-flow recipe emits the right call).

Editing a `'use client'` file (including `providers.tsx`) triggers a Fast Refresh; the tree remounts and Frigade re-initializes. This is harmless but will reset any in-flight flow to its persisted state.

## Cross-references

- Component props, hooks, CTA action enum, SSR notes: `sdk-react.md`
- Env var conventions for dev vs. prod (client-side key AND skill-side secret key): `sdk-react.md` → "Environment variables"
- Flow YAML authoring (what the `data` field of a flow record looks like): `yaml-spec.md`
- Pages Router equivalent of this file: `next-pages-router.md`
- Starting flows from the skill / REST operations the skill uses internally: `rest-endpoints.md`, `operations.md`
