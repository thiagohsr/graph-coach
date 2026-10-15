import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// The two model files of spec 002 plus the allowance tables once they exist (T043).
const schema = [
  './src/apps/accounts/user.model.ts',
  './src/common/settings/admin-setting.model.ts',
  './src/apps/allowance/access-code.model.ts',
].filter((path) => existsSync(path));

// `generate` only reads the model files; DATABASE_URL is needed only by `migrate`, `push`, and `studio`.
export default defineConfig({
  dialect: 'postgresql',
  schema,
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
