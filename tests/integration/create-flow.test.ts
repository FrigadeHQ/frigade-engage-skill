import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setupFixture } from '../helpers/fixture';
import { runSkill, answerKeyPrompt, matchConfirmation } from '../helpers/harness';
import { makeClient, testTitle } from '../helpers/frigade-client';
import { FlowTracker } from '../helpers/cleanup';

describe('create-flow', () => {
  const tracker = new FlowTracker();
  afterEach(async () => tracker.flushAll());

  it('creates an announcement and wires it into Next.js', async () => {
    const fx = setupFixture();
    try {
      const title = testTitle('welcome');
      const prompt =
        `Create a welcome announcement titled "${title}" with the message ` +
        `"Hi from tests" and a "Get started" button.`;

      const result = await runSkill({
        cwd: fx.cwd,
        prompt,
        onPrompt: (text) => answerKeyPrompt(text) ?? (matchConfirmation(text) ? 'y' : null),
      });

      // Verify Frigade state.
      const dev = makeClient('dev');
      const flows = await dev.listFlows();
      const created = flows.find((f) => f.name === title);
      expect(created, `flow with name ${title} should exist`).toBeDefined();
      expect(created!.type).toBe('ANNOUNCEMENT');
      tracker.track(dev, { id: created!.id, slug: created!.slug });

      // Verify tmpdir env + binding.
      const envLocal = readFileSync(join(fx.cwd, '.env.local'), 'utf8');
      expect(envLocal).toMatch(/NEXT_PUBLIC_FRIGADE_API_KEY=.+/);
      expect(envLocal).toMatch(/FRIGADE_API_KEY_SECRET=.+/);

      expect(existsSync(join(fx.cwd, '.frigade', 'project.json'))).toBe(true);
      const projJson = JSON.parse(readFileSync(join(fx.cwd, '.frigade', 'project.json'), 'utf8'));
      expect(projJson).toHaveProperty('workspaceId');

      const gitignore = readFileSync(join(fx.cwd, '.gitignore'), 'utf8');
      expect(gitignore).toMatch(/\.env\.local/);
      expect(gitignore).toMatch(/\.frigade\/skill\.log/);

      // Verify <Frigade.Provider> is wired somewhere in app/ and that
      // app/layout.tsx wraps {children} with a provider component. The
      // App Router recipe (Step 6) puts <Frigade.Provider> in a separate
      // app/providers.tsx ('use client') file and imports it from layout —
      // so layout.tsx renders <Providers>{children}</Providers> while the
      // Frigade-specific wiring lives in providers.tsx.
      const layoutSrc = readFileSync(join(fx.cwd, 'app', 'layout.tsx'), 'utf8');
      expect(layoutSrc).toMatch(/\{children\}/);
      expect(layoutSrc).toMatch(/<Providers[\s>]/);

      const providerFile = findInTree(join(fx.cwd, 'app'), (src) =>
        /Frigade\.Provider\b/.test(src),
      );
      expect(
        providerFile,
        '<Frigade.Provider> should be rendered somewhere under app/',
      ).not.toBeNull();

      // Verify Announcement component is mounted somewhere under app/ with the correct flowId.
      const found = findInTree(join(fx.cwd, 'app'), (src) =>
        new RegExp(`<Frigade\\.Announcement[^>]*flowId\\s*=\\s*["']${created!.slug}["']`).test(src)
      );
      expect(found, `<Frigade.Announcement flowId="${created!.slug}" /> should appear in app/`).not.toBeNull();

      // Verify @frigade/react installed.
      const pkg = JSON.parse(readFileSync(join(fx.cwd, 'package.json'), 'utf8'));
      expect(pkg.dependencies['@frigade/react']).toBeTruthy();

      // Grep guard (D07): no FRIGADE_API_KEY_SECRET anywhere in app/ / src/ / pages/ / components/.
      const leaked = grepInTree(
        [join(fx.cwd, 'app'), join(fx.cwd, 'src'), join(fx.cwd, 'pages'), join(fx.cwd, 'components')],
        /FRIGADE_API_KEY_SECRET/
      );
      expect(leaked, `FRIGADE_API_KEY_SECRET leaked into: ${leaked?.join(', ')}`).toBeNull();

      // Sanity on the skill's completion message.
      expect(result.finalResponse.length).toBeGreaterThan(0);
    } finally {
      fx.cleanup();
    }
  });
});

function findInTree(root: string, predicate: (contents: string) => boolean): string | null {
  if (!existsSync(root)) return null;
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    if (statSync(p).isDirectory()) {
      const r = findInTree(p, predicate);
      if (r) return r;
    } else if (/\.(tsx?|jsx?)$/.test(name)) {
      const src = readFileSync(p, 'utf8');
      if (predicate(src)) return p;
    }
  }
  return null;
}

function grepInTree(roots: string[], regex: RegExp): string[] | null {
  const hits: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|jsx?|env.*)$/.test(name)) {
          if (regex.test(readFileSync(p, 'utf8'))) hits.push(p);
        }
      }
    };
    walk(root);
  }
  return hits.length ? hits : null;
}
