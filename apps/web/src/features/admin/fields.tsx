import type { AdminFieldMeta, AdminValue } from '@coach/types';
import { Input } from '~/components/ui/input';
import { Textarea } from '~/components/ui/textarea';

// Field-type registry of the generic admin (contracts/ui-screens.md "/admin"). Nothing here knows a model or a
// field by name: everything follows the metadata `type`, `readonly`, `computed`, `choices`, `min`, and `max`.

/** What a control holds: a boolean for a checkbox, text for every other control. */
export type FormValue = string | boolean;

const EDITABLE_TYPES: string[] = [
  'string',
  'text',
  'integer',
  'number',
  'boolean',
  'enum',
  'list',
  'json',
];

export function isEditable(field: AdminFieldMeta, modelReadOnly: boolean): boolean {
  if (modelReadOnly || field.readonly || field.computed) return false;
  return EDITABLE_TYPES.includes(field.type);
}

/** The control value for a stored value. `null` and missing values give an empty control. */
export function toFormValue(field: AdminFieldMeta, value: AdminValue | undefined): FormValue {
  if (field.type === 'boolean') return value === true;
  if (value === null || value === undefined) return '';
  switch (field.type) {
    case 'list':
      return Array.isArray(value) ? value.map((v) => String(v)).join('\n') : String(value);
    case 'json':
      return JSON.stringify(value, null, 2);
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}

export function boundsMessage(field: Pick<AdminFieldMeta, 'min' | 'max'>): string | null {
  const { min, max } = field;
  if (min !== undefined && max !== undefined) return `Must be between ${min} and ${max}.`;
  if (min !== undefined) return `Must be at least ${min}.`;
  if (max !== undefined) return `Must be at most ${max}.`;
  return null;
}

export type ParseResult = { ok: true; value: unknown } | { ok: false; message: string };

/** The value to send for a control value, or a message when it cannot be sent. */
export function parseFormValue(field: AdminFieldMeta, raw: FormValue): ParseResult {
  if (typeof raw === 'boolean') return { ok: true, value: raw };
  switch (field.type) {
    case 'integer':
    case 'number': {
      const text = raw.trim();
      if (text === '') return { ok: true, value: null };
      const n = Number(text);
      if (!Number.isFinite(n)) return { ok: false, message: 'Must be a number.' };
      if (field.type === 'integer' && !Number.isInteger(n))
        return { ok: false, message: 'Must be a whole number.' };
      if (
        (field.min !== undefined && n < field.min) ||
        (field.max !== undefined && n > field.max)
      ) {
        return { ok: false, message: boundsMessage(field) ?? 'Out of range.' };
      }
      return { ok: true, value: n };
    }
    case 'list':
      return {
        ok: true,
        value: raw
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== ''),
      };
    case 'json': {
      if (raw.trim() === '') return { ok: true, value: null };
      try {
        return { ok: true, value: JSON.parse(raw) as unknown };
      } catch {
        return { ok: false, message: 'Must be valid JSON.' };
      }
    }
    default:
      // An empty optional text is sent as null; a required one is sent as typed so the server reports it.
      return { ok: true, value: raw === '' && !field.required ? null : raw };
  }
}

function formatDatetime(text: string): string {
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** Plain text for a control value (read-only display and the confirmation dialog). */
export function displayFormValue(field: AdminFieldMeta, value: FormValue): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === '') return '';
  if (field.type === 'datetime') return formatDatetime(value);
  return value;
}

export interface FieldControlProps {
  field: AdminFieldMeta;
  value: FormValue;
  editable: boolean;
  onChange: (value: FormValue) => void;
  error?: string | undefined;
}

export function FieldControl({ field, value, editable, onChange, error }: FieldControlProps) {
  const id = `field-${field.name}`;
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const describedBy =
    [field.help ? helpId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  const common = {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
  } as const;

  const footer = (
    <>
      {field.help && (
        <p id={helpId} className="text-xs text-muted-foreground">
          {field.help}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );

  // Unknown types and datetimes are never inputs, whatever the caller says.
  if (!editable || !EDITABLE_TYPES.includes(field.type)) {
    const text = displayFormValue(field, value);
    const multiline = field.type === 'list' || field.type === 'json' || field.type === 'text';
    const shown = text === '' && field.computed ? 'Unavailable' : text;
    return (
      <div className="flex flex-col gap-1" data-field={field.name}>
        <span className="text-sm font-medium">{field.label}</span>
        <span className={multiline ? 'whitespace-pre-wrap break-words' : 'break-words'}>
          {shown}
        </span>
        {footer}
      </div>
    );
  }

  const label = (
    <label htmlFor={id} className="text-sm font-medium">
      {field.label}
      {field.required ? <span> (required)</span> : null}
    </label>
  );

  let control;
  switch (field.type) {
    case 'text':
      control = (
        <Textarea
          {...common}
          value={String(value)}
          maxLength={field.maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case 'list':
      control = (
        <Textarea
          {...common}
          value={String(value)}
          rows={4}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case 'json':
      control = (
        <Textarea
          {...common}
          value={String(value)}
          rows={6}
          spellCheck={false}
          className="font-mono"
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case 'integer':
    case 'number':
      control = (
        <Input
          {...common}
          type="number"
          inputMode="decimal"
          step={field.type === 'integer' ? 1 : 'any'}
          min={field.min}
          max={field.max}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case 'boolean':
      return (
        <div className="flex flex-col gap-1" data-field={field.name}>
          <div className="flex items-center gap-2">
            <input
              {...common}
              type="checkbox"
              className="size-4"
              checked={value === true}
              onChange={(e) => onChange(e.target.checked)}
            />
            {label}
          </div>
          {footer}
        </div>
      );
    case 'enum':
      control = (
        <select
          {...common}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
        >
          {!field.required || value === '' ? <option value="">(none)</option> : null}
          {(field.choices ?? []).map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      );
      break;
    default:
      control = (
        <Input
          {...common}
          type="text"
          value={String(value)}
          maxLength={field.maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }

  return (
    <div className="flex flex-col gap-1" data-field={field.name}>
      {label}
      {control}
      {footer}
    </div>
  );
}
