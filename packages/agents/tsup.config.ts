import { existsSync } from 'node:fs';
import { defineConfig } from 'tsup';

// One entry per subpath export (`./llm`, `./testing`, `./coach`, `./curator`).
// Entries are added only for directories that exist, so each subsystem's scaffold builds as it lands.
const entry: Record<string, string> = {};
for (const name of ['llm', 'testing', 'coach', 'curator']) {
  if (existsSync(`src/${name}/index.ts`)) entry[`${name}/index`] = `src/${name}/index.ts`;
}

export default defineConfig({
  entry,
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
});
