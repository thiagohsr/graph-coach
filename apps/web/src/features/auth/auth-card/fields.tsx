import { Check, CircleAlert, Eye, EyeOff, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { LiveRegion } from '~/components/a11y/LiveRegion';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { PASSWORD_RULES } from '~/lib/auth/auth-forms.schema';
import { cn } from '~/lib/utils';

export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1.5 flex items-start gap-1.5 text-[13px] text-danger">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function RequiredLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <Label htmlFor={htmlFor} className="mb-1.5 leading-normal">
      {children} <span className="font-normal text-muted-foreground">(required)</span>
    </Label>
  );
}

interface BaseProps {
  id: string;
  value: string;
  error?: string | undefined;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
}

export function EmailField({ id, value, error, onChange, onBlur, disabled }: BaseProps) {
  return (
    <div>
      <RequiredLabel htmlFor={id}>E-mail</RequiredLabel>
      <Input
        id={id}
        name="email"
        type="email"
        autoComplete="username"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

export function CodeField({ id, value, error, onChange, onBlur, disabled }: BaseProps) {
  return (
    <div>
      <RequiredLabel htmlFor={id}>6-digit code</RequiredLabel>
      <Input
        id={id}
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        spellCheck={false}
        value={value}
        disabled={disabled}
        className="text-center font-mono text-xl tracking-[0.4em] md:text-xl"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onBlur={onBlur}
      />
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

export function PasswordField({
  id,
  label,
  autoComplete,
  value,
  show,
  error,
  onChange,
  onBlur,
  onToggle,
  disabled,
  showRules,
}: BaseProps & {
  label: string;
  autoComplete: 'current-password' | 'new-password';
  show: boolean;
  onToggle: () => void;
  showRules?: boolean;
}) {
  const describedBy = [error ? `${id}-error` : null, showRules ? `${id}-rules` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div>
      <RequiredLabel htmlFor={id}>{label}</RequiredLabel>
      <div className="relative">
        <Input
          id={id}
          name={autoComplete === 'current-password' ? 'password' : 'new-password'}
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          value={value}
          disabled={disabled}
          className="pr-12"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
        <button
          type="button"
          aria-label="Show password"
          aria-pressed={show}
          aria-controls={id}
          disabled={disabled}
          onClick={onToggle}
          className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-md text-primary outline-none hover:bg-accent focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring max-sm:size-9"
        >
          {show ? (
            <EyeOff aria-hidden="true" className="size-4" />
          ) : (
            <Eye aria-hidden="true" className="size-4" />
          )}
        </button>
      </div>
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
      {showRules && <PasswordRules id={`${id}-rules`} password={value} />}
    </div>
  );
}

/** The always-visible checklist; announces politely only when every rule has just become met. */
export function PasswordRules({ id, password }: { id: string; password: string }) {
  const results = PASSWORD_RULES.map((r) => ({ ...r, met: r.test(password) }));
  const all = results.every((r) => r.met);
  return (
    <>
      <ul
        id={id}
        aria-label="Password rules"
        className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1 text-[13px] min-[420px]:grid-cols-2"
      >
        {results.map((r) => (
          <li
            key={r.id}
            data-met={r.met}
            className={cn(
              'flex items-center gap-1.5',
              r.met ? 'text-success' : 'text-muted-foreground',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'grid size-4 shrink-0 place-items-center rounded-full border-[1.5px]',
                r.met ? 'border-success bg-success text-card' : 'border-current',
              )}
            >
              {r.met ? (
                <Check className="size-3" strokeWidth={3} />
              ) : (
                <Minus className="size-3 opacity-0" />
              )}
            </span>
            <span>
              {r.label}
              <span className="sr-only">{r.met ? ' (met)' : ' (not met)'}</span>
            </span>
          </li>
        ))}
      </ul>
      <LiveRegion message={all ? 'Password meets all rules' : ''} />
    </>
  );
}
