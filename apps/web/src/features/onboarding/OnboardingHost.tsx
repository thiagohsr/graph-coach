import type { MeDto, OnboardingOutcome } from '@coach/types';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { recordOnboarding } from '~/lib/api/onboarding';
import { keys } from '~/lib/query/keys';
import { OnboardingCarousel, type CarouselClose } from './OnboardingCarousel';

interface GuideApi {
  /** Opens the guide on slide 1. Never changes the account. */
  openGuide: () => void;
}

const GuideContext = createContext<GuideApi>({ openGuide: () => undefined });

/** For the "How it works" item of the user menu. */
export function useGuide(): GuideApi {
  return useContext(GuideContext);
}

/**
 * Mounts the carousel in the authenticated layout. It opens by itself once, when the account has not completed or
 * skipped it (`onboardedAt` null); the outcome is sent once, the dialog closes at once, and a failed write does
 * not reopen it in this session. Opening it again from the menu records nothing.
 */
export function OnboardingHost({ user, children }: { user: MeDto; children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  // True until the first-run guide has been closed once in this page session (success or not).
  const firstRun = useRef(user.onboardedAt === null);

  useEffect(() => {
    if (firstRun.current) setOpen(true);
  }, []);

  const send = useCallback(
    async (outcome: OnboardingOutcome) => {
      try {
        await recordOnboarding(outcome);
        queryClient.setQueryData(keys.session, (current: unknown) =>
          current && typeof current === 'object' && 'id' in current
            ? { ...(current as MeDto), onboardedAt: new Date().toISOString() }
            : current,
        );
      } catch {
        // Optimistic close: not reopened in this session; the next page load asks again.
      }
    },
    [queryClient],
  );

  const onClose = useCallback(
    ({ outcome, to }: CarouselClose) => {
      setOpen(false);
      if (firstRun.current) {
        firstRun.current = false;
        void send(outcome);
      }
      if (to) void navigate({ to: to as never });
    },
    [navigate, send],
  );

  const api = useMemo<GuideApi>(() => ({ openGuide: () => setOpen(true) }), []);

  return (
    <GuideContext.Provider value={api}>
      {children}
      <OnboardingCarousel open={open} onClose={onClose} />
    </GuideContext.Provider>
  );
}
