import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setupFixture } from '../helpers/fixture';
import { runSkill, matchConfirmation } from '../helpers/harness';
import { makeClient, testTitle } from '../helpers/frigade-client';
import { CollectionTracker } from '../helpers/cleanup';

describe('promote-collection', () => {
  const tracker = new CollectionTracker();
  afterEach(async () => tracker.flushAll());

  it('promotes a dev collection to prod after confirmation', async () => {
    const fx = setupFixture();
    try {
      const dev = makeClient('dev');
      const prod = makeClient('prod');
      const title = testTitle('promote-coll');

      const devColl = await dev.createCollection({ name: title });
      tracker.track(dev, { id: devColl.id, slug: devColl.slug });

      seedFixture(fx.cwd);

      let sawProdPrompt = false;
      await runSkill({
        cwd: fx.cwd,
        prompt: `Promote collection "${devColl.slug}" to prod.`,
        onPrompt: (text) => {
          const m = matchConfirmation(text);
          if (!m) return null;
          if (m.env === 'prod') sawProdPrompt = true;
          return 'y';
        },
      });

      expect(sawProdPrompt, 'canonical confirmation with env=prod must appear').toBe(true);

      const prodColl = await prod.getCollection(devColl.slug);
      expect(prodColl, 'prod collection should exist at same slug').not.toBeNull();
      expect(prodColl!.name).toBe(title);
      tracker.track(prod, { id: prodColl!.id, slug: prodColl!.slug });
    } finally {
      fx.cleanup();
    }
  });
});

function seedFixture(cwd: string) {
  writeFileSync(
    join(cwd, '.env.local'),
    [
      `NEXT_PUBLIC_FRIGADE_API_KEY=${process.env.FRIGADE_TEST_API_KEY_PUBLIC}`,
      `FRIGADE_API_KEY_SECRET=${process.env.FRIGADE_TEST_API_KEY_SECRET}`,
      `NEXT_PUBLIC_FRIGADE_API_KEY_PROD=${process.env.FRIGADE_TEST_API_KEY_PUBLIC_PROD}`,
      `FRIGADE_API_KEY_SECRET_PROD=${process.env.FRIGADE_TEST_API_KEY_SECRET_PROD}`,
      '',
    ].join('\n')
  );
  mkdirSync(join(cwd, '.frigade'), { recursive: true });
  writeFileSync(
    join(cwd, '.frigade', 'project.json'),
    JSON.stringify(
      { workspaceId: '208', prodWorkspaceId: '209', boundAt: new Date().toISOString() },
      null,
      2
    )
  );
}
