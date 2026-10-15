import { useEffect, useRef } from 'react';
import { Button } from '~/components/ui/button';

/** The only content of /blocked: a message and Sign out. No navigation, no other data. */
export function BlockedNotice({ onSignOut }: { onSignOut: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">
        Your account is blocked
      </h1>
      <p>An administrator has blocked this account. You cannot use the site.</p>
      <Button type="button" onClick={onSignOut} className="self-start">
        Sign out
      </Button>
    </section>
  );
}
