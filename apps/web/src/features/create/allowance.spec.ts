import type { AllowanceDto } from '@coach/types';
import { describe, expect, it } from 'vitest';
import { allowanceLine, choiceState, hourlyState } from './allowance';

const NOW = new Date('2026-10-15T12:00:00.000Z');
const RESETS = '2026-11-01T00:00:00.000Z';

const base: AllowanceDto = {
  upload: { used: 1, allowance: 3, bonus: 0, resetsAt: RESETS },
  prompt: { used: 0, allowance: 5, bonus: 0, resetsAt: RESETS },
  hourly: { used: 0, limit: 4 },
  creationEnabled: true,
};
const with_ = (patch: Partial<AllowanceDto>): AllowanceDto => ({ ...base, ...patch });
const resetText = new Date(RESETS).toLocaleDateString();

describe('choiceState', () => {
  it('is available with "2 of 3 left this month" when used is 1 of 3', () => {
    expect(choiceState(base, 'upload', NOW)).toMatchObject({ state: 'available', left: 2, line: '2 of 3 left this month' });
  });

  it('is bonus_only when the month is used up and bonus runs remain', () => {
    const a = with_({ upload: { used: 3, allowance: 3, bonus: 2, resetsAt: RESETS } });
    expect(choiceState(a, 'upload', NOW)).toMatchObject({ state: 'bonus_only', left: 0, bonus: 2, line: '0 of 3 left this month · 2 bonus runs' });
  });

  it('is exhausted with the reset date when neither remains', () => {
    const a = with_({ upload: { used: 4, allowance: 3, bonus: 0, resetsAt: RESETS } });
    expect(choiceState(a, 'upload', NOW)).toMatchObject({
      state: 'exhausted',
      left: 0,
      line: `Nothing left this month. Resets on ${resetText}.`,
    });
  });

  it('is unlimited when that kind has a null allowance', () => {
    const a = with_({ prompt: { used: 9, allowance: null, bonus: 0, resetsAt: RESETS } });
    expect(choiceState(a, 'prompt', NOW)).toMatchObject({ state: 'unlimited', line: 'Unlimited' });
    expect(choiceState(a, 'upload', NOW).state).toBe('available');
  });

  it('is paused for both kinds when creation is disabled, before anything else', () => {
    const a = with_({ creationEnabled: false, prompt: { used: 0, allowance: null, bonus: 0, resetsAt: RESETS } });
    expect(choiceState(a, 'upload', NOW)).toMatchObject({ state: 'paused', line: 'Puzzle creation is paused.' });
    expect(choiceState(a, 'prompt', NOW).state).toBe('paused');
  });

  it('is hourly_reached when hourly used equals the limit and no lift is active', () => {
    const a = with_({ hourly: { used: 4, limit: 4 } });
    expect(choiceState(a, 'upload', NOW)).toMatchObject({ state: 'hourly_reached', line: 'Hourly limit reached.' });
    expect(choiceState(a, 'prompt', NOW).state).toBe('hourly_reached');
  });

  it('a lift date in the future overrides the hourly limit; one in the past does not', () => {
    const lifted = with_({ hourly: { used: 4, limit: 4, liftedUntil: '2026-10-16T00:00:00.000Z' } });
    expect(choiceState(lifted, 'upload', NOW).state).toBe('available');
    const expired = with_({ hourly: { used: 4, limit: 4, liftedUntil: '2026-10-14T00:00:00.000Z' } });
    expect(choiceState(expired, 'upload', NOW).state).toBe('hourly_reached');
  });

  it('never reports a negative number left', () => {
    const a = with_({ upload: { used: 9, allowance: 3, bonus: 1, resetsAt: RESETS } });
    expect(choiceState(a, 'upload', NOW)).toMatchObject({ left: 0 });
  });
});

describe('allowanceLine', () => {
  it('adds bonus runs and the reset date', () => {
    const a = with_({ upload: { used: 1, allowance: 3, bonus: 1, resetsAt: RESETS } });
    expect(allowanceLine(a, 'upload', NOW)).toBe(`2 of 3 left this month · 1 bonus run · Resets on ${resetText}`);
  });

  it('is "Unlimited" for a null allowance and the paused text when paused', () => {
    expect(allowanceLine(with_({ prompt: { used: 0, allowance: null, bonus: 0, resetsAt: RESETS } }), 'prompt', NOW)).toBe('Unlimited');
    expect(allowanceLine(with_({ creationEnabled: false }), 'upload', NOW)).toBe('Puzzle creation is paused.');
  });

  it('is the exhausted sentence when nothing is left', () => {
    const a = with_({ upload: { used: 3, allowance: 3, bonus: 0, resetsAt: RESETS } });
    expect(allowanceLine(a, 'upload', NOW)).toBe(`Nothing left this month. Resets on ${resetText}.`);
  });
});

describe('hourlyState', () => {
  it('reports ok, reached, lifted, and unlimited', () => {
    expect(hourlyState(base, NOW)).toMatchObject({ state: 'ok', text: '0 of 4 creations this hour' });
    expect(hourlyState(with_({ hourly: { used: 4, limit: 4 } }), NOW)).toMatchObject({ state: 'reached' });
    const lifted = hourlyState(with_({ hourly: { used: 4, limit: 4, liftedUntil: '2026-10-16T00:00:00.000Z' } }), NOW);
    expect(lifted.state).toBe('lifted');
    expect(lifted.text).toBe(`Hourly limit lifted until ${new Date('2026-10-16T00:00:00.000Z').toLocaleString()}`);
    expect(hourlyState(with_({ hourly: { used: 4, limit: null } }), NOW).state).toBe('unlimited');
  });
});
