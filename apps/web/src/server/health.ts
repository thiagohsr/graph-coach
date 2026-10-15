/** `GET /healthz`: the process is up. Reads no cookie and calls nothing upstream (contracts/web-server.md §10). */
export function healthHandler(): Response {
  return Response.json({ web: 'ok' }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
