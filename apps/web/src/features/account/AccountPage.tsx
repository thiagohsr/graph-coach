import { useQuery } from '@tanstack/react-query';
import { RouteFocus } from '~/components/a11y/RouteFocus';
import { ErrorState } from '~/components/states/ErrorState';
import { LoadingState } from '~/components/states/LoadingState';
import { allowanceOptions } from '~/lib/api/account';
import { AllowanceSummary } from './AllowanceSummary';
import { RedeemCodeForm } from './RedeemCodeForm';

/** `/account`: the user's own name and address, the allowance, and the redeem form (contracts/ui-screens.md "/account"). */
export function AccountPage({ user }: { user: { name: string; email: string } }) {
  const allowance = useQuery(allowanceOptions());
  return (
    <div className="flex flex-col gap-6">
      <RouteFocus title="Account" />
      <h1 className="text-2xl leading-[30px] font-bold tracking-tight sm:text-[30px] sm:leading-9">Account</h1>
      <section aria-label="Profile" className="flex flex-col gap-1">
        <p className="font-medium">{user.name}</p>
        <p className="text-sm text-muted-foreground">{user.email}</p>
      </section>
      <section aria-label="Allowance">
        {allowance.isPending && <LoadingState label="Loading allowance" rows={2} />}
        {allowance.isError && <ErrorState error={allowance.error} onRetry={() => void allowance.refetch()} />}
        {allowance.isSuccess && <AllowanceSummary allowance={allowance.data} />}
      </section>
      <section aria-labelledby="redeem-heading" className="flex flex-col gap-2">
        <h2 id="redeem-heading" className="text-lg font-semibold">
          Redeem a code
        </h2>
        <RedeemCodeForm />
      </section>
    </div>
  );
}
