import { Link } from '@tanstack/react-router';
import { CheckCircle2Icon, XCircleIcon } from 'lucide-react';
import { buttonVariants } from '~/components/ui/button';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { ConceptChip, masteryStep } from '~/components/mastery/ConceptChip';
import { OriginLabel } from '~/features/origin/OriginLabel';
import type { MasteryChange, ReviewItem, SubmitResult } from '~/lib/api/gameplay-schemas';
import { cn } from '~/lib/utils';

/** Display only: the server's values, rendered as percentages. Nothing is computed from them. */
export const formatMastery = (value: number) => `${Math.round(value * 100)}%`;

/** "up", "down", or "unchanged", from comparing the two server values. */
export function direction(
  change: Pick<MasteryChange, 'before' | 'after'>,
): 'up' | 'down' | 'unchanged' {
  if (change.after > change.before) return 'up';
  if (change.after < change.before) return 'down';
  return 'unchanged';
}

function ReviewLine({ item }: { item: ReviewItem }) {
  return (
    <li
      className={cn(
        'flex flex-col gap-1 rounded-md border p-3',
        item.correct ? 'border-success bg-success-soft' : 'border-danger bg-danger-soft',
      )}
    >
      <p
        className={cn(
          'flex flex-wrap items-center gap-2 font-semibold',
          item.correct ? 'text-success' : 'text-danger',
        )}
      >
        {item.correct ? (
          <CheckCircle2Icon aria-hidden="true" className="size-4" />
        ) : (
          <XCircleIcon aria-hidden="true" className="size-4" />
        )}
        <span>{item.correct ? 'Correct' : 'Incorrect'}</span>
        <span className="font-normal text-text-secondary">Blank {item.blank + 1}</span>
      </p>
      <p>
        Your answer:{' '}
        {item.submitted === null ? <em>left empty</em> : <strong>{item.submitted}</strong>}
      </p>
      <p>
        Expected: <strong>{item.expected}</strong>
      </p>
      {!item.correct && item.passage && (
        <div className="mt-1 flex flex-col gap-1 border-l-2 pl-3">
          <h4 className="text-sm font-semibold">From the source</h4>
          <blockquote className="text-sm">{item.passage.excerpt}</blockquote>
          <Link
            to={`/sources/${item.passage.sourceId}` as never}
            className="text-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
          >
            Open source
          </Link>
        </div>
      )}
    </li>
  );
}

function DirectionMark({ value }: { value: 'up' | 'down' | 'unchanged' }) {
  const tone =
    value === 'up' ? 'text-success' : value === 'down' ? 'text-danger' : 'text-muted-foreground';
  return (
    <span className={cn('inline-flex items-center gap-1.5 font-semibold', tone)}>
      <span aria-hidden="true">{value === 'up' ? '▲' : value === 'down' ? '▼' : '–'}</span>
      <span>{value}</span>
    </span>
  );
}

/** The server's grading of a submitted session. The client never computes a score or a correctness flag. */
export function ResultView({ result }: { result: SubmitResult }) {
  const questions = [...result.questions].sort((a, b) => a.order - b.order);
  const submitted = new Date(result.submittedAt);
  const when = Number.isNaN(submitted.getTime()) ? result.submittedAt : submitted.toLocaleString();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl leading-[30px] font-bold tracking-tight sm:text-[30px] sm:leading-9">
          {result.puzzle.name}
        </h1>
        {result.puzzle.origin === 'prompt' && <OriginLabel origin="prompt" />}
        <p className="text-sm text-muted-foreground">Submitted {when}</p>
      </header>

      <div className="flex flex-col gap-1 rounded-lg border bg-card p-5 shadow-xs sm:p-6">
        <span
          aria-hidden="true"
          className="font-mono text-xs leading-4 font-medium tracking-[0.06em] text-muted-foreground uppercase"
        >
          Score
        </span>
        <p role="status" className="flex items-baseline gap-1.5">
          <span className="sr-only">Score: </span>
          <span className="text-5xl leading-[52px] font-bold tracking-[-0.02em]">
            {result.score}
          </span>
          <span className="font-mono text-[22px] leading-none font-medium text-muted-foreground">{` / ${result.maxScore}`}</span>
        </p>
      </div>

      <section aria-labelledby="review-heading" className="flex flex-col gap-3">
        <h2 id="review-heading" className="text-lg font-semibold">
          Review
        </h2>
        <ol className="flex flex-col gap-4">
          {questions.map((question, index) => {
            const items = result.review
              .filter((r) => r.questionId === question.id)
              .sort((a, b) => a.blank - b.blank);
            return (
              <li key={question.id} className="flex flex-col gap-2">
                <p className="text-base">
                  <span className="text-muted-foreground">{index + 1}. </span>
                  {question.sentence}
                </p>
                <ul className="flex flex-col gap-2">
                  {items.map((item) => (
                    <ReviewLine key={`${item.questionId}:${item.blank}`} item={item} />
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="mastery-heading" className="flex flex-col gap-2">
        <h2 id="mastery-heading" className="text-lg font-semibold">
          Mastery
        </h2>
        {result.mastery.length === 0 ? (
          <p>No concepts are linked to this puzzle, so mastery did not change.</p>
        ) : (
          <Table>
            <TableCaption>Mastery before and after this session</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Concept</TableHead>
                <TableHead>Before</TableHead>
                <TableHead>After</TableHead>
                <TableHead>Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.mastery.map((m) => (
                <TableRow key={m.conceptId}>
                  <TableCell>{m.name}</TableCell>
                  <TableCell>{formatMastery(m.before)}</TableCell>
                  <TableCell>
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <span className="font-mono">{formatMastery(m.after)}</span>
                      <ConceptChip step={masteryStep(m.after)} />
                    </span>
                  </TableCell>
                  <TableCell>
                    <DirectionMark value={direction(m)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <nav aria-label="What to do next" className="flex flex-wrap gap-2">
        <Link to={'/coach' as never} className={cn(buttonVariants())}>
          What next?
        </Link>
        <Link
          to={`/puzzles/${result.puzzle.id}/play` as never}
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          Play again
        </Link>
        <Link to={'/puzzles' as never} className={cn(buttonVariants({ variant: 'outline' }))}>
          All puzzles
        </Link>
      </nav>
    </div>
  );
}
