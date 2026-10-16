import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { GoalInput, goalProblem } from './GoalInput';

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <GoalInput value={value} onChange={setValue} />;
}

describe('goalProblem', () => {
  it('treats empty and blank as no goal, and enforces 3 to 280 characters after trimming', () => {
    expect(goalProblem('')).toBeNull();
    expect(goalProblem('    ')).toBeNull();
    expect(goalProblem('ab')).not.toBeNull();
    expect(goalProblem('  ab  ')).not.toBeNull();
    expect(goalProblem('abc')).toBeNull();
    expect(goalProblem(`  ${'x'.repeat(280)}  `)).toBeNull();
    expect(goalProblem('x'.repeat(281))).not.toBeNull();
  });
});

describe('GoalInput', () => {
  it('has the label "Goal (optional)" and no message while empty', () => {
    render(<Harness />);
    const field = screen.getByLabelText('Goal (optional)');
    expect(field).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText(/at least 3/)).toBeNull();
  });

  it('flags a too-short goal and clears the message once it is long enough', async () => {
    render(<Harness />);
    const field = screen.getByLabelText('Goal (optional)');
    await userEvent.type(field, 'ab');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('A goal needs at least 3 characters.')).toBeInTheDocument();
    await userEvent.type(field, 'c');
    expect(field).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText(/at least 3/)).toBeNull();
  });

  it('flags a goal over 280 characters', () => {
    render(<Harness initial={'x'.repeat(281)} />);
    expect(screen.getByLabelText('Goal (optional)')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('A goal can have at most 280 characters.')).toBeInTheDocument();
  });
});
