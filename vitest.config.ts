import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const writingCoreSrc = p('../writing_core/src/index.ts');

export default defineConfig({
  // Vitest does not read tsconfig `paths`; mirror them here (keep in sync with tsconfig.json).
  // writing_core's own imports (yjs, zod, ...) resolve from writing_core/node_modules: one Yjs instance.
  // Only applied when the sibling repo is actually checked out (local dev, "local-packages phase");
  // otherwise falls through to the real, published `@sudobility/writing_core` npm dependency, so CI
  // (which checks out only this one repo) still resolves it via node_modules.
  resolve: {
    alias: existsSync(writingCoreSrc) ? [{ find: /^@sudobility\/writing_core$/, replacement: writingCoreSrc }] : [],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 60000,
  },
});
