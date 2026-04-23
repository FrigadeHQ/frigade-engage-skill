# Next.js Pages Router — Frigade Adapter

How the skill installs and wires `@frigade/react` into a Next.js **Pages Router** project.

**Canonical sources** (read when cross-checking anything below):
- `demo-v2` — Next 14.2.5 Pages Router app, the most canonical Pages Router + `@frigade/react@^2.9.4` integration in the local repos. Wiring lives in `demo-v2/src/pages/_app.tsx` (the `<Providers>` wrapper) and `demo-v2/src/components/providers.tsx` (the actual `Frigade.Provider`).
- `frigade-web/src/pages/_app.tsx` — the Pages Router side of a hybrid app on Next 15.5.12, also using `@frigade/react@2.9.4`. Uses the same `<Providers>` wrapper pattern.
- `NEXT_PUBLIC_FRIGADE_API_KEY` — confirmed in `demo-v2/.env.example` and `frigade-web/.env.local.example`.

**Note.** Two older Pages Router demo apps in the local workspace (`frigade-react-nextjs-demo`, `internal-frigade-react-nextjs-demo`) are pinned to `@frigade/react@^1.x` — the **legacy** SDK. Their wiring (`FrigadeProvider` with `publicApiKey`, `organizationId`, and a nested `config.navigate`) is **not** what recipes should emit. Always generate code against the v2 surface documented here and in `sdk-react.md`. If the user's project currently uses v1, the skill's migration path belongs in a dedicated recipe (not covered here).

**This reference covers the wire-up only.** SDK surface (component props, hooks, CTA action enum, SSR nuances) lives in `sdk-react.md`.

## Detection

Claude should treat a project as Pages Router when **all** of:

1. `package.json` has `next` at any `^12` or newer version.
2. The repo contains a `pages/` or `src/pages/` directory **with** a `_app.tsx` / `_app.jsx` / `_app.js` inside it. The presence of `_app.*` is the strongest signal — App Router has no such file.
3. Either there is **no** `app/` / `src/app/` directory, or if there is one it contains **no** `layout.tsx` (i.e. `app/` is only being used for a handful of newer routes and the primary app still lives under `pages/`).

**Hybrid case.** `frigade-web` has both `src/pages/_app.tsx` (the main dashboard) and `src/app/layout.tsx` (the `/sign-in` and `/sign-out` routes). When Claude sees both, pick the router under which the target route lives. If the announcement/tour is for a route under `pages/`, use this file; for a route under `app/`, use `next-app-router.md`.

## Provider placement

**Canonical pattern** (what the skill emits):

1. Create (or edit, if it exists) a `Providers` wrapper component at `components/providers.tsx` (or `src/components/providers.tsx` if the project uses `src/`). This is where `<Frigade.Provider>` is instantiated.
2. Edit `pages/_app.tsx` to wrap `<Component {...pageProps} />` with `<Providers>`.

**Why a wrapper, not wire directly in `_app.tsx`.** `demo-v2/src/pages/_app.tsx` and `frigade-web/src/pages/_app.tsx` both follow this indirection: `_app.tsx` imports `Providers` and mounts it; the actual `<Frigade.Provider>` + any theme/navigation providers live in `providers.tsx`. This keeps `_app.tsx` focused on Next-specific concerns (fonts, page-transition styles, `<HeadContent />`) and makes it trivial to add/reorder providers later.

It is legal to inline the Frigade provider directly in `_app.tsx` for very small apps — Pages Router is client-side by default in most cases so no `'use client'` directive is needed — but the wrapper pattern is what the skill should emit for parity with real-world codebases.

**Import style.** The skill should emit the namespace import — `import * as Frigade from '@frigade/react'` + `<Frigade.Provider>`. That is what `demo-v2/src/components/providers.tsx` uses.

## Ready-to-paste: new or edited file `components/providers.tsx`

Minimal version (no router-aware navigation; Provider falls back to `window.location` / `window.open` for `uri` CTAs):

