import {
  BRIEF_FOCUS_MAX,
  BRIEF_SENTENCES_MAX,
  BRIEF_SENTENCES_MIN,
  BRIEF_SUBJECT_MAX,
  BRIEF_SUBJECT_MIN,
  PromptCreateRequest,
  guardBrief,
  type PromptBrief,
} from '@coach/types';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { describeError } from '~/components/states/error-messages';
import { RateLimitNotice } from '~/components/states/RateLimitNotice';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { createSource, isDuplicate, type SourceDuplicate } from '~/lib/api/curator';
import { isApiClientError, type ApiClientError } from '~/lib/api/errors';
import { keys } from '~/lib/query/keys';

export interface PromptFormProps {
  /** Submit stays disabled (the allowance has not loaded yet). */
  disabled?: boolean;
  /** Id of the element that states the allowance, linked to the submit button. */
  describedBy?: string;
  /** The create page shows an exhausted choice without a submit button; the fields and their values stay. */
  submitBlocked?: boolean;
  /** When given, a creation-limit or paused answer is handed to the create page instead of being shown here. */
  onLimit?: (error: ApiClientError) => void;
}

type FieldErrors = Partial<Record<'title' | 'subject' | 'focus' | 'sentences' | 'form', string[]>>;

const selectClass =
  'flex h-10 w-fit items-center rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring';

const PATH_TO_FIELD: Record<string, keyof FieldErrors> = {
  title: 'title',
  'brief.subject': 'subject',
  'brief.focus': 'focus',
  'brief.sentences': 'sentences',
};

/** Checks against the shared brief rules and schema of `@coach/types`; the client defines no bounds of its own. */
function check(value: {
  title: string;
  subject: string;
  focus: string;
  difficulty: PromptBrief['difficulty'];
  sentences: string;
}) {
  const errors: FieldErrors = {};
  const add = (field: keyof FieldErrors, message: string) => {
    errors[field] = [...(errors[field] ?? []), message];
  };
  const title = value.title.trim();
  const sentences = value.sentences.trim() === '' ? Number.NaN : Number(value.sentences);
  if (title === '') add('title', 'Enter a title.');
  const guard = guardBrief({ subject: value.subject, focus: value.focus, sentences });
  for (const reason of guard.reasons) add(PATH_TO_FIELD[reason.path] ?? 'form', reason.message);
  const focus = value.focus.trim();
  const request = {
    title,
    kind: 'prompt' as const,
    brief: {
      subject: value.subject.trim(),
      ...(focus !== '' ? { focus } : {}),
      difficulty: value.difficulty,
      sentences,
    },
  };
  const parsed = PromptCreateRequest.safeParse(request);
  // Schema issues the guard did not already report (for example a missing subject).
  if (!parsed.success && Object.keys(errors).length === 0) {
    for (const issue of parsed.error.issues)
      add(PATH_TO_FIELD[issue.path.join('.')] ?? 'form', issue.message);
  }
  return { errors, request: parsed.success ? parsed.data : null };
}

