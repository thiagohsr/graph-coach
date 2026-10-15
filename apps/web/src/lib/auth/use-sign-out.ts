import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { logoutFn } from './session.functions';

/**
 * Sign out (FR-W19): the web server clears the cookies and returns where to go next (the identity
 * provider's sign-out address, or /login in development); the cache is cleared; then a full-page navigation.
 */
export function useSignOut(): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    const { redirectTo } = await logoutFn();
    queryClient.clear();
    window.location.assign(redirectTo);
  }, [queryClient]);
}
