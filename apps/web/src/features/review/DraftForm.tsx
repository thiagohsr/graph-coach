import type { DraftQuestionDto, DraftUpdateRequest } from '@coach/types';
import { OriginLabel } from '~/features/origin/OriginLabel';
import { useForm, useStore } from '@tanstack/react-form';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Textarea } from '~/components/ui/textarea';
import {
  blankCount,
  changedFields,
  formDefaults,
  hasIssues,
  noIssues,
  validateValues,
  type DraftField,
  type DraftFormValues,
  type DraftIssues,
} from './draft-form';

export interface DraftFormProps {
  draft: DraftQuestionDto;
  /** What the server said about the last save or approve; cleared by the parent on the next edit. */
  serverIssues?: DraftIssues;
  busy?: boolean;
  /** Text of the last successful save, announced in the status region. */
  savedNotice?: string;
  onEdit?: () => void;
  onSave: (changes: DraftUpdateRequest) => void;
  onApprove: (changes: DraftUpdateRequest) => void;
  onReject: () => void;
}

const merge = (...lists: (string[] | undefined)[]): string[] => [
  ...new Set(lists.flatMap((l) => l ?? [])),
];

function FieldErrors({ id, messages }: { id: string; messages: string[] }) {
  return (
    <ul id={id} className="list-disc pl-5 text-sm text-destructive">
      {messages.map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  );
}

function ListField({
  label,
  singular,
  values,
  errorId,
  invalid,
  disabled,
  removable,
  onChange,
}: {
  label: string;
  singular: string;
  values: string[];
  errorId: string;
  invalid: boolean;
  disabled: boolean;
  removable: boolean;
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{label}</legend>
      {values.map((value, index) => (
        <div key={index} className="flex items-center gap-2">
          <Label htmlFor={`${singular}-${index}`} className="sr-only">
            {`${singular} ${index + 1}`}
          </Label>
          <Input
            id={`${singular}-${index}`}
            value={value}
            aria-invalid={invalid}
            aria-describedby={errorId}
            disabled={disabled}
            onChange={(e) => onChange(values.map((v, i) => (i === index ? e.target.value : v)))}
          />
          {removable && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              aria-label={`Remove ${singular.toLowerCase()} ${index + 1}`}
              onClick={() => onChange(values.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChange([...values, ''])}
        >
          {`Add ${singular.toLowerCase()}`}
        </Button>
      </div>
    </fieldset>
  );
}

/** The open draft: editable sentence, answers, distractors; read-only concepts; live checks from the shared validator. */
export function DraftForm({
  draft,
  serverIssues = noIssues(),
  busy = false,
  savedNotice,
  onEdit,
  onSave,
  onApprove,
  onReject,
}: DraftFormProps) {
  const form = useForm({ defaultValues: formDefaults(draft) });
  const values = useStore(form.store, (s) => s.values) as DraftFormValues;

  const clientIssues = validateValues(values, draft);
  const blocked = hasIssues(clientIssues);
  const changes = changedFields(values, draft);
  const dirty = Object.keys(changes).length > 0;

  const messages = (field: DraftField) =>
    merge(clientIssues.fields[field], serverIssues.fields[field]);
  const blanks = blankCount(values.sentence);
  const answers = values.answers.length;

  return (
    <section aria-label="Draft" className="flex flex-col gap-4">
      <h2 id="draft-heading" tabIndex={-1} className="text-lg font-semibold outline-none">
        Draft
      </h2>
      {draft.origin === 'prompt' && <OriginLabel origin="prompt" />}

      {merge(serverIssues.form, clientIssues.form).length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-disc pl-5">
              {merge(serverIssues.form, clientIssues.form).map((m) => (
                <li key={m}>{m}</li>
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
        }}
      >
        <form.Field name="sentence">
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="draft-sentence">Sentence</Label>
              <Textarea
                id="draft-sentence"
                rows={3}
                value={field.state.value}
                aria-invalid={messages('sentence').length > 0}
                aria-describedby="draft-sentence-errors"
                disabled={busy}
                onBlur={field.handleBlur}
                onChange={(e) => {
                  field.handleChange(e.target.value);
                  onEdit?.();
                }}
              />
              <FieldErrors id="draft-sentence-errors" messages={messages('sentence')} />
            </div>
          )}
        </form.Field>

        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {`${blanks} ${blanks === 1 ? 'blank' : 'blanks'} · ${answers} ${answers === 1 ? 'answer' : 'answers'}`}
        </p>

        <form.Field name="answers">
          {(field) => (
            <div className="flex flex-col gap-1">
              <ListField
                label="Answers (in order of the blanks)"
                singular="Answer"
                values={field.state.value}
                errorId="draft-answers-errors"
                invalid={messages('answers').length > 0}
                disabled={busy}
                removable={field.state.value.length > 1}
                onChange={(next) => {
                  field.handleChange(next);
                  onEdit?.();
                }}
              />
              <FieldErrors id="draft-answers-errors" messages={messages('answers')} />
            </div>
          )}
        </form.Field>

        <form.Field name="distractors">
          {(field) => (
            <div className="flex flex-col gap-1">
              <ListField
                label="Distractors"
                singular="Distractor"
                values={field.state.value}
                errorId="draft-distractors-errors"
                invalid={messages('distractors').length > 0}
                disabled={busy}
                removable
                onChange={(next) => {
                  field.handleChange(next);
                  onEdit?.();
                }}
              />
              <FieldErrors id="draft-distractors-errors" messages={messages('distractors')} />
            </div>
          )}
        </form.Field>

        <section aria-labelledby="draft-concepts-heading">
          <h3 id="draft-concepts-heading" className="text-sm font-medium">
            Concepts
          </h3>
          {draft.concepts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No concepts are linked.</p>
          ) : (
            <ul className="list-disc pl-5 text-sm">
              {draft.concepts.map((c) => (
                <li key={c.id}>{c.name}</li>
              ))}
            </ul>
          )}
        </section>

        <div role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
          {savedNotice}
        </div>

        <div className="sticky bottom-0 flex flex-wrap gap-2 bg-background py-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy || blocked || !dirty}
            onClick={() => onSave(changes)}
          >
            Save
          </Button>
          <Button type="button" disabled={busy || blocked} onClick={() => onApprove(changes)}>
            Approve
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={onReject}>
            Reject
          </Button>
        </div>
      </form>
    </section>
  );
}
