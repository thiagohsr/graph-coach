import type { DraftQuestionDto, DraftUpdateRequest, ReviewOutcome } from '@coach/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { describeError } from '~/components/states/error-messages';
import { EmptyState } from '~/components/states/EmptyState';
import { ErrorState } from '~/components/states/ErrorState';
import { LoadingState } from '~/components/states/LoadingState';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
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

type Decision = 'approved' | 'rejected';
interface Decided {
  draft: DraftQuestionDto;
  index: number;
  status: Decision;
}
interface BatchState {
  kind: 'approve' | 'reject';
  done: number;
  total: number;
}

const snippet = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}...` : s);

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

  // Decided drafts stay in the list (greyed, with a badge) so nothing reflows under the cursor.
  const [decided, setDecided] = useState<Record<string, Decided>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [batch, setBatch] = useState<BatchState | null>(null);
  const [batchReject, setBatchReject] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const stopRef = useRef(false);

  const drafts = draftsQuery.data;
  const list = useMemo(() => {
    const out = [...(drafts ?? [])];
    const retained = Object.values(decided).sort((a, b) => a.index - b.index);
    for (const r of retained)
      if (!out.some((d) => d.id === r.draft.id))
        out.splice(Math.min(r.index, out.length), 0, r.draft);
    return out;
  }, [drafts, decided]);
  const undecided = useMemo(() => list.filter((d) => !decided[d.id]), [list, decided]);
  const active = undecided.find((d) => d.id === activeId) ?? undecided[0];
  const batchRunning = batch !== null;

  const titleByTask = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sources.data ?? [])
      if (s.taskId && s.access === 'owner') map.set(s.taskId, s.title);
    return map;
  }, [sources.data]);

  const groups = useMemo<Group[]>(() => {
    const out = new Map<string, Group>();
    list.forEach((draft, index) => {
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
  }, [list, titleByTask]);

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
    const index = list.findIndex((d) => d.id === removedId);
    const next =
      list.slice(index + 1).find((d) => !decided[d.id]) ??
      list
        .slice(0, Math.max(index, 0))
        .reverse()
        .find((d) => !decided[d.id]);
    setActiveId(next?.id ?? null);
  }

  function handleOutcome(draft: DraftQuestionDto, outcome: ReviewOutcome, status: Decision) {
    removeFromLists(draft.id);
    setDecided((prev) => ({
      ...prev,
      [draft.id]: { draft, status, index: list.findIndex((d) => d.id === draft.id) },
    }));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(draft.id);
      return next;
    });
    const key = draft.taskId ?? draft.puzzleId;
    setOutcomeByTask((prev) => ({ ...prev, [key]: outcome }));
    setLastOutcome(outcome);
    setLastTaskKey(key);
    if (outcome.puzzle.status === 'published' || outcome.remainingDrafts === 0) {
      void queryClient.invalidateQueries({ queryKey: keys.puzzles.list });
      void queryClient.invalidateQueries({ queryKey: keys.sources.list });
      if (draft.taskId)
        void queryClient.invalidateQueries({ queryKey: keys.tasks.detail(draft.taskId) });
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
      handleOutcome(draft, await approveDraft(draft.id), 'approved');
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
      handleOutcome(draft, outcome, 'rejected');
    } catch (error) {
      setRejecting(false);
      handleFailure(draft, error);
    } finally {
      setBusy(false);
    }
  }

  function failureMessage(error: unknown): string {
    if (isCode(error, 'ALREADY_DECIDED')) return 'Already decided';
    if (isApiClientError(error) && error.status === 422) {
      const issues = mapServerError(error);
      const all = [...issues.form, ...Object.values(issues.fields).flat()];
      if (all.length > 0) return all.join(' ');
    }
    return describeError(error).message;
  }

  /** Runs one decision per selected draft, one request at a time, then refreshes the lists once. */
  async function runBatch(kind: 'approve' | 'reject', why: string) {
    const targets = list.filter((d) => selected.has(d.id) && !decided[d.id]);
    if (targets.length === 0) return;
    stopRef.current = false;
    setSummary(null);
    setNotice(null);
    setFailures({});
    setBatch({ kind, done: 0, total: targets.length });
    const done: Decided[] = [];
    const failed: Record<string, string> = {};
    const lastByTask = new Map<string, ReviewOutcome>();
    let last: { outcome: ReviewOutcome; key: string } | null = null;
    let attempted = 0;
    for (const target of targets) {
      if (stopRef.current) break;
      try {
        const result =
          kind === 'approve' ? await approveDraft(target.id) : await rejectDraft(target.id, why);
        const key = target.taskId ?? target.puzzleId;
        lastByTask.set(key, result);
        last = { outcome: result, key };
        done.push({
          draft: target,
          index: list.findIndex((d) => d.id === target.id),
          status: kind === 'approve' ? 'approved' : 'rejected',
        });
      } catch (error) {
        failed[target.id] = failureMessage(error);
      }
      attempted += 1;
      setBatch({ kind, done: attempted, total: targets.length });
    }
    const ids = new Set(done.map((r) => r.draft.id));
    setDecided((prev) => {
      const next = { ...prev };
      for (const r of done) next[r.draft.id] = r;
      return next;
    });
    queryClient.setQueriesData<DraftQuestionDto[]>({ queryKey: keys.review.all }, (old) =>
      old?.filter((d) => !ids.has(d.id)),
    );
    setSelected((prev) => new Set([...prev].filter((id) => !ids.has(id))));
    setFailures(failed);
    if (last) {
      const entries = Object.fromEntries(lastByTask);
      setOutcomeByTask((prev) => ({ ...prev, ...entries }));
      setLastOutcome(last.outcome);
      setLastTaskKey(last.key);
    }
    const failCount = Object.keys(failed).length;
    const verb = kind === 'approve' ? 'approved' : 'rejected';
    const stopped = stopRef.current && attempted < targets.length;
    setSummary(
      `${done.length} ${verb}, ${failCount} failed${stopped ? `, ${targets.length - attempted} not run (stopped)` : ''}`,
    );
    setBatch(null);
    setActiveId(null);
    if (done.length > 0) {
      void queryClient.invalidateQueries({ queryKey: keys.puzzles.list });
      void queryClient.invalidateQueries({ queryKey: keys.sources.list });
      for (const taskKey of new Set(done.map((r) => r.draft.taskId).filter(Boolean) as string[]))
        void queryClient.invalidateQueries({ queryKey: keys.tasks.detail(taskKey) });
      void queryClient.invalidateQueries({ queryKey: keys.review.all });
    }
  }

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const setMany = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids)
        if (on) next.add(id);
        else next.delete(id);
      return next;
    });

  if (draftsQuery.isPending) return <LoadingState label="Loading drafts" rows={3} />;
  if (draftsQuery.isError)
    return <ErrorState error={draftsQuery.error} onRetry={() => void draftsQuery.refetch()} />;

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
        {summary && (
          <Alert role="status">
            <AlertDescription>{summary}</AlertDescription>
          </Alert>
        )}
        {outcomePanel}
        {!finalOutcome && (
          <EmptyState
            title="No drafts are waiting for review."
            action={
              <Link
                to="/sources"
                className="font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
              >
                Go to your sources
              </Link>
            }
          />
        )}
      </div>
    );
  }

  const position = undecided.findIndex((d) => d.id === active.id) + 1;
  const total = undecided.length;
  const remaining = undecided.filter((d) => d.taskId === active.taskId).length;
  const passedIds = undecided.filter((d) => d.critique?.verdict === 'pass').map((d) => d.id);
  const selectedCount = undecided.filter((d) => selected.has(d.id)).length;

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <Alert role="status">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {summary && (
        <Alert role="status">
          <AlertDescription>{summary}</AlertDescription>
        </Alert>
      )}
      {outcomePanel}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" aria-live="polite" className="text-sm font-medium">
          {`Draft ${position} of ${total}`}
        </p>
        <p className="text-sm text-muted-foreground">{plural(remaining)}</p>
      </div>

      <div className="sticky top-0 z-10 flex flex-col gap-2 rounded-md border bg-background p-2">
        {batch ? (
          <div className="flex flex-wrap items-center gap-2">
            <p role="status" aria-live="polite" className="text-sm font-medium">
              {`${batch.kind === 'approve' ? 'Approving' : 'Rejecting'} ${Math.min(batch.done + 1, batch.total)} of ${batch.total}…`}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => (stopRef.current = true)}
            >
              Stop
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={selectedCount === 0 || busy}
              onClick={() => void runBatch('approve', '')}
            >
              {`Approve ${selectedCount} selected`}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={selectedCount === 0 || busy}
              onClick={() => setBatchReject(true)}
            >
              {`Reject ${selectedCount} selected`}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setMany(
                  undecided.map((d) => d.id),
                  selectedCount !== undecided.length,
                )
              }
            >
              {selectedCount === undecided.length ? 'Clear selection' : 'Select all'}
            </Button>
            {passedIds.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setMany(passedIds, true)}
              >
                {`Select all that passed the critic (${passedIds.length})`}
              </Button>
            )}
          </div>
        )}
      </div>

      <nav aria-label="Drafts" className="flex flex-col gap-2">
        {groups.map((group) => {
          const open = group.drafts.filter(({ draft }) => !decided[draft.id]);
          const picked = open.filter(({ draft }) => selected.has(draft.id)).length;
          return (
            <div key={group.taskId ?? 'none'} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Checkbox
                  aria-label={`Select all drafts in ${group.title}`}
                  disabled={open.length === 0 || batchRunning}
                  checked={picked === 0 ? false : picked === open.length ? true : 'indeterminate'}
                  onCheckedChange={(v) =>
                    setMany(
                      open.map(({ draft }) => draft.id),
                      v === true,
                    )
                  }
                />
                {!taskId ? (
                  <h2 className="text-sm font-semibold">{group.title}</h2>
                ) : (
                  <span className="text-sm font-semibold">Select all</span>
                )}
              </div>
              <ul className="flex flex-wrap gap-2">
                {group.drafts.map(({ draft, number }) => {
                  const done = decided[draft.id];
                  const failure = failures[draft.id];
                  return (
                    <li key={draft.id} className="flex items-center gap-1">
                      <Checkbox
                        aria-label={`Select draft ${number}: ${snippet(draft.sentence)}`}
                        disabled={Boolean(done) || batchRunning}
                        checked={selected.has(draft.id)}
                        onCheckedChange={(v) => toggle(draft.id, v === true)}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant={draft.id === active.id ? 'default' : 'outline'}
                        aria-current={draft.id === active.id ? 'true' : undefined}
                        disabled={Boolean(done)}
                        className={done ? 'opacity-60' : undefined}
                        onClick={() => {
                          setActiveId(draft.id);
                          setIssues(noIssues());
                          setSavedNotice('');
                        }}
                      >
                        {`Draft ${number}`}
                      </Button>
                      {done && (
                        <Badge variant="secondary">
                          {done.status === 'approved' ? 'Approved' : 'Rejected'}
                        </Badge>
                      )}
                      {failure && (
                        <span className="text-xs text-destructive">{`Draft ${number} failed: ${failure}`}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="grid gap-4 lg:grid-cols-2">
        <DraftForm
          key={active.id}
          draft={active}
          serverIssues={issues}
          busy={busy || batchRunning}
          savedNotice={savedNotice}
          onEdit={() => {
            setIssues(noIssues());
            setSavedNotice('');
          }}
          onSave={(changes) => void save(active, changes)}
          onApprove={(changes) => void approve(active, changes)}
          onReject={() => setRejecting(true)}
        />
        {active.origin === 'prompt' ? (
          <CritiquePanel draft={active} />
        ) : (
          <PassagePanel draft={active} />
        )}
      </div>

      <Dialog
        open={rejecting || batchReject}
        onOpenChange={(open) => {
          if (busy) return;
          setRejecting(open);
          setBatchReject(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {batchReject ? `Reject ${selectedCount} selected drafts?` : 'Reject this draft?'}
            </DialogTitle>
            <DialogDescription>
              The draft will not be used in the puzzle. A reason is optional.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <Label htmlFor="reject-reason">Reason (optional)</Label>
            <Textarea
              id="reject-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setRejecting(false);
                setBatchReject(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (batchReject) {
                  const why = reason;
                  setBatchReject(false);
                  setReason('');
                  void runBatch('reject', why);
                } else void reject(active);
              }}
            >
              {batchReject ? `Reject ${selectedCount} drafts` : 'Reject draft'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
