import { createFileRoute } from '@tanstack/react-router';

// GET /healthz: the web process is up. No cookie read, no upstream call, outside /api.
export const Route = createFileRoute('/healthz')({
  server: {
    handlers: {
      GET: async () => (await import('~/server/handlers')).handleHealth(),
    },
  },
});
