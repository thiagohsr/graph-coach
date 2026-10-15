import { createFileRoute } from '@tanstack/react-router';

// GET /auth/login?provider=&redirect= : starts the sign-in with the identity provider (404 in dev mode).
export const Route = createFileRoute('/auth/login')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => (await import('~/server/handlers')).handleLogin(request),
    },
  },
});
