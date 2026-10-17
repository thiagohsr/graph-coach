import type React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', async (orig) =>
  (await import('~/test/router-mock')).routerMock(await orig()),
);

vi.mock('~/components/a11y/RouteFocus', () => ({ RouteFocus: () => null }));

import { PRIVACY_CONTACT_EMAIL, Route } from './privacy';

describe('/privacy', () => {
  it('is a public page with one h1 and a contact for deletion requests', () => {
    const Page = Route.options.component as () => React.ReactElement;
    render(<Page />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('link', { name: PRIVACY_CONTACT_EMAIL })).toHaveAttribute(
      'href',
      `mailto:${PRIVACY_CONTACT_EMAIL}`,
    );
    // The claims the consent screen and the README rely on.
    expect(screen.getByText(/never stores your password/)).toBeInTheDocument();
    expect(screen.getByText(/only counts of model calls and/)).toBeInTheDocument();
  });
});
