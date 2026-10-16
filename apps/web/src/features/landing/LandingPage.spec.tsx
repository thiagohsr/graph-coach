import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LandingPage } from './LandingPage';

vi.mock('@tanstack/react-router', async (orig) =>
  (await import('~/test/router-mock')).routerMock(await orig()),
);

function mockMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: reduce && query.includes('reduce'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('LandingPage', () => {
  it('renders the landmarks and a single h1', () => {
    mockMotion(false);
    render(<LandingPage mode="cognito" />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How it works' })).toBeInTheDocument();
    expect(screen.getByText(/Built on FalkorDB for Graph Hacks/)).toBeInTheDocument();
  });

  it('points the CTAs at the existing auth flow, with no credential field', () => {
    mockMotion(false);
    render(<LandingPage mode="cognito" />);
    expect(screen.getByRole('link', { name: /Start learning/ })).toHaveAttribute('href', '#start');
    for (const link of screen.getAllByRole('link', { name: 'Sign in' })) {
      expect(link).toHaveAttribute('href', '/login');
    }
    expect(screen.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      '/auth/login?provider=google&redirect=%2Fpuzzles',
    );
    expect(screen.getByRole('link', { name: 'Sign up with e-mail' })).toHaveAttribute(
      'href',
      '/auth/login?provider=email&redirect=%2Fpuzzles',
    );
    expect(screen.getByRole('link', { name: 'Sign in with e-mail' })).toHaveAttribute(
      'href',
      '/auth/login?provider=email&redirect=%2Fpuzzles',
    );
    expect(document.querySelector('input')).toBeNull();
  });

  it('in dev mode offers the demo account picker instead of provider links', () => {
    mockMotion(false);
    render(<LandingPage mode="dev" />);
    const start = screen
      .getByRole('heading', { name: 'Create your free account' })
      .closest('section')!;
    expect(within(start).getByRole('link', { name: 'Choose a demo account' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(screen.queryByRole('link', { name: 'Continue with Google' })).toBeNull();
  });

  it('states the free allowance and the privacy promise', () => {
    mockMotion(false);
    render(<LandingPage mode="cognito" />);
    expect(screen.getAllByText(/3 creations from uploads/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Only you can see your sources/).length).toBeGreaterThan(0);
  });

  it('animates the hero graph by default and renders it static under reduced motion', () => {
    mockMotion(false);
    const { unmount } = render(<LandingPage mode="cognito" />);
    expect(screen.getByTestId('hero-graph')).toHaveAttribute('data-animate', 'true');
    unmount();
    mockMotion(true);
    render(<LandingPage mode="cognito" />);
    expect(screen.getByTestId('hero-graph')).toHaveAttribute('data-animate', 'false');
  });
});
