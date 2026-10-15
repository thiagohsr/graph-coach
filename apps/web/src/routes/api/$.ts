import { createFileRoute } from '@tanstack/react-router';

// ANY /api/*: the forwarding route (contracts/web-server.md §5). A thin adapter over `forward`.
const handle = async ({ request }: { request: Request }) => (await import('~/server/handlers')).handleApi(request);

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      PUT: handle,
      PATCH: handle,
      DELETE: handle,
    },
  },
});
