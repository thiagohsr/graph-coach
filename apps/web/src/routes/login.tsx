import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { RouteFocus } from '~/components/a11y/RouteFocus';
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
  /** Development only: `?forms=1` shows the e-mail forms against an in-memory fake. */
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
    enabled: mode.data === 'dev' && search.forms === '1',
  });
  // `?forms=1` is honoured only when the server says preview is allowed (dev mode, not production).
  const wantsPreview = search.forms === '1' && preview.data === true;
  const initialMode = search.mode ?? 'signIn';
  const signedIn = (to: string) => {
    // The session changed: drop everything cached (including the old signed-out session).
    queryClient.clear();
    void navigate({ href: to });
  };

  return (
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
      {mode.data === 'dev' && wantsPreview && (
        <div className="my-10 flex flex-col gap-4 px-4 max-sm:my-6">
          <p
            role="note"
            className="mx-auto w-full max-w-md rounded-md border border-dashed border-input bg-muted px-3 py-2 text-sm"
          >
            Development preview of the e-mail forms, wired to an in-memory fake (no Cognito). Try{' '}
            <code>ana@example.com</code> / <code>Password123</code>, an unverified account{' '}
            <code>new@example.com</code>, or any new address; every code is <code>123456</code>.{' '}
            <Link to="/login" className="font-medium underline underline-offset-4">
              Back to the demo accounts
            </Link>
            .
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
            <p role="status" className="mx-auto w-full max-w-md text-sm text-success">
              {previewNote}
            </p>
          )}
        </div>
      )}
      {mode.data === 'dev' && !wantsPreview && (
        <DevAccountPicker redirect={target} onSignedIn={signedIn} />
      )}
    </main>
  );
}
