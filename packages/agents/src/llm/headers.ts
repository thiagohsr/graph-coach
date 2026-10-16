import { OPENROUTER_APP_TITLE, type CfAccess } from './config';

/** Cloudflare Access service-token headers; undefined when no token is configured (Ollama reached directly). */
export function cfAccessHeaders(
  cfAccess: CfAccess | undefined,
): Record<string, string> | undefined {
  if (!cfAccess) return undefined;
  return {
    'CF-Access-Client-Id': cfAccess.clientId,
    'CF-Access-Client-Secret': cfAccess.clientSecret,
  };
}

/** OpenRouter attribution headers. The referer is this app's public origin when known. */
export function openRouterHeaders(
  referer = 'https://github.com/graph-coach',
): Record<string, string> {
  return { 'HTTP-Referer': referer, 'X-Title': OPENROUTER_APP_TITLE };
}
