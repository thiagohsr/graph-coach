/** Identical consecutive lines (e.g. several sessions with the same summary) become one line with a count. */
export function collapseRepeats(steps: string[]): { step: string; count: number }[] {
  const out: { step: string; count: number }[] = [];
  for (const step of steps) {
    const last = out[out.length - 1];
    if (last && last.step === step) last.count += 1;
    else out.push({ step, count: 1 });
  }
  return out;
}

/** The path as text: `steps`, verbatim and in order. */
export function WhyPathList({ steps, headingId }: { steps: string[]; headingId: string }) {
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-lg font-semibold">
        The same path as text
      </h2>
      <ol className="list-decimal space-y-1.5 rounded-lg border bg-card py-4 pr-5 pl-13 shadow-xs marker:font-mono marker:text-graph">
        {collapseRepeats(steps).map(({ step, count }, index) => (
          <li key={index}>{count > 1 ? `${step} (${count} times)` : step}</li>
        ))}
      </ol>
    </section>
  );
}
