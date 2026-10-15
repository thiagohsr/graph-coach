/** The path as text: `steps`, verbatim and in order. */
export function WhyPathList({ steps, headingId }: { steps: string[]; headingId: string }) {
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-lg font-semibold">
        The same path as text
      </h2>
      <ol className="list-decimal space-y-1 pl-6">
        {steps.map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>
    </section>
  );
}
