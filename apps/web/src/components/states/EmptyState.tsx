import type { ReactNode } from 'react';

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-input bg-card p-6">
      <svg width="48" height="32" viewBox="0 0 48 32" aria-hidden="true" className="mb-1">
        <path d="M8 24 L24 8 L40 22" className="stroke-border" strokeWidth="1.5" fill="none" />
        <circle cx="8" cy="24" r="4" className="fill-card stroke-input" strokeWidth="1.5" />
        <circle cx="24" cy="8" r="5" className="fill-graph-soft stroke-graph" strokeWidth="1.5" />
        <circle cx="40" cy="22" r="4" className="fill-card stroke-input" strokeWidth="1.5" />
      </svg>
      <h2 className="font-semibold">{title}</h2>
      {children && <div className="text-sm text-muted-foreground">{children}</div>}
      {action}
    </div>
  );
}
