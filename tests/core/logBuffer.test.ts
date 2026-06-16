import { describe, it, expect, beforeEach } from 'vitest';
import { LogBuffer } from '../../src/core/logBuffer';

describe('LogBuffer', () => {
  let log: LogBuffer;

  beforeEach(() => {
    log = new LogBuffer(3); // small capacity to exercise eviction
  });

  it('records level + message + a numeric timestamp', () => {
    log.record('info', 'toast.copied');
    const entries = log.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe('info');
    expect(entries[0]?.message).toBe('toast.copied');
    expect(typeof entries[0]?.ts).toBe('number');
    expect(entries[0]?.ts).toBeGreaterThan(0);
  });

  it('derives detail from an Error (name + message), not the whole object', () => {
    log.record('error', 'toast.exportFailed', new Error('boom'));
    expect(log.entries()[0]?.detail).toBe('Error: boom');
  });

  it('keeps a string detail as-is and omits detail when none given', () => {
    log.record('silent', 'session-restore', 'context string');
    log.record('warn', 'toast.ocrNoText');
    const e = log.entries();
    expect(e[0]?.detail).toBe('context string');
    expect(e[1]?.detail).toBeUndefined();
  });

  it('is a bounded ring buffer — oldest entries are evicted past capacity', () => {
    log.record('info', 'a');
    log.record('info', 'b');
    log.record('info', 'c');
    log.record('info', 'd'); // evicts 'a'
    const msgs = log.entries().map(e => e.message);
    expect(msgs).toEqual(['b', 'c', 'd']);
  });

  it('returns entries oldest-first and a defensive copy (mutation does not affect the buffer)', () => {
    log.record('info', 'a');
    const snapshot = log.entries() as unknown[];
    snapshot.push({ level: 'info', message: 'x', ts: 0 });
    expect(log.entries()).toHaveLength(1);
  });

  it('clear() empties the buffer', () => {
    log.record('info', 'a');
    log.clear();
    expect(log.entries()).toHaveLength(0);
  });

  it('truncates very long string details', () => {
    const huge = 'x'.repeat(5000);
    log.record('error', 'toast.exportFailed', huge);
    const detail = log.entries()[0]?.detail ?? '';
    expect(detail.length).toBeLessThanOrEqual(600);
  });
});
