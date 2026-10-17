import {
  UPLOAD_NOTICE,
  countWords,
  guard,
  GUARD_DEFAULTS,
  type GuardReason,
  type UploadKind,
} from '@coach/types';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { describeError } from '~/components/states/error-messages';
import { RateLimitNotice } from '~/components/states/RateLimitNotice';
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
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Textarea } from '~/components/ui/textarea';
import { createSource, isDuplicate, type SourceDuplicate } from '~/lib/api/curator';
import { isApiClientError, type ApiClientError } from '~/lib/api/errors';
import { keys } from '~/lib/query/keys';
import { ExtractError, FILE_ACCEPT, extractFile, keepFirstWords } from './extract-text';

type FormKind = Extract<UploadKind, 'text' | 'markdown'>;

const KIND_TEXT: Record<string, string> = { upload: 'uploads', prompt: 'prompt puzzles' };

export interface SourceFormProps {
  /** Rendered below the upload notice and above the submit button (the redeem-code form of the allowance story). */
  redeemSlot?: ReactNode;
  /** Submit stays disabled (the allowance has not loaded yet). */
  disabled?: boolean;
  /** Id of the element that states the allowance, linked to the submit button. */
  describedBy?: string;
  /** The create page shows an exhausted choice without a submit button; the fields and their values stay. */
  submitBlocked?: boolean;
  /** When given, a creation-limit or paused answer is handed to the create page instead of being shown here. */
  onLimit?: (error: ApiClientError) => void;
}

const selectClass =
  'flex h-10 w-fit items-center rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** The upload form of `/sources/new` (contracts/ui-screens.md). Every non-202 outcome keeps what was typed. */
