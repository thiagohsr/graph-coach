import { describe, expect, it } from 'vitest';
import { initialState, reducer, type CardState } from './use-auth-card';

const filled = (): CardState => ({
  ...initialState('signIn'),
  email: 'ana@example.com',
  password: 'Password123',
  newPassword: 'Another-pass9',
  code: '123456',
  showPassword: true,
  error: { message: 'x' },
  fieldErrors: { email: 'x' },
});

describe('auth card reducer', () => {
  it('SWITCH_MODE keeps the e-mail and clears every secret, the errors, and the toggle', () => {
    const next = reducer(filled(), { type: 'SWITCH_MODE', mode: 'forgotPassword' });
    expect(next).toMatchObject({
      mode: 'forgotPassword',
      email: 'ana@example.com',
      password: '',
      newPassword: '',
      code: '',
      showPassword: false,
      error: null,
      fieldErrors: {},
      status: 'idle',
    });
  });

  it('SWITCH_MODE keeps the password only when asked (sign up to verify)', () => {
    expect(
      reducer(filled(), { type: 'SWITCH_MODE', mode: 'verifyEmail', keepPassword: true }).password,
    ).toBe('Password123');
  });

  it('LOCK clears the secrets as well', () => {
    const next = reducer(filled(), { type: 'LOCK', until: 5, error: { message: 'm' } });
    expect(next).toMatchObject({
      status: 'locked',
      lockedUntil: 5,
      password: '',
      newPassword: '',
      code: '',
    });
  });

  it('SET_FIELD clears that field error and the matching server error', () => {
    const s = { ...filled(), error: { message: 'x', field: 'email' as const } };
    const next = reducer(s, { type: 'SET_FIELD', field: 'email', value: 'b@example.com' });
    expect(next.fieldErrors).toEqual({});
    expect(next.error).toBeNull();
  });

  it('FAILED can clear chosen secrets', () => {
    expect(
      reducer(filled(), { type: 'FAILED', error: { message: 'm' }, clear: ['password'] }),
    ).toMatchObject({
      password: '',
      code: '123456',
    });
  });
});
