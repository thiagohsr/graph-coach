import { AllowanceDto, RedeemResult } from '@coach/types';
import { queryOptions } from '@tanstack/react-query';
import { keys } from '~/lib/query/keys';
import { apiFetch } from './client';

/** `GET /me/allowance`. */
export function getAllowance(signal?: AbortSignal) {
  return apiFetch('/me/allowance', { schema: AllowanceDto, ...(signal ? { signal } : {}) });
}

/** `POST /me/codes/redeem` with `{ code }`; 422 `CODE_INVALID` is the one answer for any refused code. */
export function redeemCode(code: string) {
  return apiFetch('/me/codes/redeem', { method: 'POST', body: { code }, schema: RedeemResult });
}

/** Always fresh when a page that shows it opens (data-model §2). */
export const allowanceOptions = () =>
  queryOptions({
    queryKey: keys.me.allowance,
    queryFn: ({ signal }) => getAllowance(signal),
    staleTime: 0,
  });
