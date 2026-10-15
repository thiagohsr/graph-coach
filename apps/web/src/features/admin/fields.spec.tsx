import type { AdminFieldMeta } from '@coach/types';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FieldControl, parseFormValue, toFormValue } from './fields';

const field = (over: Partial<AdminFieldMeta> & Pick<AdminFieldMeta, 'type'>): AdminFieldMeta => ({
  name: 'thing',
  label: 'Thing',
  required: false,
  readonly: false,
  computed: false,
  ...over,
});

function renderField(f: AdminFieldMeta, value: string | boolean, editable = true) {
  const onChange = vi.fn();
  render(<FieldControl field={f} value={value} editable={editable} onChange={onChange} />);
  return onChange;
}

describe('FieldControl', () => {
  it('string -> text input', () => {
    renderField(field({ type: 'string' }), 'abc');
    expect(screen.getByRole('textbox', { name: 'Thing' })).toHaveValue('abc');
  });

  it('text -> textarea', () => {
    renderField(field({ type: 'text' }), 'long');
    const box = screen.getByRole('textbox', { name: 'Thing' });
    expect(box.tagName).toBe('TEXTAREA');
  });

  it('integer and number -> number input with bounds', () => {
    renderField(field({ type: 'integer', min: 1, max: 9 }), '4');
    const input = screen.getByRole('spinbutton', { name: 'Thing' });
    expect(input).toHaveAttribute('min', '1');
    expect(input).toHaveAttribute('max', '9');
    expect(input).toHaveAttribute('step', '1');
  });

  it('boolean -> checkbox', async () => {
    const onChange = renderField(field({ type: 'boolean' }), false);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Thing' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('enum -> select with its choices', async () => {
    const onChange = renderField(field({ type: 'enum', choices: ['learner', 'admin'], required: true }), 'learner');
    const select = screen.getByRole('combobox', { name: /Thing/ });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['learner', 'admin']);
    await userEvent.selectOptions(select, 'admin');
    expect(onChange).toHaveBeenCalledWith('admin');
  });

  it('list -> one item per line, sent as an array', () => {
    renderField(field({ type: 'list' }), toFormValue(field({ type: 'list' }), ['x', 'y']));
    expect(screen.getByRole('textbox', { name: 'Thing' })).toHaveValue('x\ny');
    expect(parseFormValue(field({ type: 'list' }), 'x\n\n y \n')).toEqual({ ok: true, value: ['x', 'y'] });
  });

  it('json -> parsed before sending; invalid JSON is refused', () => {
    const f = field({ type: 'json' });
    expect(parseFormValue(f, '{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseFormValue(f, '{oops')).toEqual({ ok: false, message: 'Must be valid JSON.' });
    expect(toFormValue(f, { a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it('datetime -> formatted text, never an input', () => {
    renderField(field({ type: 'datetime', readonly: true }), '2026-10-11T09:00:00.000Z', false);
    expect(screen.getByText('2026-10-11 09:00 UTC')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    // Even when the caller says editable, a datetime has no input.
    render(<FieldControl field={field({ type: 'datetime', name: 'other' })} value="2026-10-11T09:00:00.000Z" editable onChange={() => {}} />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('an unknown type renders read-only text', () => {
    const f = field({ type: 'geometry' as never });
    render(<FieldControl field={f} value="POINT(1 2)" editable={true} onChange={() => {}} />);
    expect(screen.getByText('POINT(1 2)')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('a readonly field renders text and no input', () => {
    renderField(field({ type: 'string', readonly: true }), 'fixed', false);
    expect(screen.getByText('fixed')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('a null value renders empty without error', () => {
    const f = field({ type: 'string' });
    renderField(f, toFormValue(f, null));
    expect(screen.getByRole('textbox', { name: 'Thing' })).toHaveValue('');
    expect(toFormValue(field({ type: 'boolean' }), null)).toBe(false);
  });

  it('shows an error under the control', () => {
    render(<FieldControl field={field({ type: 'string' })} value="" editable onChange={() => {}} error="Bad." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Bad.');
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('parseFormValue', () => {
  it('refuses an out-of-range number and a non-integer', () => {
    const f = field({ type: 'integer', min: 0, max: 1000 });
    expect(parseFormValue(f, '1001')).toEqual({ ok: false, message: 'Must be between 0 and 1000.' });
    expect(parseFormValue(f, '1.5')).toEqual({ ok: false, message: 'Must be a whole number.' });
    expect(parseFormValue(f, '12')).toEqual({ ok: true, value: 12 });
    expect(parseFormValue(f, '')).toEqual({ ok: true, value: null });
  });
});
