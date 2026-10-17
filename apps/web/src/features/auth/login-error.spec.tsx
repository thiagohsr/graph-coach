import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LOGIN_ERROR_MESSAGES, LoginErrorAlert, parseLoginError } from './login-error';

describe('login errors', () => {
  it('parses only the known values', () => {
    expect(parseLoginError('state')).toBe('state');
    expect(parseLoginError('unverified')).toBe('unverified');
    expect(parseLoginError('<script>')).toBeUndefined();
    expect(parseLoginError(undefined)).toBeUndefined();
  });

  it.each(Object.entries(LOGIN_ERROR_MESSAGES))(
    'error=%s shows its fixed message and takes focus',
    (key, message) => {
      render(<LoginErrorAlert error={key as keyof typeof LOGIN_ERROR_MESSAGES} />);
      expect(screen.getByRole('alert')).toHaveTextContent(message);
      expect(screen.getByRole('alert')).toHaveFocus();
    },
  );
});
