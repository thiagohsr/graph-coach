import type { ReactNode } from 'react';

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-6">
      <h2 className="font-semibold">{title}</h2>
      {children && <div className="text-sm text-muted-foreground">{children}</div>}
      {action}
    </div>
  );
}
