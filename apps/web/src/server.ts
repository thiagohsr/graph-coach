import handler, { createServerEntry } from '@tanstack/react-start/server-entry';
import { getEnv } from './server/env';

// Custom server entry: the same request handler as the default entry, plus `checkEnv`, which
// scripts/start.mjs calls once at start so that a missing or invalid variable stops the server with a
// message naming it. Nothing here runs at build time.
export function checkEnv(): void {
  getEnv();
}

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request);
  },
});
