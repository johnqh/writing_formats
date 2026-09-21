import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  // Vitest does not read tsconfig `paths`; mirror them here (keep in sync with tsconfig.json).
  // writing_core's own imports (yjs, zod, ...) resolve from writing_core/node_modules: one Yjs instance.
  resolve: {
    alias: [{ find: /^@sudobility\/writing_core$/, replacement: p('../writing_core/src/index.ts') }],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 60000,
  },
});
