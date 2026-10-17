import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Contracts ship as TypeScript source, so they have to be bundled. Native and
  // runtime dependencies stay external and come from node_modules.
  noExternal: ['@storyquest/contracts'],
  external: ['better-sqlite3'],
});
