// Production server: runs the built Start bundle (dist/server/server.js) on Node.
// Reads its configuration at start, not at build (contracts/web-server.md §11): the single root .env,
// then the process environment (which wins). Listens on WEB_PORT on all interfaces; exits cleanly on SIGTERM.
// Request handling (including the one-time x-coach-peer preparation) lives in ./request.mjs.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequestHandler, createStaticServer } from './request.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const clientRoot = path.join(webRoot, 'dist', 'client');
const serverEntry = path.join(webRoot, 'dist', 'server', 'server.js');

try {
  process.loadEnvFile(path.resolve(webRoot, '..', '..', '.env'));
} catch {
  // No root .env (for example in a container that passes the environment directly).
}

const port = Number(process.env.WEB_PORT || 3000);

const mod = await import(pathToFileURL(serverEntry).href);
try {
  mod.checkEnv?.();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const server = http.createServer(
  createRequestHandler({ app: mod.default, serveStatic: createStaticServer(clientRoot), port }),
);

// Event streams stay open for as long as a task runs.
server.requestTimeout = 0;
server.keepAliveTimeout = 65_000;

server.listen(port, '0.0.0.0', () => {
  console.log(`Graph Coach web listening on http://0.0.0.0:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  // Streams and slow clients get a few seconds, then are cut.
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(0);
  }, 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
