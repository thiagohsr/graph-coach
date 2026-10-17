import type { AuthErrorCode, AuthField } from '~/lib/auth/auth-errors';

// State of the auth card. `password`, `newPassword` and `code` live only here: never in the query cache, a
// query key, the URL, or `window`. Switching mode keeps the e-mail and clears everything secret.

export type AuthMode = 'signIn' | 'signUp' | 'verifyEmail' | 'forgotPassword' | 'resetPassword';

export type NoticeKind = 'success' | 'warning' | 'info';

export interface CardNotice {
  kind: NoticeKind;
  text: string;
}

export interface CardError {
  code?: AuthErrorCode | undefined;
  message: string;
  field?: AuthField | undefined;
}

export interface CardState {
  mode: AuthMode;
  email: string;
  password: string;
  code: string;
  newPassword: string;
  showPassword: boolean;
  status: 'idle' | 'submitting' | 'locked';
  notice: CardNotice | null;
  error: CardError | null;
  fieldErrors: Partial<Record<AuthField, string>>;
  /** Epoch ms when "Send a new code" is available again. */
  cooldownUntil: number | null;
  /** Epoch ms when a rate-limited form is available again. */
  lockedUntil: number | null;
  /** Masked address from the provider, shown on the verify screen. */
  destinationHint: string | undefined;
  guard: { startedAt: string; website: string };
}

export type CardAction =
  | {
      type: 'SET_FIELD';
      field: 'email' | 'password' | 'code' | 'newPassword' | 'website';
      value: string;
    }
  | {
      type: 'SWITCH_MODE';
      mode: AuthMode;
      keepPassword?: boolean;
      notice?: CardNotice | null;
      error?: CardError | null;
      destinationHint?: string | undefined;
    }
  | { type: 'TOGGLE_SHOW' }
  | { type: 'SUBMIT' }
  | {
      type: 'FAILED';
      error: CardError | null;
      fieldErrors?: Partial<Record<AuthField, string>>;
      clear?: ('password' | 'newPassword' | 'code')[];
    }
  | { type: 'SET_FIELD_ERROR'; field: AuthField; message: string | null }
  | { type: 'SET_NOTICE'; notice: CardNotice | null }
  | { type: 'SET_COOLDOWN'; until: number | null }
  | { type: 'LOCK'; until: number; error: CardError }
  | { type: 'UNLOCK' }
  | { type: 'SET_GUARD'; startedAt: string };

export function initialState(mode: 'signIn' | 'signUp'): CardState {
  return {
    mode,
    email: '',
    password: '',
    code: '',
    newPassword: '',
    showPassword: false,
    status: 'idle',
    notice: null,
    error: null,
    fieldErrors: {},
    cooldownUntil: null,
    lockedUntil: null,
    destinationHint: undefined,
    guard: { startedAt: '', website: '' },
  };
}

export function reducer(state: CardState, action: CardAction): CardState {
  switch (action.type) {
    case 'SET_FIELD': {
      if (action.field === 'website')
        return { ...state, guard: { ...state.guard, website: action.value } };
      const { [action.field]: _cleared, ...rest } = state.fieldErrors as Record<string, string>;
      return {
        ...state,
        [action.field]: action.value,
        fieldErrors: rest,
        // A field-level server error goes away when the field changes.
        error: state.error?.field === action.field ? null : state.error,
      };
    }
    case 'SWITCH_MODE':
      return {
        ...state,
        mode: action.mode,
        password: action.keepPassword ? state.password : '',
        newPassword: '',
        code: '',
        showPassword: false,
        status: 'idle',
        notice: action.notice ?? null,
        error: action.error ?? null,
        fieldErrors: {},
        lockedUntil: null,
        destinationHint: action.destinationHint,
      };
    case 'TOGGLE_SHOW':
      return { ...state, showPassword: !state.showPassword };
    case 'SUBMIT':
      return { ...state, status: 'submitting', error: null, fieldErrors: {}, notice: state.notice };
    case 'FAILED': {
      const next: CardState = {
        ...state,
        status: 'idle',
        error: action.error,
        fieldErrors: action.fieldErrors ?? {},
        notice: null,
      };
      for (const f of action.clear ?? []) next[f] = '';
      return next;
    }
    case 'SET_FIELD_ERROR': {
      const { [action.field]: _x, ...rest } = state.fieldErrors as Record<string, string>;
      return {
        ...state,
        fieldErrors: action.message ? { ...rest, [action.field]: action.message } : rest,
      };
    }
    case 'SET_NOTICE':
      return { ...state, notice: action.notice };
    case 'SET_COOLDOWN':
      return { ...state, cooldownUntil: action.until };
    case 'LOCK':
      return {
        ...state,
        status: 'locked',
        lockedUntil: action.until,
        error: action.error,
        password: '',
        newPassword: '',
        code: '',
      };
    case 'UNLOCK':
      return { ...state, status: 'idle', lockedUntil: null, error: null };
    case 'SET_GUARD':
      return { ...state, guard: { ...state.guard, startedAt: action.startedAt } };
  }
}

export const MODE_TITLES: Record<AuthMode, { heading: string; documentTitle: string }> = {
  signIn: { heading: 'Sign in', documentTitle: 'Sign in' },
  signUp: { heading: 'Create your account', documentTitle: 'Create account' },
  verifyEmail: { heading: 'Check your e-mail', documentTitle: 'Verify your e-mail' },
  forgotPassword: { heading: 'Reset your password', documentTitle: 'Reset your password' },
  resetPassword: { heading: 'Choose a new password', documentTitle: 'Choose a new password' },
};