export function SourceForm({
  redeemSlot,
  disabled,
  describedBy,
  submitBlocked,
  onLimit,
}: SourceFormProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [guardReasons, setGuardReasons] = useState<GuardReason[]>([]);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [duplicate, setDuplicate] = useState<SourceDuplicate | null>(null);

  const [fileStatus, setFileStatus] = useState<
    | { state: 'idle' }
    | { state: 'reading'; name: string }
    | { state: 'done'; name: string; words: number }
    | { state: 'error'; message: string }
  >({ state: 'idle' });
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const extractedText = useRef<string | null>(null);
  const readToken = useRef(0);

  const mutation = useMutation({ mutationFn: createSource });

  const form = useForm({
    defaultValues: { title: '', kind: 'text' as FormKind, content: '' },
    onSubmit: async ({ value }) => {
      setError(null);
      setDuplicate(null);
      const title = value.title.trim();
      const reasons = guard({ kind: value.kind, content: value.content }).reasons;
      setGuardReasons(reasons);
      setTitleError(title === '' ? 'Enter a title.' : null);
      if (title === '' || reasons.length > 0) return;
      try {
        const response = await mutation.mutateAsync({
          title,
          kind: value.kind,
          content: value.content,
        });
        if (isDuplicate(response)) {
          setDuplicate(response);
          return;
        }
        void queryClient.invalidateQueries({ queryKey: keys.sources.list });
        void queryClient.invalidateQueries({ queryKey: keys.me.allowance });
        await navigate({ to: '/tasks/$taskId', params: { taskId: response.taskId } });
      } catch (caught) {
        if (isApiClientError(caught)) {
          if (caught.code === 'CREATION_LIMIT_REACHED' || caught.code === 'CREATION_PAUSED') {
            void queryClient.invalidateQueries({ queryKey: keys.me.allowance });
            if (onLimit) {
              setError(null);
              onLimit(caught);
              return;
            }
          }
          setError(caught);
        } else {
          setError(null);
          throw caught;
        }
      }
    },
  });

  const readFile = async (file: File) => {
    const token = ++readToken.current;
    setFileStatus({ state: 'reading', name: file.name });
    try {
      const result = await extractFile(file);
      if (token !== readToken.current) return;
      extractedText.current = result.text;
      form.setFieldValue('content', result.text);
      form.setFieldValue('kind', result.kind);
      if (form.getFieldValue('title').trim() === '' && result.title !== '') {
        form.setFieldValue('title', result.title);
        setTitleError(null);
      }
      setGuardReasons(guard({ kind: result.kind, content: result.text }).reasons);
      setFileStatus({ state: 'done', name: file.name, words: result.words });
    } catch (caught) {
      if (token !== readToken.current) return;
      setFileStatus({
        state: 'error',
        message:
          caught instanceof ExtractError
            ? caught.message
            : 'This file could not be read. Try another file or paste the text.',
      });
    }
  };

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    const current = form.getFieldValue('content');
    if (current.trim() !== '' && current !== extractedText.current) {
      setPendingFile(file);
      return;
    }
    void readFile(file);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    chooseFile(e.dataTransfer.files[0]);
  };

  const fieldIssue = (path: string) => error?.issues.find((i) => i.path === path)?.message;
  const unmappedIssues =
    error?.issues.filter((i) => !['title', 'kind', 'content'].includes(i.path)) ?? [];

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
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
            <Label htmlFor="source-title">Title</Label>
            <Input
              id="source-title"
              value={field.state.value}
              maxLength={200}
              aria-invalid={Boolean(titleError ?? fieldIssue('title'))}
              aria-describedby="source-title-error"
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            <p id="source-title-error" className="text-sm text-destructive">
              {titleError ?? fieldIssue('title')}
            </p>
          </div>
        )}
      </form.Field>

      <form.Field name="kind">
        {(field) => (
          <div className="flex flex-col gap-1">
            <Label htmlFor="source-kind">Kind</Label>
            <select
              id="source-kind"
              className={selectClass}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value as FormKind)}
            >
              <option value="text">Text</option>
              <option value="markdown">Markdown</option>
            </select>
            {fieldIssue('kind') && <p className="text-sm text-destructive">{fieldIssue('kind')}</p>}
          </div>
        )}
      </form.Field>

      <form.Field name="content">
        {(field) => (
          <div className="flex flex-col gap-1">
            <Label htmlFor="source-content">Content</Label>
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileInput}
                id="source-file"
                type="file"
                accept={FILE_ACCEPT}
                className="sr-only"
                aria-label="Upload a file"
                tabIndex={-1}
                onChange={(e) => {
                  chooseFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={fileStatus.state === 'reading'}
                onClick={() => fileInput.current?.click()}
              >
                Choose a file
              </Button>
              <span className="text-sm text-muted-foreground" id="source-file-hint">
                PDF, Word (.docx), text or Markdown, up to 15 MB. Or drop it on the box below.
              </span>
            </div>
            <div role="status" aria-live="polite" className="text-sm">
              {fileStatus.state === 'reading' && (
                <p className="text-muted-foreground">Reading {fileStatus.name}…</p>
              )}
              {fileStatus.state === 'done' && (
                <p className="text-muted-foreground">
                  Extracted {fileStatus.words.toLocaleString('en-US')} words from {fileStatus.name}.
                  You can edit the text before sending.
                </p>
              )}
            </div>
            {fileStatus.state === 'error' && (
              <p role="alert" className="text-sm text-destructive">
                {fileStatus.message}
              </p>
            )}
            <Textarea
              onDragOver={(e: DragEvent) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={dragging ? 'outline-solid outline-3 outline-ring' : undefined}
              id="source-content"
              rows={12}
              value={field.state.value}
              aria-invalid={guardReasons.length > 0 || Boolean(fieldIssue('content'))}
              aria-describedby="source-content-reasons source-content-count"
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={() => {
                field.handleBlur();
                if (field.state.value.trim() !== '') {
                  setGuardReasons(
                    guard({ kind: form.getFieldValue('kind'), content: field.state.value }).reasons,
                  );
                }
              }}
            />
            <p id="source-content-count" className="text-sm text-muted-foreground">
              {countWords(field.state.value)} words
            </p>
            {countWords(field.state.value) > GUARD_DEFAULTS.maxWords && (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const trimmed = keepFirstWords(field.state.value, GUARD_DEFAULTS.maxWords);
                    field.handleChange(trimmed);
                    setGuardReasons(
                      guard({ kind: form.getFieldValue('kind'), content: trimmed }).reasons,
                    );
                  }}
                >
                  Keep the first {GUARD_DEFAULTS.maxWords.toLocaleString('en-US')} words
                </Button>
              </div>
            )}
            <div id="source-content-reasons">
              {guardReasons.length > 0 && (
                <ul
                  className="list-disc pl-5 text-sm text-destructive"
                  aria-label="Problems with the text"
                >
                  {guardReasons.map((reason) => (
                    <li key={reason.code}>{reason.message}</li>
                  ))}
                </ul>
              )}
              {fieldIssue('content') && (
                <p className="text-sm text-destructive">{fieldIssue('content')}</p>
              )}
            </div>
          </div>
        )}
      </form.Field>

      {error?.code === 'SOURCE_REJECTED' && (
        <Alert variant="destructive">
          <AlertDescription>
            <p>The text was not accepted:</p>
            <ul className="list-disc pl-5">
              {(error.issues.length > 0 ? error.issues.map((i) => i.message) : error.reasons).map(
                (text) => (
                  <li key={text}>{text}</li>
                ),
              )}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {error?.code === 'VALIDATION_FAILED' &&
        (unmappedIssues.length > 0 || error.issues.length === 0) && (
          <Alert variant="destructive">
            <AlertDescription>
              {unmappedIssues.length > 0 ? (
                <ul className="list-disc pl-5">
                  {unmappedIssues.map((i) => (
                    <li key={`${i.path}:${i.message}`}>{i.message}</li>
                  ))}
                </ul>
              ) : (
                error.message
              )}
            </AlertDescription>
          </Alert>
        )}
      {error?.code === 'CREATION_LIMIT_REACHED' && (
        <RateLimitNotice
          message={`You have reached the limit for ${KIND_TEXT[error.kind ?? 'upload']}.`}
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

      <Dialog open={pendingFile !== null} onOpenChange={(open) => !open && setPendingFile(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace current text?</DialogTitle>
            <DialogDescription>
              The text you typed will be replaced by the text from {pendingFile?.name}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingFile(null)}>
              Keep my text
            </Button>
            <Button
              type="button"
              onClick={() => {
                const file = pendingFile;
                setPendingFile(null);
                if (file) void readFile(file);
              }}
            >
              Replace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="text-sm text-muted-foreground" id="upload-notice">
        {UPLOAD_NOTICE}
      </p>
      {redeemSlot}
      {!submitBlocked && (
        <div>
          <Button
            type="submit"
            disabled={mutation.isPending || disabled === true}
            aria-describedby={describedBy ? `upload-notice ${describedBy}` : 'upload-notice'}
          >
            {mutation.isPending ? 'Sending…' : 'Create puzzle'}
          </Button>
        </div>
      )}
    </form>
  );
}
