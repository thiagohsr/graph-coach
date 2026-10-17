import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { RouteFocus } from '~/components/a11y/RouteFocus';
import { ErrorState } from '~/components/states/ErrorState';
import { LoadingState } from '~/components/states/LoadingState';
import { DevAccountPicker } from '~/features/auth/DevAccountPicker';
import { LoginOptions, parseLoginError, type LoginError } from '~/features/auth/LoginOptions';
import { isBlocked, safeRedirect } from '~/lib/auth/guards';
import { getAuthModeFn } from '~/lib/auth/session.functions';
import { useSignOut } from '~/lib/auth/use-sign-out';
import { keys } from '~/lib/query/keys';

interface LoginSearch {
  redirect?: string | undefined;
  error?: LoginError | undefined;
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === 'string' ? safeRedirect(search.redirect) : undefined,
    error: parseLoginError(search.error),
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
          <LoginOptions redirect={target} error={search.error} onSignOut={() => void signOut()} />
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
        <DevAccountPicker
          redirect={target}
          onSignedIn={(to) => {
            // The session changed: drop everything cached (including the old signed-out session).
            queryClient.clear();
            void navigate({ href: to });
          }}
        />
      )}
    </main>
  );
}
