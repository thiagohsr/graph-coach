import { createCognitoAdapter, regionFrom } from './cognito-adapter';
import { createFakeCognito, type FakeCognito } from './cognito-fake';
import type { CognitoPort } from './cognito-port';
import { createAuthForms, type AuthForms } from './auth-forms';
import { sharedLimits } from './auth-limits';
import { createWebContext } from './context';
import type { WebEnv } from './env';

// Per-request wiring of the sign-in forms service. Server-only; imported dynamically by the server functions.

export type FormsMode = 'real' | 'fake' | 'off';

/**
 * `real` with AUTH_MODE=cognito. `fake` (the in-memory preview) only with AUTH_MODE=dev outside production;
 * the environment parser already refuses AUTH_MODE=dev when NODE_ENV=production, and this checks it again.
 */
export function formsMode(env: Pick<WebEnv, 'authMode' | 'nodeEnv'>): FormsMode {
  if (env.authMode === 'cognito') return 'real';
  if (env.authMode === 'dev' && env.nodeEnv !== 'production') return 'fake';
  return 'off';
}

let fake: FakeCognito | undefined;
let real: { key: string; port: CognitoPort } | undefined;

function portFor(env: WebEnv, mode: 'real' | 'fake'): CognitoPort | null {
  if (mode === 'fake') return (fake ??= createFakeCognito());
  const region = regionFrom({
    region: env.cognitoRegion,
    userPoolId: env.cognitoUserPoolId,
    domain: env.cognitoDomain,
  });
  if (!region || !env.cognitoClientId) return null;
  const key = `${region}:${env.cognitoClientId}`;
  if (real?.key !== key)
    real = { key, port: createCognitoAdapter({ region, clientId: env.cognitoClientId }) };
  return real.port;
}

/** The service for this request, or null when e-mail forms are not available. */
export function buildAuthForms(
  request: Request,
  setCookies: (cookies: string[]) => void,
): AuthForms | null {
  const ctx = createWebContext(request);
  const mode = formsMode(ctx.env);
  if (mode === 'off') return null;
  const port = portFor(ctx.env, mode);
  if (!port) return null;
  return createAuthForms({
    mode,
    port,
    limits: sharedLimits(),
    secret: ctx.env.sessionSecret,
    secure: ctx.env.cookieSecure,
    apiUrl: ctx.env.apiUrl,
    publicOrigin: ctx.publicOrigin,
    origin: request.headers.get('origin'),
    cookies: ctx.cookies,
    forwardedFor: ctx.forwardedFor,
    fetch,
    setCookies,
    log: (entry) => console.info(JSON.stringify({ evt: 'auth-forms', ...entry })),
    limitsDisabled: false,
  });
}
