import type { AllowanceDto, CreationKind } from '@coach/types';

// Pure view state of the creation allowance (data-model.md §8). The numbers shown are the server's; the only
// arithmetic is "left = allowance - used, not below zero".

export type ChoiceStateName =
  'paused' | 'unlimited' | 'hourly_reached' | 'available' | 'bonus_only' | 'exhausted';

export interface ChoiceState {
  state: ChoiceStateName;
  /** Runs left of the monthly allowance (0 when unlimited or not applicable). */
  left: number;
  bonus: number;
  resetsAt: string;
  /** The one-line statement for the state. */
  line: string;
}

const formatDate = (iso: string) => new Date(iso).toLocaleDateString();
const runs = (n: number) => `${n} bonus ${n === 1 ? 'run' : 'runs'}`;

function liftActive(allowance: AllowanceDto, now: Date): boolean {
  const lifted = allowance.hourly.liftedUntil;
  return lifted !== undefined && new Date(lifted).getTime() > now.getTime();
}

/** Checked in this order: paused, unlimited, hourly_reached, available, bonus_only, exhausted. */
export function choiceState(allowance: AllowanceDto, kind: CreationKind, now: Date): ChoiceState {
  const k = allowance[kind];
  const left = k.allowance === null ? 0 : Math.max(0, k.allowance - k.used);
  const common = { left, bonus: k.bonus, resetsAt: k.resetsAt };
  if (!allowance.creationEnabled)
    return { state: 'paused', ...common, line: 'Puzzle creation is paused.' };
  if (k.allowance === null) return { state: 'unlimited', ...common, line: 'Unlimited' };
  const { hourly } = allowance;
  if (hourly.limit !== null && hourly.used >= hourly.limit && !liftActive(allowance, now)) {
    return { state: 'hourly_reached', ...common, line: 'Hourly limit reached.' };
  }
  if (k.used < k.allowance) {
    return { state: 'available', ...common, line: `${left} of ${k.allowance} left this month` };
  }
  if (k.bonus > 0) {
    return {
      state: 'bonus_only',
      ...common,
      line: `0 of ${k.allowance} left this month · ${runs(k.bonus)}`,
    };
  }
  return {
    state: 'exhausted',
    ...common,
    line: `Nothing left this month. Resets on ${formatDate(k.resetsAt)}.`,
  };
}

/** The allowance line shown on a choice before any submit. */
export function allowanceLine(allowance: AllowanceDto, kind: CreationKind, now: Date): string {
  const state = choiceState(allowance, kind, now);
  switch (state.state) {
    case 'paused':
    case 'unlimited':
    case 'exhausted':
    case 'hourly_reached':
      return state.line;
    case 'available': {
      const bonus = state.bonus > 0 ? ` · ${runs(state.bonus)}` : '';
      return `${state.line}${bonus} · Resets on ${formatDate(state.resetsAt)}`;
    }
    case 'bonus_only':
      return `${state.line} · Resets on ${formatDate(state.resetsAt)}`;
  }
}

export interface HourlyState {
  state: 'unlimited' | 'ok' | 'reached' | 'lifted';
  used: number;
  limit: number | null;
  liftedUntil?: string;
  text: string;
}

/** The hour line of the account page. */
export function hourlyState(allowance: AllowanceDto, now: Date): HourlyState {
  const { used, limit } = allowance.hourly;
  if (liftActive(allowance, now)) {
    const liftedUntil = allowance.hourly.liftedUntil!;
    return {
      state: 'lifted',
      used,
      limit,
      liftedUntil,
      text: `Hourly limit lifted until ${new Date(liftedUntil).toLocaleString()}`,
    };
  }
  if (limit === null) return { state: 'unlimited', used, limit, text: 'No hourly limit' };
  return {
    state: used >= limit ? 'reached' : 'ok',
    used,
    limit,
    text: `${used} of ${limit} creations this hour`,
  };
}
