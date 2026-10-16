import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

// The single root .env serves the web app too (apps/web has no env file of its own). Variables already in
// the environment win. This runs when the dev server starts; the built server reads the environment at
// start (scripts/start.mjs), never at build time.
try {
  process.loadEnvFile(path.resolve(here, '..', '..', '.env'));
} catch {
  // No root .env.
}

/** Dev server: tells the app which peer is connected, as scripts/start.mjs does in production. */
function peerHeader(): Plugin {
  return {
    name: 'coach-peer-header',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        delete req.headers['x-coach-peer']; // never trust a client-supplied value
        if (req.socket.remoteAddress) req.headers['x-coach-peer'] = req.socket.remoteAddress;
        next();
      });
    },
  };
}

export default defineConfig({
  resolve: { alias: { '~': path.resolve(here, 'src') } },
  server: { port: Number(process.env.WEB_PORT || 3000), strictPort: true, host: true },
  plugins: [
    peerHeader(),
    tailwindcss(),
    tanstackStart({ router: { routeFileIgnorePattern: '\\.spec\\.' } }),
    viteReact(),
  ],
});
