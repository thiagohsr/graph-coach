import type { DraftQuestionDto, DraftUpdateRequest, ReviewOutcome } from '@coach/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { describeError } from '~/components/states/error-messages';
import { EmptyState } from '~/components/states/EmptyState';
import { ErrorState } from '~/components/states/ErrorState';
import { LoadingState } from '~/components/states/LoadingState';
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
import { Label } from '~/components/ui/label';
import { Textarea } from '~/components/ui/textarea';
import { sourcesListOptions } from '~/lib/api/curator';
import { isApiClientError, isCode, isStatus } from '~/lib/api/errors';
import { approveDraft, draftsOptions, rejectDraft, updateDraft } from '~/lib/api/review';
import { keys } from '~/lib/query/keys';
import { mapServerError, noIssues, type DraftIssues } from './draft-form';
import { CritiquePanel } from './CritiquePanel';
import { DraftForm } from './DraftForm';
import { PassagePanel } from './PassagePanel';
import { ReviewOutcomePanel } from './ReviewOutcomePanel';

export interface ReviewScreenProps {
  taskId?: string | undefined;
}

interface Group {
  taskId: string | null;
  title: string;
  drafts: { draft: DraftQuestionDto; number: number }[];
}

const plural = (n: number) => `${n} ${n === 1 ? 'draft' : 'drafts'} remaining`;

