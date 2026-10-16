import type { ComponentProps } from 'react';
import { vi } from 'vitest';

/** Shared spy for `useNavigate()` in component specs. */
export const navigateMock = vi.fn();

type LinkProps = Omit<ComponentProps<'a'>, 'href'> & {
  to?: string;
  href?: string;
  params?: Record<string, string>;
  search?: unknown;
  replace?: boolean;
  activeProps?: unknown;
};

export function resolveTo(to: string, params: Record<string, string> = {}): string {
  return to.replace(/\$(\w+)/g, (_, name: string) => params[name] ?? '');
}

/**
 * For `vi.mock('@tanstack/react-router', async (orig) => (await import('~/test/router-mock')).routerMock(await orig()))`:
 * keeps the real module but renders `Link` as a plain anchor and makes `useNavigate` return `navigateMock`,
 * so presentational components can be rendered without a router.
 */
export function routerMock(actual: Record<string, unknown>) {
  function Link({
    to,
    href,
    params,
    search,
    replace: _r,
    activeProps: _a,
    children,
    ...rest
  }: LinkProps) {
    const query = new URLSearchParams(
      Object.entries(
        (search && typeof search === 'object' ? search : {}) as Record<string, unknown>,
      )
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)] as [string, string]),
    ).toString();
    return (
      <a href={href ?? `${resolveTo(to ?? '', params)}${query ? `?${query}` : ''}`} {...rest}>
        {children}
      </a>
    );
  }
  return { ...actual, Link, useNavigate: () => navigateMock };
}