/** The prompt form of `/sources/new` (contracts/ui-screens.md). Every non-202 outcome keeps what was typed. */
export function PromptForm({ disabled, describedBy, submitBlocked, onLimit }: PromptFormProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<ApiClientError | null>(null);
  const [duplicate, setDuplicate] = useState<SourceDuplicate | null>(null);
  const mutation = useMutation({ mutationFn: createSource });

  const form = useForm({
    defaultValues: {
      title: '',
      subject: '',
      focus: '',
      difficulty: 'medium' as PromptBrief['difficulty'],
      sentences: '5',
    },
    onSubmit: async ({ value }) => {
      setError(null);
      setDuplicate(null);
      const { errors, request } = check(value);
      setFieldErrors(errors);
      if (!request) return;
      try {
        const response = await mutation.mutateAsync(request);
        if (isDuplicate(response)) {
          setDuplicate(response);
          return;
        }
        void queryClient.invalidateQueries({ queryKey: keys.sources.list });
        void queryClient.invalidateQueries({ queryKey: keys.me.allowance });
        await navigate({ to: '/tasks/$taskId', params: { taskId: response.taskId } });
      } catch (caught) {
        if (!isApiClientError(caught)) throw caught;
        if (caught.code === 'CREATION_LIMIT_REACHED' || caught.code === 'CREATION_PAUSED') {
          void queryClient.invalidateQueries({ queryKey: keys.me.allowance });
          if (onLimit) {
            onLimit(caught);
            return;
          }
        }
        if (caught.code === 'VALIDATION_FAILED') {
          const mapped: FieldErrors = {};
          for (const issue of caught.issues) {
            const field = PATH_TO_FIELD[issue.path] ?? 'form';
            mapped[field] = [...(mapped[field] ?? []), issue.message];
          }
          setFieldErrors(mapped);
        }
        setError(caught);
      }
    },
  });

  const messages = (field: keyof FieldErrors) => fieldErrors[field] ?? [];
  const formLevelIssues = error?.code === 'VALIDATION_FAILED' ? messages('form') : [];

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      aria-label="Describe what to practise"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
    >
      {duplicate && (
        <Alert role="status">
          <AlertDescription>
            You already added this material.{' '}
            {duplicate.taskId ? (
              <Link
                to="/tasks/$taskId"
                params={{ taskId: duplicate.taskId }}
                className="font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
              >
                View the run
              </Link>
            ) : (
              <Link
                to="/sources"
                className="font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
              >
                See your sources
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}

      <form.Field name="title">
        {(field) => (
          <div className="flex flex-col gap-1">
            <Label htmlFor="prompt-title">Title</Label>
            <Input
              id="prompt-title"
              value={field.state.value}
              maxLength={200}
              aria-invalid={messages('title').length > 0}
              aria-describedby="prompt-title-error"
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            <p id="prompt-title-error" className="text-sm text-destructive">
              {messages('title').join(' ')}
            </p>
          </div>
        )}
      </form.Field>

      <form.Field name="subject">
        {(field) => (
          <div className="flex flex-col gap-1">
            <Label htmlFor="prompt-subject">Subject</Label>
            <Input
              id="prompt-subject"
              value={field.state.value}
              minLength={BRIEF_SUBJECT_MIN}
              maxLength={BRIEF_SUBJECT_MAX}
              aria-invalid={messages('subject').length > 0}
              aria-describedby="prompt-subject-error"
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            <p id="prompt-subject-error" className="text-sm text-destructive">
              {messages('subject').join(' ')}
            </p>
          </div>
        )}
      </form.Field>

      <form.Field name="focus">
        {(field) => (
          <div className="flex flex-col gap-1">
            <Label htmlFor="prompt-focus">Focus (optional)</Label>
            <Input
              id="prompt-focus"
              value={field.state.value}
              maxLength={BRIEF_FOCUS_MAX}
              aria-invalid={messages('focus').length > 0}
              aria-describedby="prompt-focus-error"
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            <p id="prompt-focus-error" className="text-sm text-destructive">
              {messages('focus').join(' ')}
            </p>
          </div>
        )}
      </form.Field>

      <form.Field name="difficulty">
        {(field) => (
          <div className="flex flex-col gap-1">
            <Label htmlFor="prompt-difficulty">Difficulty</Label>
            <select
              id="prompt-difficulty"
              className={selectClass}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value as PromptBrief['difficulty'])}
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
        )}
      </form.Field>

      <form.Field name="sentences">
        {(field) => (
          <div className="flex flex-col gap-1">
            <Label htmlFor="prompt-sentences">Number of sentences</Label>
            <Input
              id="prompt-sentences"
              type="number"
              inputMode="numeric"
              className="w-28"
              min={BRIEF_SENTENCES_MIN}
              max={BRIEF_SENTENCES_MAX}
              value={field.state.value}
              aria-invalid={messages('sentences').length > 0}
              aria-describedby="prompt-sentences-error"
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            <p id="prompt-sentences-error" className="text-sm text-destructive">
              {messages('sentences').join(' ')}
            </p>
          </div>
        )}
      </form.Field>

      {messages('form').length > 0 && error?.code !== 'VALIDATION_FAILED' && (
        <Alert variant="destructive">
          <AlertDescription>{messages('form').join(' ')}</AlertDescription>
        </Alert>
      )}
      {formLevelIssues.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-disc pl-5">
              {formLevelIssues.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {error?.code === 'SOURCE_REJECTED' && (
        <Alert variant="destructive">
          <AlertDescription>
            <p>The request was not accepted:</p>
            <ul className="list-disc pl-5">
              {(error.reasons.length > 0 ? error.reasons : error.issues.map((i) => i.message)).map(
                (text) => (
                  <li key={text}>{text}</li>
                ),
              )}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {error?.code === 'CREATION_LIMIT_REACHED' && (
        <RateLimitNotice
          message="You have reached the limit for prompt puzzles."
          window={error.window}
          retryAt={error.retryAt}
        />
      )}
      {error?.code === 'RATE_LIMITED' && (
        <RateLimitNotice message={error.message} window={error.window} retryAt={error.retryAt} />
      )}
      {error &&
        ![
          'SOURCE_REJECTED',
          'VALIDATION_FAILED',
          'CREATION_LIMIT_REACHED',
          'RATE_LIMITED',
        ].includes(error.code) && (
          <Alert variant="destructive">
            <AlertDescription>{describeError(error).message}</AlertDescription>
          </Alert>
        )}

      {!submitBlocked && (
        <div>
          <Button
            type="submit"
            disabled={mutation.isPending || disabled === true}
            {...(describedBy ? { 'aria-describedby': describedBy } : {})}
          >
            {mutation.isPending ? 'Sending…' : 'Create puzzle'}
          </Button>
        </div>
      )}
    </form>
  );
}
