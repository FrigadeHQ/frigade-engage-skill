import { mkdtempSync, cpSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export interface Fixture {
  cwd: string;
  cleanup: () => void;
}

export function setupFixture(): Fixture {
  const repoRoot = resolve(import.meta.dirname, '..', '..');
  const template = join(repoRoot, 'tests', 'fixtures', 'next-app-template');
  const cache = join(repoRoot, 'tests', '.cache', 'node_modules');

  if (!existsSync(cache)) {
    throw new Error(`Fixture cache missing: ${cache}. globalSetup should have created it.`);
  }

  const cwd = mkdtempSync(join(tmpdir(), 'frigade-engage-test-'));
  cpSync(template, cwd, { recursive: true });
  symlinkSync(cache, join(cwd, 'node_modules'), 'dir');

  return {
    cwd,
    cleanup: () => {
      try {
        rmSync(cwd, { recursive: true, force: true });
      } catch (e) {
        console.warn(`Cleanup failed for ${cwd}:`, e);
      }
    },
  };
}
