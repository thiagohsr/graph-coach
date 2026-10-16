import { createFileRoute } from '@tanstack/react-router';

// GET /auth/callback?code=&state= : completes the sign-in (contracts/web-server.md §3.3).
export const Route = createFileRoute('/auth/callback')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) =>
        (await import('~/server/handlers')).handleCallback(request),
    },
  },
});
