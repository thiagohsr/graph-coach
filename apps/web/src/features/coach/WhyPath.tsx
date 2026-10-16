import type { DecisionPathDto } from '@coach/types';
import { Component, lazy, Suspense, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Skeleton } from '~/components/ui/skeleton';
import { WhyPathList } from './WhyPathList';
import { buildWhyPath, type Orientation } from './why-path';

// The graph code is loaded on demand; the text list never waits for it (contracts/ui-screens.md "/decisions/:id").
const WhyPathGraph = lazy(() => import('./WhyPathGraph'));

const NARROW = '(max-width: 639px)';
function subscribe(cb: () => void) {
  const media = window.matchMedia(NARROW);
  media.addEventListener('change', cb);
  return () => media.removeEventListener('change', cb);
}
function useOrientation(): Orientation {
  const narrow = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
  return narrow ? 'TB' : 'LR';
}

class GraphBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed) {
      return (
        <Alert variant="warning">
          <AlertDescription>The graph is unavailable. The path is shown as text above.</AlertDescription>
        </Alert>
      );
    }
    return this.props.children;
  }
}

const LIST_HEADING_ID = 'why-path-list-heading';

/** One response object, two renderings: the ordered text list first, then the graph. */
export function WhyPath({ path }: { path: DecisionPathDto }) {
  const orientation = useOrientation();
  const model = useMemo(() => buildWhyPath(path, orientation), [path, orientation]);

  if (model.isEmpty) {
    return (
      <Alert variant="destructive">
        <AlertDescription>No evidence was stored for this decision.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <WhyPathList steps={model.steps} headingId={LIST_HEADING_ID} />
      {model.droppedEdges > 0 && (
        <p className="text-sm text-muted-foreground">
          {model.droppedEdges} {model.droppedEdges === 1 ? 'link' : 'links'} could not be drawn.
        </p>
      )}
      <div role="region" aria-label="Decision path graph" aria-describedby={LIST_HEADING_ID}>
        <GraphBoundary>
          <Suspense fallback={<Skeleton className="h-[420px] w-full" aria-label="Loading graph" />}>
            <WhyPathGraph model={model} orientation={orientation} />
          </Suspense>
        </GraphBoundary>
      </div>
    </div>
  );
}