```tsx
import * as Frigade from '@frigade/react';
import { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  if (typeof process.env.NEXT_PUBLIC_FRIGADE_API_KEY === 'undefined') {
    throw new Error(
      'NEXT_PUBLIC_FRIGADE_API_KEY is required. Copy .env.local.example (or .env.example) to .env.local.',
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

Full version (router-aware — Provider uses `useRouter().push` instead of a hard reload when a CTA has `uri`). Note the import is `next/router`, **not** `next/navigation`:

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

Recipes should emit the **full** version when the project already has routing (nearly always true for a real app) and default to the minimal one only for bare starter projects.

## Ready-to-paste: edit `pages/_app.tsx`

```tsx
import type { AppProps } from 'next/app';
import { Providers } from '@/components/providers';
import '@/styles/globals.css';

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <Providers>
      <Component {...pageProps} />
    </Providers>
  );
}
```

If `pages/_app.tsx` already exists (almost always the case), preserve existing imports (fonts, global stylesheets, tracking SDKs, existing providers) and only insert the `<Providers>` wrap around `<Component {...pageProps} />`. If the project does not use the `@/` path alias, adjust the import (`../components/providers`) to match whatever the project's `tsconfig.json` `paths` config exposes.

## Env vars (`.env.local`)

```bash
# Required — the Frigade public key, begins with api_public_...
# The NEXT_PUBLIC_ prefix is what lets Next.js ship this to the browser bundle.
NEXT_PUBLIC_FRIGADE_API_KEY=api_public_xxx

