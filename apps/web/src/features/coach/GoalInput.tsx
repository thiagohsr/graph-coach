import { useId } from 'react';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';

export const GOAL_MIN = 3;
export const GOAL_MAX = 280;

/** Why the goal cannot be sent, or `null` when it is empty (no goal) or valid (3 to 280 characters after trimming). */
export function goalProblem(value: string): string | null {
  const length = value.trim().length;
  if (length === 0) return null;
  if (length < GOAL_MIN) return `A goal needs at least ${GOAL_MIN} characters.`;
  if (length > GOAL_MAX) return `A goal can have at most ${GOAL_MAX} characters.`;
  return null;
}

/** The optional goal field of `/coach`. */
export function GoalInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const uid = useId();
  const inputId = `coach-goal-${uid}`;
  const messageId = `coach-goal-message-${uid}`;
  const problem = goalProblem(value);
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={inputId}>Goal (optional)</Label>
      <Input
        id={inputId}
        className="max-w-xl"
        autoComplete="off"
        value={value}
        aria-invalid={problem ? true : undefined}
        aria-describedby={messageId}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={messageId} className="text-sm text-destructive">
        {problem}
      </p>
    </div>
  );
}
