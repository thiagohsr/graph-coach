import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', testing: 'src/testing.ts' },
  // ESM only: one module instance per package (the CJS build duplicated classes across entries).
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
});
