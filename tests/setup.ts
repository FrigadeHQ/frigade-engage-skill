import { existsSync, symlinkSync, readlinkSync, lstatSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';
import { config as loadDotenv } from 'dotenv';

const REQUIRED_VARS = [
  'ANTHROPIC_API_KEY',
  'FRIGADE_TEST_API_KEY_PUBLIC',
  'FRIGADE_TEST_API_KEY_SECRET',
  'FRIGADE_TEST_API_KEY_PUBLIC_PROD',
  'FRIGADE_TEST_API_KEY_SECRET_PROD',
] as const;

export default async function globalSetup() {
  const repoRoot = resolve(import.meta.dirname, '..');

  loadDotenv({ path: join(repoRoot, '.env.test.local') });

  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars for integration tests: ${missing.join(', ')}.\n` +
      `Copy .env.test.local.example to .env.test.local and fill in the values.`
    );
  }

  const skillLink = join(homedir(), '.claude', 'skills', 'frigade-engage');
  const skillDir = join(homedir(), '.claude', 'skills');
  if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });

  if (!existsSync(skillLink)) {
    symlinkSync(repoRoot, skillLink, 'dir');
    console.log(`Linked ${skillLink} -> ${repoRoot}`);
  } else {
    const stat = lstatSync(skillLink);
    if (!stat.isSymbolicLink()) {
      throw new Error(
        `${skillLink} exists and is not a symlink. Remove it or rename it — ` +
        `the test harness requires the skill to be linked to this repo.`
      );
    }
    const target = readlinkSync(skillLink);
    if (resolve(target) !== repoRoot) {
      throw new Error(
        `${skillLink} points to ${target}, not this repo (${repoRoot}). ` +
        `Remove it or re-link before running tests.`
      );
    }
  }

  const cacheDir = join(repoRoot, 'tests', '.cache', 'node_modules');
  const templateDir = join(repoRoot, 'tests', 'fixtures', 'next-app-template');
  if (!existsSync(cacheDir)) {
    if (!existsSync(templateDir)) {
      // The template is created by Task 4. Until then, skip cache pre-pop.
      // Tests that need the cache will fail the existence check in fixture.ts.
      return;
    }
    console.log('Pre-populating fixture node_modules cache (one-time, ~30s)...');
    execSync('npm install --no-audit --no-fund --ignore-scripts', {
      cwd: templateDir,
      stdio: 'inherit',
    });
    mkdirSync(join(repoRoot, 'tests', '.cache'), { recursive: true });
    execSync(`mv "${join(templateDir, 'node_modules')}" "${cacheDir}"`);
  }
}
