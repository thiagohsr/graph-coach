import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', 'testing/index': 'src/testing/index.ts' },
  // ESM only: one module instance per package (the CJS build duplicated classes across entries).
  // The CommonJS API loads these with require(esm), supported by Node 22.12+ (.nvmrc is 24).
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  // __dirname / import.meta.url are used to find the bundled queries/ directory.
  shims: true,
  // Vitest is only needed by the testing entry; it is a peer, never bundled.
  external: ['vitest'],
});
