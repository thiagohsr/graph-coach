import type { SourceKind } from '@coach/types';

const KIND_TEXT: Record<SourceKind, string> = { prompt: 'Prompt', text: 'Text', markdown: 'Markdown', url: 'URL' };

/** "Prompt", "Text", "Markdown", "URL" (contracts/ui-screens.md "/sources"). */
export const kindLabel = (kind: SourceKind): string => KIND_TEXT[kind];

/** "Yours" or "Shared by *ownerName*". */
export const ownerMarker = (item: { access: 'owner' | 'shared'; ownerName: string }): string =>
  item.access === 'owner' ? 'Yours' : `Shared by ${item.ownerName}`;

export const formatDate = (iso: string): string => new Date(iso).toLocaleDateString();

export const TASK_STATUS_TEXT = {
  queued: 'Queued',
  in_progress: 'Running',
  awaiting_review: 'Awaiting review',
  done: 'Done',
  failed: 'Failed',
} as const;
