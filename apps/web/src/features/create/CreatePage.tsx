import {
  PROMPT_ORIGIN_NOTICE,
  type AllowanceDto,
  type CreationKind,
  type RedeemResult,
} from '@coach/types';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { RouteFocus } from '~/components/a11y/RouteFocus';
import { describeError, formatClock } from '~/components/states/error-messages';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Skeleton } from '~/components/ui/skeleton';
import { RedeemCodeForm, grantedLines } from '~/features/account/RedeemCodeForm';
import { SourceForm } from '~/features/sources/SourceForm';
import { allowanceOptions } from '~/lib/api/account';
import type { ApiClientError } from '~/lib/api/errors';
import { allowanceLine, choiceState, type ChoiceState } from './allowance';
import { CreationLimitNotice } from './CreationLimitNotice';
import { PromptForm } from './PromptForm';

const UPLOAD_DIFFERENCE =
  'Questions are checked against your material and show the passage they came from.';

interface ChoiceProps {
  kind: CreationKind;
  title: string;
  description: string;
  difference: string;
  expanded: boolean;
  onToggle: () => void;
  line: ReactNode;
  state: ChoiceState | null;
  /** Rendered below the allowance line when the choice cannot be submitted. */
  blocked: ReactNode;
  children: ReactNode;
}

function Choice({
  kind,
  title,
  description,
  difference,
  expanded,
  onToggle,
  line,
  blocked,
  children,
}: ChoiceProps) {
  const panelId = `choice-panel-${kind}`;
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-xs"
      aria-labelledby={`choice-heading-${kind}`}
    >
      <h2 id={`choice-heading-${kind}`} className="text-lg font-semibold">
        <button
          type="button"
          className="text-left underline-offset-4 hover:underline focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-none"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
        >
          {title}
        </button>
      </h2>
      <p className="text-sm">{description}</p>
      <p className="text-sm text-muted-foreground">{difference}</p>
      <div id={`allowance-${kind}`} className="text-sm font-medium">
        {line}
      </div>
      {blocked}
      <div id={panelId} hidden={!expanded}>
        {expanded && children}
      </div>
    </section>
  );
}

/** `/sources/new` (contracts/ui-screens.md): two ways to create, each with its allowance line and its form. */
export function CreatePage({ initialChoice = null }: { initialChoice?: CreationKind | null }) {
  const allowance = useQuery(allowanceOptions());
  const [choice, setChoice] = useState<CreationKind | null>(initialChoice);
  const [limit, setLimit] = useState<ApiClientError | null>(null);
  const [granted, setGranted] = useState<RedeemResult | null>(null);
  const now = new Date();

  const data: AllowanceDto | undefined = allowance.data;
  const loading = allowance.isPending;
  const stateOf = (kind: CreationKind): ChoiceState | null =>
    data ? choiceState(data, kind, now) : null;
  const states = { prompt: stateOf('prompt'), upload: stateOf('upload') };
  const hourlyReached =
    states.prompt?.state === 'hourly_reached' || states.upload?.state === 'hourly_reached';

  const redeem = (heading: string) => (
    <section aria-label={heading} className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold">{heading}</h3>
      <RedeemCodeForm
        quiet
        onGranted={(result) => {
          setLimit(null);
          setGranted(result);
        }}
      />
    </section>
  );

  const lineFor = (kind: CreationKind): ReactNode => {
    if (loading) return <Skeleton className="h-5 w-48" aria-label="Loading allowance" />;
    if (!data)
      return (
        <span className="font-normal text-muted-foreground">
          Your allowance could not be loaded; the server will decide when you submit.
        </span>
      );
    const text = allowanceLine(data, kind, now);
    const retry =
      states[kind]?.state === 'hourly_reached' && limit?.window === 'hour' && limit.retryAt;
    return retry ? `${text} Try again at ${formatClock(limit.retryAt!)}.` : text;
  };

  const blockedFor = (kind: CreationKind): ReactNode =>
    states[kind]?.state === 'exhausted' ? redeem('Redeem a code') : null;
  const submitBlocked = (kind: CreationKind) => {
    const state = states[kind]?.state;
    return state === 'exhausted' || state === 'hourly_reached';
  };

  const toggle = (kind: CreationKind) => setChoice((current) => (current === kind ? null : kind));
  const common = (kind: CreationKind) => ({
    disabled: loading,
    describedBy: `allowance-${kind}`,
    submitBlocked: submitBlocked(kind),
    onLimit: setLimit,
  });

  return (
    <div className="flex flex-col gap-4">
      <RouteFocus title="Create a puzzle" />
      <h1 className="text-2xl leading-[30px] font-bold tracking-tight sm:text-[30px] sm:leading-9">
        Create a puzzle
      </h1>
      <div
        role="group"
        aria-label="How do you want to create a puzzle?"
        className="grid gap-4 md:grid-cols-2"
      >
        <Choice
          kind="prompt"
          title="Describe what to practise"
          description="Tell the Coach a subject and it writes the sentences."
          difference={PROMPT_ORIGIN_NOTICE}
          expanded={choice === 'prompt'}
          onToggle={() => toggle('prompt')}
          line={lineFor('prompt')}
          state={states.prompt}
          blocked={blockedFor('prompt')}
        >
          {states.prompt?.state === 'paused' ? null : <PromptForm {...common('prompt')} />}
        </Choice>
        <Choice
          kind="upload"
          title="Use your own material"
          description="Paste a text or Markdown document and get questions from it."
          difference={UPLOAD_DIFFERENCE}
          expanded={choice === 'upload'}
          onToggle={() => toggle('upload')}
          line={lineFor('upload')}
          state={states.upload}
          blocked={blockedFor('upload')}
        >
          {states.upload?.state === 'paused' ? null : <SourceForm {...common('upload')} />}
        </Choice>
      </div>

      {granted && (
        <div role="status" className="rounded-md border border-success bg-success-soft p-3 text-sm">
          <ul className="list-none">
            {grantedLines(granted).map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </div>
      )}
      {hourlyReached && redeem('Redeem a code to lift the hourly limit')}
      {limit?.code === 'CREATION_LIMIT_REACHED' && (
        <CreationLimitNotice error={limit} redeem={redeem('Redeem a code')} />
      )}
      {limit?.code === 'CREATION_PAUSED' && (
        <Alert variant="destructive">
          <AlertDescription>{describeError(limit).message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
