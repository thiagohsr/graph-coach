import type { DraftQuestionDto } from '@coach/types';

/** Right-hand pane of an upload draft: the passage it came from, or a note that none is linked. */
export function PassagePanel({ draft }: { draft: Pick<DraftQuestionDto, 'passage'> }) {
  return (
    <section aria-label="Source passage" className="flex flex-col gap-2 rounded-lg border p-4">
      <h2 className="text-lg font-semibold">Source passage</h2>
      {draft.passage ? (
        <blockquote className="text-sm break-words whitespace-pre-wrap">{draft.passage.text}</blockquote>
      ) : (
        <p className="text-sm text-muted-foreground">No source passage is linked to this draft</p>
      )}
    </section>
  );
}
