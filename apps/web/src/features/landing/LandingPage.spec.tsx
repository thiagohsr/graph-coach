import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthApi } from '~/lib/auth/auth-forms.functions';
import { LandingPage } from './LandingPage';

function fakeApi(): AuthApi {
  const never = () => new Promise<never>(() => {});
  return {
    start: async () => ({ startedAt: 'token' }),
    signUp: never,
    confirmSignUp: never,
    resendCode: never,
    signIn: never,
    forgotPassword: never,
    confirmForgotPassword: never,
  };
}

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
    render(<LandingPage mode="cognito" api={fakeApi()} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How it works' })).toBeInTheDocument();
    expect(screen.getByText(/Built on FalkorDB for Graph Hacks/)).toBeInTheDocument();
  });

  it('puts the sign-up card in the sign-up section: Google link, e-mail and password fields, no hosted-page link', () => {
    mockMotion(false);
    render(<LandingPage mode="cognito" api={fakeApi()} />);
    expect(screen.getByRole('link', { name: /Start learning/ })).toHaveAttribute('href', '#start');
    for (const link of screen.getAllByRole('link', { name: 'Sign in' })) {
      expect(link).toHaveAttribute('href', '/login');
    }
    const start = screen
      .getByRole('heading', { name: 'Create your free account' })
      .closest('section')!;
    const card = within(start).getByTestId('auth-card');
    expect(
      within(card).getByRole('heading', { level: 2, name: 'Create your account' }),
    ).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      '/auth/login?provider=google&redirect=%2Fpuzzles',
    );
    expect(within(card).getByLabelText(/^E-mail/)).toHaveAttribute('autocomplete', 'username');
    expect(within(card).getByLabelText(/^Password \(required\)/)).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
    expect(screen.queryByRole('link', { name: /with e-mail/ })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('no longer says sign-up happens on a hosted page, and keeps the privacy line', () => {
    mockMotion(false);
    render(<LandingPage mode="cognito" api={fakeApi()} />);
    expect(document.body.textContent).not.toMatch(/hosted/i);
    expect(screen.getAllByText(/never stored by Graph Coach/).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText('Your uploads are private. Only you can see your sources.').length,
    ).toBeGreaterThan(0);
  });

  it('in dev mode offers the demo account picker instead of provider links', () => {
    mockMotion(false);
    render(<LandingPage mode="dev" api={fakeApi()} />);
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
    render(<LandingPage mode="cognito" api={fakeApi()} />);
    expect(screen.getAllByText(/3 creations from uploads/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Only you can see your sources/).length).toBeGreaterThan(0);
  });

  it('animates the hero graph by default and renders it static under reduced motion', () => {
    mockMotion(false);
    const { unmount } = render(<LandingPage mode="cognito" api={fakeApi()} />);
    expect(screen.getByTestId('hero-graph')).toHaveAttribute('data-animate', 'true');
    unmount();
    mockMotion(true);
    render(<LandingPage mode="cognito" api={fakeApi()} />);
    expect(screen.getByTestId('hero-graph')).toHaveAttribute('data-animate', 'false');
  });
});
