import type { AdminAction, AdminDetailResponse, AdminFieldMeta, AdminModelMeta } from '@coach/types';
import { useEffect, useMemo, useState } from 'react';
import { describeError } from '~/components/states/error-messages';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { isApiClientError } from '~/lib/api/errors';
import { AdminLinks } from './AdminLinks';
import {
  boundsMessage,
  displayFormValue,
  FieldControl,
  isEditable,
  parseFormValue,
  toFormValue,
  type FormValue,
} from './fields';

export interface AdminFormProps {
  model: AdminModelMeta;
  detail: AdminDetailResponse;
  /** Sends `PATCH { values }` and resolves when the record has been stored; rejects with the API error. */
  onSave: (values: Record<string, unknown>) => Promise<unknown>;
}

interface Change {
  name: string;
  from: string;
  to: string;
}

type Pending =
  | { kind: 'save'; values: Record<string, unknown>; changes: Change[] }
  | { kind: 'action'; action: AdminAction; from: string };

const shown = (text: string) => (text === '' ? '(empty)' : text);

function initialValues(model: AdminModelMeta, detail: AdminDetailResponse): Record<string, FormValue> {
  return Object.fromEntries(model.fields.map((f) => [f.name, toFormValue(f, detail.record.values[f.name])]));
}

export function AdminForm({ model, detail, onSave }: AdminFormProps) {
  const initial = useMemo(() => initialValues(model, detail), [model, detail]);
  const [values, setValues] = useState<Record<string, FormValue>>(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [readOnlyAlert, setReadOnlyAlert] = useState(false);
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [saving, setSaving] = useState(false);

  // A reloaded record (after a save or a quick action) replaces what is in the controls.
  const recordKey = JSON.stringify(detail.record.values);
  useEffect(() => {
    setValues(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordKey]);

  const fieldByName = (name: string): AdminFieldMeta | undefined => model.fields.find((f) => f.name === name);

  function clearErrors() {
    setFieldErrors({});
    setFormErrors([]);
    setReadOnlyAlert(false);
    setStatus('');
  }

  function handleError(error: unknown) {
    if (isApiClientError(error)) {
      if (error.status === 405 || error.code === 'ADMIN_MODEL_READ_ONLY') {
        setReadOnlyAlert(true);
        return;
      }
      if (error.status === 422) {
        const byField: Record<string, string> = {};
        const general: string[] = [];
        for (const issue of error.issues) {
          const name = issue.path.startsWith('values.') ? issue.path.slice('values.'.length) : null;
          const field = name ? fieldByName(name) : undefined;
          if (name && field) {
            byField[name] =
              error.issueCodes[issue.path] === 'out_of_range' ? (boundsMessage(field) ?? issue.message) : issue.message;
          } else {
            general.push(issue.message);
          }
        }
        for (const reason of error.reasons) general.push(reason);
        if (general.length === 0 && Object.keys(byField).length === 0) general.push(error.message);
        setFieldErrors(byField);
        setFormErrors(general);
        return;
      }
    }
    setFormErrors([describeError(error).message]);
  }

  async function send(payload: Record<string, unknown>) {
    setSaving(true);
    clearErrors();
    try {
      await onSave(payload);
      setStatus('Saved.');
    } catch (error) {
      handleError(error);
    } finally {
      setSaving(false);
      setPending(null);
    }
  }

  function requestSave() {
    clearErrors();
    const errors: Record<string, string> = {};
    const payload: Record<string, unknown> = {};
    const changes: Change[] = [];
    for (const field of model.fields) {
      if (!isEditable(field, model.readOnly)) continue;
      const now = values[field.name] ?? '';
      const before = initial[field.name] ?? '';
      if (now === before) continue;
      const parsed = parseFormValue(field, now);
      if (!parsed.ok) {
        errors[field.name] = parsed.message;
        continue;
      }
      payload[field.name] = parsed.value;
      changes.push({ name: field.name, from: displayFormValue(field, before), to: displayFormValue(field, now) });
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    if (changes.length === 0) {
      setStatus('There are no changes to save.');
      return;
    }
    setPending({ kind: 'save', values: payload, changes });
  }

  function requestAction(action: AdminAction) {
    clearErrors();
    const field = fieldByName(action.field);
    const from = field ? displayFormValue(field, initial[action.field] ?? '') : '';
    setPending({ kind: 'action', action, from });
  }

  const hasEditable = model.fields.some((f) => isEditable(f, model.readOnly));

  return (
    <div className="flex flex-col gap-6">
      {readOnlyAlert && (
        <Alert variant="destructive">
          <AlertDescription>This model is read-only.</AlertDescription>
        </Alert>
      )}
      {formErrors.length > 0 && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            <ul className="list-disc pl-5">
              {formErrors.map((message, i) => (
                <li key={i}>{message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!model.readOnly) requestSave();
        }}
      >
        {model.fields.map((field) => (
          <FieldControl
            key={field.name}
            field={field}
            value={values[field.name] ?? ''}
            editable={isEditable(field, model.readOnly)}
            error={fieldErrors[field.name]}
            onChange={(v) => setValues((prev) => ({ ...prev, [field.name]: v }))}
          />
        ))}
        {!model.readOnly && hasEditable && (
          <div>
            <Button type="submit" disabled={saving}>
              Save
            </Button>
          </div>
        )}
        <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {status}
        </div>
      </form>

      {detail.actions.length > 0 && (
        <section aria-labelledby="admin-actions-heading" className="flex flex-col gap-2">
          <h2 id="admin-actions-heading" className="text-lg font-semibold">
            Quick actions
          </h2>
          <div className="flex flex-wrap gap-2">
            {detail.actions.map((action) => (
              <Button
                key={`${action.field}:${action.value}`}
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => requestAction(action)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        </section>
      )}

      <AdminLinks links={detail.links} />

      <Dialog open={pending !== null} onOpenChange={(open) => !open && !saving && setPending(null)}>
        <DialogContent>
          {pending?.kind === 'save' && (
            <>
              <DialogHeader>
                <DialogTitle>Save these changes?</DialogTitle>
                <DialogDescription>Nothing is saved until you confirm.</DialogDescription>
              </DialogHeader>
              <ul className="list-disc pl-5">
                {pending.changes.map((c) => (
                  <li key={c.name}>{`${c.name}: ${shown(c.from)} → ${shown(c.to)}`}</li>
                ))}
              </ul>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPending(null)}>
                  Cancel
                </Button>
                <Button type="button" disabled={saving} onClick={() => void send(pending.values)}>
                  Confirm
                </Button>
              </DialogFooter>
            </>
          )}
          {pending?.kind === 'action' && (
            <>
              <DialogHeader>
                <DialogTitle>{`${pending.action.label} this record?`}</DialogTitle>
                <DialogDescription>
                  {`${pending.action.field}: ${shown(pending.from)} → ${pending.action.value}`}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPending(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={saving}
                  onClick={() => void send({ [pending.action.field]: pending.action.value })}
                >
                  Confirm
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
