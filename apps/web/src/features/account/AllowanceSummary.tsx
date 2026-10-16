import type { AllowanceDto, CreationKind } from '@coach/types';
import { hourlyState } from '~/features/create/allowance';

const ROWS: { kind: CreationKind; label: string }[] = [
  { kind: 'prompt', label: 'Prompt puzzles' },
  { kind: 'upload', label: 'Uploads' },
];

/** The "This month" table, the hour line, and the paused notice. Always two rows (no empty state). */
export function AllowanceSummary({ allowance, now = new Date() }: { allowance: AllowanceDto; now?: Date }) {
  const hour = hourlyState(allowance, now);
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="mb-2 text-left text-lg font-semibold">This month</caption>
          <thead>
            <tr>
              <th scope="col" className="py-1 pr-4">
                Kind
              </th>
              <th scope="col" className="py-1 pr-4">
                Used
              </th>
              <th scope="col" className="py-1 pr-4">
                Allowance
              </th>
              <th scope="col" className="py-1 pr-4">
                Bonus runs
              </th>
              <th scope="col" className="py-1">
                Resets on
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(({ kind, label }) => {
              const k = allowance[kind];
              return (
                <tr key={kind} className="border-t">
                  <th scope="row" className="py-2 pr-4 font-medium">
                    {label}
                  </th>
                  {k.allowance === null ? (
                    <td colSpan={3} className="py-2 pr-4">
                      Unlimited
                    </td>
                  ) : (
                    <>
                      <td className="py-2 pr-4">{k.used}</td>
                      <td className="py-2 pr-4">{k.allowance}</td>
                      <td className="py-2 pr-4">{k.bonus}</td>
                    </>
                  )}
                  <td className="py-2">{new Date(k.resetsAt).toLocaleDateString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-sm">{hour.text}</p>
      {!allowance.creationEnabled && <p className="text-sm font-medium">Puzzle creation is paused.</p>}
    </div>
  );
}
