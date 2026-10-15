/**
 * A polite live region. Giving it a new `seq` replaces the text node's container, which makes screen
 * readers announce the same message again.
 */
export function LiveRegion({ message, seq = 0 }: { message: string; seq?: number }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      <span key={seq}>{message}</span>
    </div>
  );
}
