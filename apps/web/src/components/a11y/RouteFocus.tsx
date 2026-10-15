import { useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';

export const APP_TITLE = 'Graph Coach';

export function documentTitle(screen: string): string {
  return `${screen} · ${APP_TITLE}`;
}

/** On navigation: sets the document title and moves focus to the page's single `h1`. Renders nothing. */
export function RouteFocus({ title }: { title: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    document.title = documentTitle(title);
    const h1 = document.querySelector('h1');
    if (h1) {
      if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
      h1.focus({ preventScroll: false });
    }
  }, [pathname, title]);
  return null;
}
