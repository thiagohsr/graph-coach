import { createWebContext } from './context';
import { healthHandler } from './health';
import { callbackHandler, startLoginHandler } from './oidc';
import { forward } from './proxy';

// Thin adapters used by the file routes (routes/api/$.ts, routes/auth/*.ts, routes/healthz.ts).
// Imported dynamically from the route handlers: server-only code.

const notFound = () =>
  new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found.' } }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });

export async function handleApi(request: Request): Promise<Response> {
  const ctx = createWebContext(request);
  return forward(request, {
    apiUrl: ctx.env.apiUrl,
    session: ctx.session,
    ensureFresh: ctx.ensureFresh,
    forwardedFor: ctx.forwardedFor,
    publicOrigin: ctx.publicOrigin,
    fetch,
    sessionCookies: ctx.sessionCookies,
    clearCookies: ctx.clearCookies,
  });
}

export async function handleLogin(request: Request): Promise<Response> {
  const ctx = createWebContext(request);
  if (!ctx.oidc) return notFound();
  return startLoginHandler(request, ctx.oidc);
}

export async function handleCallback(request: Request): Promise<Response> {
  const ctx = createWebContext(request);
  if (!ctx.oidc) return notFound();
  return callbackHandler(request, ctx.oidc);
}

export function handleHealth(): Response {
  return healthHandler();
}
