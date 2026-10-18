import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { ArrowLeftIcon } from 'lucide-react';
import { RouteFocus } from '~/components/a11y/RouteFocus';
import { BrandMark } from '~/components/layout/AppShell';
import { ThemeToggle } from '~/components/layout/ThemeToggle';
import { ErrorState } from '~/components/states/ErrorState';
import { LoadingState } from '~/components/states/LoadingState';
import { DevAccountPicker } from '~/features/auth/DevAccountPicker';
import { AuthCard } from '~/features/auth/AuthCard';
import { parseLoginError, type LoginError } from '~/features/auth/login-error';
import { isBlocked, safeRedirect } from '~/lib/auth/guards';
import { authFormsApi, getAuthFormsPreviewFn } from '~/lib/auth/auth-forms.functions';
import { getAuthModeFn } from '~/lib/auth/session.functions';
import { useSignOut } from '~/lib/auth/use-sign-out';
import { keys } from '~/lib/query/keys';

interface LoginSearch {
  redirect?: string | undefined;
  error?: LoginError | undefined;
  /** Landing page deep link: which form to open. Never an e-mail address. */
  mode?: 'signIn' | 'signUp' | undefined;
  /** Kept for old links: in development the e-mail forms now always show beside the demo accounts. */
  forms?: '1' | undefined;
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === 'string' ? safeRedirect(search.redirect) : undefined,
    error: parseLoginError(search.error),
    mode: search.mode === 'signUp' ? 'signUp' : undefined,
    forms: search.forms === '1' || search.forms === 1 ? '1' : undefined,
  }),
  // A signed-in user has nothing to do here.
  beforeLoad: ({ context, search }) => {
    if (context.session === null) return;
    if (isBlocked(context.session)) throw redirect({ to: '/blocked' });
    throw redirect({ href: safeRedirect(search.redirect) });
  },
  component: LoginPage,
});

function LoginPage() {
  const search = Route.useSearch();
  const target = safeRedirect(search.redirect);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = useSignOut();
  const mode = useQuery({
    queryKey: keys.authMode,
    queryFn: () => getAuthModeFn(),
    staleTime: Infinity,
  });

  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const preview = useQuery({
    queryKey: keys.authFormsPreview,
    queryFn: () => getAuthFormsPreviewFn(),
    staleTime: Infinity,
    enabled: mode.data === 'dev',
  });
  // In development the e-mail forms show beside the demo accounts, but only when the server says the preview is
  // allowed (dev mode, never production).
  const wantsPreview = preview.data === true;
  const initialMode = search.mode ?? 'signIn';
  const signedIn = (to: string) => {
    // The session changed: drop everything cached (including the old signed-out session).
    queryClient.clear();
    void navigate({ href: to });
  };

  return (
    <>
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 text-[17px] font-bold">
            <BrandMark />
            Graph Coach
          </Link>
          <div className="flex items-center gap-1">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-text-secondary hover:text-foreground focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <ArrowLeftIcon aria-hidden="true" className="size-4" />
              Back to home
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main id="main">
        <RouteFocus title="Sign in" />
        {mode.isPending && <LoadingState label="Loading sign-in options" rows={1} />}
        {mode.isError && (
          <div className="mx-auto max-w-md p-6">
            <ErrorState error={mode.error} onRetry={() => void mode.refetch()} />
          </div>
        )}
        {mode.data === 'cognito' && (
          <>
            <div className="my-10 px-4 max-sm:my-6">
              <AuthCard
                initialMode={initialMode}
                redirect={target}
                error={search.error}
                headingLevel="h1"
                ownsTitle
                api={authFormsApi}
                onSignedIn={signedIn}
                onSignOut={() => void signOut()}
              />
            </div>
            <p className="pb-8 text-center text-sm text-muted-foreground">
              By signing in you accept how we handle your data:{' '}
              <Link to="/privacy" className="font-medium underline underline-offset-4">
                Privacy
              </Link>
              .
            </p>
          </>
        )}
        {mode.data === 'dev' && (
          <div
            className={
              wantsPreview
                ? 'mx-auto my-10 grid max-w-5xl items-start gap-6 px-4 max-sm:my-6 lg:grid-cols-2'
                : undefined
            }
          >
            <div className={wantsPreview ? '[&>section]:my-0 [&>section]:max-w-none' : undefined}>
              <DevAccountPicker redirect={target} onSignedIn={signedIn} />
            </div>
            {wantsPreview && (
              <div className="flex flex-col gap-4">
                <p
                  role="note"
                  className="w-full rounded-md border border-dashed border-input bg-muted px-3 py-2 text-sm"
                >
                  Preview of the e-mail forms used in production, wired to an in-memory fake (no
                  Cognito, no session). Try <code>ana@example.com</code> / <code>Password123</code>,
                  an unverified account <code>new@example.com</code>, or any new address; every code
                  is <code>123456</code>. Use the demo accounts on the left to actually sign in.
                </p>
                <AuthCard
                  initialMode={initialMode}
                  redirect={target}
                  error={search.error}
                  headingLevel="h1"
                  ownsTitle
                  api={authFormsApi}
                  onSignedIn={(to) =>
                    setPreviewNote(
                      `Signed in (preview only: no session was created). You would go to ${to}.`,
                    )
                  }
                />
                {previewNote && (
                  <p role="status" className="text-sm text-success">
                    {previewNote}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );
}
