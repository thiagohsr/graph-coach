import type { DraftQuestionDto } from '@coach/types';

/** Right-hand pane of a prompt draft: the critic's verdict and note, in the place where a passage would be. */
export function CritiquePanel({ draft }: { draft: Pick<DraftQuestionDto, 'critique'> }) {
  return (
    <section aria-label="Critic's check" className="flex flex-col gap-2 rounded-lg border p-4">
      <h2 className="text-lg font-semibold">Critic&apos;s check</h2>
      {draft.critique ? (
        <>
          <p className="text-sm">
            Verdict: <strong>{draft.critique.verdict}</strong>
          </p>
          <p className="text-sm">{draft.critique.note}</p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No critic note was recorded.</p>
      )}
    </section>
  );
}
