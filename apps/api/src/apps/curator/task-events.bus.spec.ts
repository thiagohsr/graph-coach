import { describe, expect, it, vi } from 'vitest';
import { TaskEventBus, type TaskBusEvent } from './task-events.bus';

const event = (id: string): TaskBusEvent => ({ id, node: 'chunk', status: 'active' });

describe('TaskEventBus', () => {
  it('delivers events to the listeners of a task in publication order', () => {
    const bus = new TaskEventBus();
    const seen: string[] = [];
    bus.subscribe('t1', (e) => seen.push(e.id));
    for (const id of ['1:a', '1:z', '2:a']) bus.publish('t1', event(id));
    expect(seen).toEqual(['1:a', '1:z', '2:a']);
  });

  it('keeps tasks apart', () => {
    const bus = new TaskEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe('a', a);
    bus.subscribe('b', b);
    bus.publish('a', event('1:a'));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe and forgets the task when nobody listens', () => {
    const bus = new TaskEventBus();
    const listener = vi.fn();
    const off = bus.subscribe('t1', listener);
    bus.publish('t1', event('1:a'));
    off();
    off();
    bus.publish('t1', event('1:z'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount('t1')).toBe(0);
  });

  it('serves several listeners and survives one that throws', () => {
    const bus = new TaskEventBus();
    const second = vi.fn();
    bus.subscribe('t1', () => {
      throw new Error('closed socket');
    });
    bus.subscribe('t1', second);
    expect(() => bus.publish('t1', event('1:a'))).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('holds no history: a late subscriber sees only later events', () => {
    const bus = new TaskEventBus();
    bus.publish('t1', event('1:a'));
    const late = vi.fn();
    bus.subscribe('t1', late);
    expect(late).not.toHaveBeenCalled();
  });

  it('a listener that unsubscribes while being called does not break the others', () => {
    const bus = new TaskEventBus();
    const calls: string[] = [];
    let off: () => void = () => undefined;
    off = bus.subscribe('t1', () => {
      calls.push('first');
      off();
    });
    bus.subscribe('t1', () => calls.push('second'));
    bus.publish('t1', event('1:a'));
    bus.publish('t1', event('1:z'));
    expect(calls).toEqual(['first', 'second', 'second']);
  });
});