/** `/review`: the caller's own drafts, one at a time, next to the passage (or the critic's check). */
export function ReviewScreen({ taskId }: ReviewScreenProps) {
  const queryClient = useQueryClient();
  const draftsQuery = useQuery(draftsOptions({ taskId }));
  const sources = useQuery(sourcesListOptions());

  const [activeId, setActiveId] = useState<string | null>(null);
  const [outcomeByTask, setOutcomeByTask] = useState<Record<string, ReviewOutcome>>({});
  const [lastOutcome, setLastOutcome] = useState<ReviewOutcome | null>(null);
  const [lastTaskKey, setLastTaskKey] = useState<string | null>(null);
  const [issues, setIssues] = useState<DraftIssues>(noIssues());
  const [notice, setNotice] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [focusRequest, setFocusRequest] = useState<{ seq: number; id: string } | null>(null);

  const drafts = draftsQuery.data;
  const active = drafts?.find((d) => d.id === activeId) ?? drafts?.[0];

  const titleByTask = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sources.data ?? []) if (s.taskId && s.access === 'owner') map.set(s.taskId, s.title);
    return map;
  }, [sources.data]);

  const groups = useMemo<Group[]>(() => {
    const out = new Map<string, Group>();
    (drafts ?? []).forEach((draft, index) => {
      const key = draft.taskId ?? '';
      const group = out.get(key) ?? {
        taskId: draft.taskId,
        title: (draft.taskId && titleByTask.get(draft.taskId)) || 'Untitled source',
        drafts: [],
      };
      group.drafts.push({ draft, number: index + 1 });
      out.set(key, group);
    });
    return [...out.values()];
  }, [drafts, titleByTask]);

  useEffect(() => {
    if (!focusRequest) return;
    document.getElementById(focusRequest.id)?.focus();
  }, [focusRequest]);

  const requestFocus = (id: string) => setFocusRequest((f) => ({ seq: (f?.seq ?? 0) + 1, id }));

  function replaceInLists(updated: DraftQuestionDto) {
    queryClient.setQueriesData<DraftQuestionDto[]>({ queryKey: keys.review.all }, (old) =>
      old?.map((d) => (d.id === updated.id ? updated : d)),
    );
  }

  function removeFromLists(draftId: string) {
    queryClient.setQueriesData<DraftQuestionDto[]>({ queryKey: keys.review.all }, (old) =>
      old?.filter((d) => d.id !== draftId),
    );
  }

  /** Opens the draft that now sits where the removed one was. */
  function openNeighbour(removedId: string) {
    const list = drafts ?? [];
    const index = list.findIndex((d) => d.id === removedId);
    const rest = list.filter((d) => d.id !== removedId);
    setActiveId(rest[Math.min(Math.max(index, 0), rest.length - 1)]?.id ?? null);
  }

  function handleOutcome(draft: DraftQuestionDto, outcome: ReviewOutcome) {
    removeFromLists(draft.id);
    const key = draft.taskId ?? draft.puzzleId;
    setOutcomeByTask((prev) => ({ ...prev, [key]: outcome }));
    setLastOutcome(outcome);
    setLastTaskKey(key);
    if (outcome.puzzle.status === 'published' || outcome.remainingDrafts === 0) {
      void queryClient.invalidateQueries({ queryKey: keys.puzzles.list });
      void queryClient.invalidateQueries({ queryKey: keys.sources.list });
      if (draft.taskId) void queryClient.invalidateQueries({ queryKey: keys.tasks.detail(draft.taskId) });
    }
    openNeighbour(draft.id);
    setIssues(noIssues());
    setSavedNotice('');
    setNotice(null);
    requestFocus(outcome.remainingDrafts === 0 ? 'outcome-heading' : 'draft-heading');
  }

  function handleFailure(draft: DraftQuestionDto, error: unknown) {
    if (isCode(error, 'ALREADY_DECIDED')) {
      setNotice('Someone already decided this draft');
      void queryClient.invalidateQueries({ queryKey: keys.review.all });
      return;
    }
    if (isStatus(error, 404)) {
      removeFromLists(draft.id);
      openNeighbour(draft.id);
      setNotice('This draft no longer exists and was removed from the list.');
      return;
    }
    if (isApiClientError(error) && error.status !== 422) {
      setIssues({ fields: {}, form: [describeError(error).message] });
      return;
    }
    setIssues(mapServerError(error));
  }

  async function save(draft: DraftQuestionDto, changes: DraftUpdateRequest) {
    setBusy(true);
    setIssues(noIssues());
    setNotice(null);
    try {
      const updated = await updateDraft(draft.id, changes);
      replaceInLists(updated);
      setSavedNotice('Saved.');
    } catch (error) {
      handleFailure(draft, error);
    } finally {
      setBusy(false);
    }
  }

  async function approve(draft: DraftQuestionDto, changes: DraftUpdateRequest) {
    setBusy(true);
    setIssues(noIssues());
    setNotice(null);
    try {
      // Approve saves first when something changed, so the stored draft is the one that is approved.
      if (Object.keys(changes).length > 0) replaceInLists(await updateDraft(draft.id, changes));
      handleOutcome(draft, await approveDraft(draft.id));
    } catch (error) {
      handleFailure(draft, error);
    } finally {
      setBusy(false);
    }
  }

  async function reject(draft: DraftQuestionDto) {
    setBusy(true);
    setIssues(noIssues());
    setNotice(null);
    try {
      const outcome = await rejectDraft(draft.id, reason);
      setRejecting(false);
      setReason('');
      handleOutcome(draft, outcome);
    } catch (error) {
      setRejecting(false);
      handleFailure(draft, error);
    } finally {
      setBusy(false);
    }
  }

  if (draftsQuery.isPending) return <LoadingState label="Loading drafts" rows={3} />;
  if (draftsQuery.isError) return <ErrorState error={draftsQuery.error} onRetry={() => void draftsQuery.refetch()} />;

  const finalOutcome = lastOutcome && lastTaskKey ? outcomeByTask[lastTaskKey] : undefined;
  const outcomePanel = finalOutcome ? <ReviewOutcomePanel outcome={finalOutcome} /> : null;

  if (!active) {
    return (
      <div className="flex flex-col gap-4">
        {notice && (
          <Alert role="status">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        {outcomePanel}
        {!finalOutcome && (
          <EmptyState
            title="No drafts are waiting for review."
            action={
              <Link to="/sources" className="underline">
                Go to your sources
              </Link>
            }
          />
        )}
      </div>
    );
  }

  const position = (drafts ?? []).findIndex((d) => d.id === active.id) + 1;
  const total = drafts?.length ?? 0;
  const activeKey = active.taskId ?? active.puzzleId;
  const remaining = outcomeByTask[activeKey]?.remainingDrafts ?? (drafts ?? []).filter((d) => d.taskId === active.taskId).length;

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <Alert role="status">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {outcomePanel}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" aria-live="polite" className="text-sm font-medium">
          {`Draft ${position} of ${total}`}
        </p>
        <p className="text-sm text-muted-foreground">{plural(remaining)}</p>
      </div>

      <nav aria-label="Drafts" className="flex flex-col gap-2">
        {groups.map((group) => (
          <div key={group.taskId ?? 'none'} className="flex flex-col gap-1">
            {!taskId && <h2 className="text-sm font-semibold">{group.title}</h2>}
            <ul className="flex flex-wrap gap-2">
              {group.drafts.map(({ draft, number }) => (
                <li key={draft.id}>
                  <Button
                    type="button"
                    size="sm"
                    variant={draft.id === active.id ? 'default' : 'outline'}
                    aria-current={draft.id === active.id ? 'true' : undefined}
                    onClick={() => {
                      setActiveId(draft.id);
                      setIssues(noIssues());
                      setSavedNotice('');
                    }}
                  >
                    {`Draft ${number}`}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="grid gap-4 lg:grid-cols-2">
        <DraftForm
          key={active.id}
          draft={active}
          serverIssues={issues}
          busy={busy}
          savedNotice={savedNotice}
          onEdit={() => {
            setIssues(noIssues());
            setSavedNotice('');
          }}
          onSave={(changes) => void save(active, changes)}
          onApprove={(changes) => void approve(active, changes)}
          onReject={() => setRejecting(true)}
        />
        {active.origin === 'prompt' ? <CritiquePanel draft={active} /> : <PassagePanel draft={active} />}
      </div>

      <Dialog open={rejecting} onOpenChange={(open) => !busy && setRejecting(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this draft?</DialogTitle>
            <DialogDescription>The draft will not be used in the puzzle. A reason is optional.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <Label htmlFor="reject-reason">Reason (optional)</Label>
            <Textarea id="reject-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setRejecting(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={() => void reject(active)}>
              Reject draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