# Optional — only set when pointing at a non-production Frigade cluster
# NEXT_PUBLIC_FRIGADE_API_URL=https://ei.frigade.com/
```

The public key is the **only** Frigade var that belongs in any `NEXT_PUBLIC_*` slot. Private keys (prefix `api_private_`) are server-only and must never appear in a client file. Verified against `demo-v2/.env.example` and `frigade-web/.env.local.example`.

The skill itself uses a **separate** server-side private key (`FRIGADE_API_KEY_SECRET` / `FRIGADE_API_KEY_SECRET_PROD`) for GraphQL / REST calls when authoring flows; that key lives in the skill's own environment, never in the user's client bundle. See `rest-endpoints.md` for details.

## Mounting flows

**Where to mount what:**

| Scope | Where |
|---|---|
| App-wide flows (welcome announcement, dismissable banner) | Inside `<Providers>` in `pages/_app.tsx`, before `<Component {...pageProps} />` |
| Page-specific flows (a tour anchored to selectors only present on one page) | In that page's `pages/*.tsx` file, alongside the page's own UI |

Pages Router pages are client-rendered by default, so there is **no `'use client'` boundary to worry about** for flow components. Just import and render them:

```tsx
// pages/_app.tsx — app-wide announcement
import type { AppProps } from 'next/app';
import * as Frigade from '@frigade/react';
import { Providers } from '@/components/providers';
import '@/styles/globals.css';

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <Providers>
      <Frigade.Announcement flowId="flow_welcome_xxx" />
      <Component {...pageProps} />
    </Providers>
  );
}
```

```tsx
// pages/dashboard.tsx — page-specific tour
import * as Frigade from '@frigade/react';

export default function DashboardPage() {
  return (
    <main>
      {/* ...dashboard content... */}
      <Frigade.Tour flowId="flow_tour_xxx" spotlight />
    </main>
  );
}
```

**Provider `defaultCollection`.** When left at its default (`true`), the Provider auto-renders a built-in Collection that surfaces announcements and floating flows from the dashboard without any explicit `<Announcement>` placement. Most recipes should rely on this and only emit an explicit `<Frigade.Announcement flowId="...">` when the user asks for precise control or wants to pin the flow to a specific subtree. Set `defaultCollection={false}` on the Provider to turn it off. See `sdk-react.md` → "Provider props" for the prop and → "`<Frigade.Collection>`" for explicit collections.

## Edge cases

- **SSR / `getServerSideProps` / `getStaticProps`.** Pages Router pages are SSR'd by default, but Frigade components render `null` during the server pass (they rely on `localStorage`, portals, and Emotion CSS that only exist in the browser) and hydrate on the client. This is safe and does not produce hydration warnings in practice — `demo-v2` ships this way in production with no additional config. **The Provider's `userId` prop must be available at the first render, though**, and if it comes from a server-fetched source, pass it via `pageProps`:

  ```tsx
  // pages/_app.tsx
  import type { AppProps } from 'next/app';
  import { Providers } from '@/components/providers';

  type MyPageProps = { userId?: string };

  export default function MyApp({ Component, pageProps }: AppProps<MyPageProps>) {
    return (
      <Providers userId={pageProps.userId}>
        <Component {...pageProps} />
      </Providers>
    );
  }
  ```

  ```tsx
  // components/providers.tsx — accept userId as a prop
  export function Providers({ children, userId }: { children: ReactNode; userId?: string }) {
    // ... pass userId through to <Frigade.Provider userId={userId}>
  }
  ```

  If the auth/user id is only known on the client (e.g. you're using a purely client-side auth SDK like Clerk's `useUser()`), just read it inside `components/providers.tsx` with the relevant hook — no `pageProps` plumbing needed.

- **Custom `_document.tsx`.** Does not interfere with Frigade. `demo-v2/src/pages/_document.tsx` ships a perfectly ordinary `_document.tsx` with no Frigade-specific code. The Provider does **not** need to be touched from `_document.tsx`; `_document.tsx` only runs on the server and the Provider is client-side.

  **Do not** try to render flow components from `_document.tsx` — it will fail silently (`_document` renders server-only, Frigade renders client-only).

- **Existing auth providers (Clerk, NextAuth, Supabase).** `FrigadeProvider` needs a `userId`; auth providers supply it. Order them so Frigade is **inside** the auth provider, so `userId` can be read from a session hook inside the Frigade provider's wrapper component. Frigade should be **outside** pure UI providers (theme, UI kits).

  Canonical order (from `frigade-web/src/pages/_app.tsx` → `components/providers/index.tsx` → `components/providers/frigade.tsx`, simplified):
  ```tsx
  // pages/_app.tsx
  <ClerkProvider>
    <Providers>
      <Component {...pageProps} />
    </Providers>
  </ClerkProvider>
  ```
  ```tsx
  // components/providers.tsx
  <ThemeProvider>
    <Frigade.Provider apiKey={...} userId={clerkUser.id} /* ... */>
      {children}
    </Frigade.Provider>
  </ThemeProvider>
  ```
  For NextAuth, swap `<SessionProvider>` for `<ClerkProvider>`; for Supabase, `<SupabaseProvider>`; etc.

- **Monorepo / Turborepo.** When Pages Router lives under `apps/web/pages/...` (presence of `turbo.json` at repo root), the pattern is identical — put `components/providers.tsx` inside `apps/web/components/`, edit `apps/web/pages/_app.tsx`. `.env.local` goes in `apps/web/` next to the web app's `package.json`, not at the repo root (Next reads env from the app's cwd).

- **Provider `userId` for unauthenticated users.** If the user is not logged in, leave `userId` undefined. The Provider will mint a guest id (stored in `localStorage`) as long as `generateGuestId` is at its default `true`. On sign-in, call the REST `POST /v1/public/users` endpoint with `{ userId, linkGuestId }` to merge guest state into the authenticated account — see `sdk-react.md` → "User identification" and `rest-endpoints.md`.

- **React Strict Mode.** Pages Router apps frequently enable `reactStrictMode: true` in `next.config.js` (see both `frigade-react-nextjs-demo/next.config.js` and `internal-frigade-react-nextjs-demo/next.config.js`). `@frigade/react@2.9.4` handles the dev-mode double mount cleanly. No workaround needed.

- **`dynamic(..., { ssr: false })`.** The legacy v1-SDK demo `frigade-react-nextjs-demo` wraps `_app.tsx` in `dynamic(() => Promise.resolve(MyApp), { ssr: false })`. **Do not propagate this pattern to v2** — the v2 SDK handles SSR correctly on its own and disabling SSR for the entire app is a severe regression (breaks SEO, metadata, initial paint). If the recipe sees this idiom in an existing project, it can leave it alone, but should not introduce it.

## Hot reload

Editing a flow in the dashboard does **not** trigger a Next.js rebuild — the flow content is fetched at runtime from the Frigade API. To see the updated flow:
- Refresh the browser tab.
- If the flow has already been dismissed or completed by the current user, it won't re-appear without resetting that user's state. Use the skill's reset-user recipe (`useFrigade().frigade.identify(...)` or the REST `DELETE /v1/users/{userId}/state/flows/{flowId}` call; the skill's reset-flow recipe emits the right call).

Editing `_app.tsx` or `components/providers.tsx` triggers a Fast Refresh; the tree remounts and Frigade re-initializes. This is harmless but will reset any in-flight flow to its persisted state.

## Cross-references

- Component props, hooks, CTA action enum, SSR notes: `sdk-react.md`
- Env var conventions for dev vs. prod (client-side key AND skill-side secret key): `sdk-react.md` → "Environment variables"
- Flow YAML authoring (what the `data` field of a flow record looks like): `yaml-spec.md`
- App Router equivalent of this file: `next-app-router.md`
- Starting flows from the skill / REST operations the skill uses internally: `rest-endpoints.md`, `operations.md`
