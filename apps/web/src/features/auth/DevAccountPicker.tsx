import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Alert } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import { devLoginFn, getDevUsersFn } from '~/lib/auth/session.functions';
import { Skeleton } from '~/components/ui/skeleton';

/** Development mode: choose a seeded demo account. The token never reaches the browser (devLoginFn seals it). */
export function DevAccountPicker({ redirect, onSignedIn }: { redirect: string; onSignedIn: (to: string) => void }) {
  const users = useQuery({
    queryKey: ['auth', 'dev-users'],
    queryFn: () => getDevUsersFn(),
    staleTime: Infinity,
    retry: false,
  });
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  const login = useMutation({
    mutationFn: (email: string) => devLoginFn({ data: { email } }),
    onSuccess: (result) => {
      if (result.ok) {
        onSignedIn(redirect);
        return;
      }
      setChosen(null);
      setError(result.code === 'INVALID_CREDENTIALS' ? 'That account does not exist in the seed data.' : 'Service unavailable.');
    },
    onError: () => {
      setChosen(null);
      setError('Service unavailable.');
    },
  });

  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  const loadError = users.isError ? 'Service unavailable.' : null;
  const shownError = error ?? loadError;

  return (
    <section className="mx-auto my-10 flex max-w-md flex-col gap-5 rounded-xl border bg-card p-6 shadow-sm max-sm:mx-4 max-sm:my-6">
      <div className="rounded-md border border-dashed border-input bg-muted px-3 py-2 font-mono text-xs font-medium tracking-[0.06em] uppercase">Development sign-in</div>
      <h1 className="text-2xl leading-[30px] font-bold tracking-tight sm:text-[30px] sm:leading-9" tabIndex={-1}>
        Sign in as
      </h1>
      {shownError && (
        <Alert variant="destructive" ref={alertRef} tabIndex={-1}>
          {shownError}
        </Alert>
      )}
      <div aria-busy={users.isPending} className="flex flex-col gap-3">
        {users.isPending && (
          <>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </>
        )}
        {users.data?.map((u) => {
          const pending = login.isPending && chosen === u.email;
          return (
            <Button
              key={u.email}
              type="button"
              variant="outline"
              size="lg"
              className="h-auto min-h-12 justify-between py-2"
              disabled={login.isPending}
              onClick={() => {
                setError(null);
                setChosen(u.email);
                login.mutate(u.email);
              }}
            >
              <span>{pending ? 'Signing in…' : u.name}</span>
              <span className="text-xs font-normal text-muted-foreground">{u.role}</span>
            </Button>
          );
        })}
      </div>
    </section>
  );
}
