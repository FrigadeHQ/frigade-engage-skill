import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['./tests/setup.ts'],
    // End-to-end integration tests drive a real Claude Agent SDK session that
    // reads recipes, makes REST calls to Frigade, installs `@frigade/react`,
    // and edits host-project source files. A single run routinely takes 2–4
    // minutes, so 120s is not enough headroom. Keep the hook timeout tight —
    // only the test body itself needs the wider window.
    testTimeout: 360_000,
    hookTimeout: 60_000,
    reporters: ['verbose'],
    sequence: { concurrent: false },
    // Run test FILES serially too — integration tests drive a real Anthropic
    // API key via the Agent SDK, and running multiple files in parallel
    // triggers rate limiting that manifests as missing confirmation prompts
    // (the turn gets cut short before the skill emits its "y/n" line).
    // Individual tests always pass; full-suite parallel runs are flaky.
    fileParallelism: false,
  },
});
