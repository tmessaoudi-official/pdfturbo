import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToastQueue } from '../../src/ui/toastQueue';

function makeEl(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'toast';
  document.body.appendChild(el);
  return el;
}

describe('ToastQueue', () => {
  let el: HTMLElement;
  let q: ToastQueue;

  beforeEach(() => {
    document.body.innerHTML = '';
    el = makeEl();
    q = new ToastQueue(el);
    vi.useFakeTimers();
  });

  it('enqueue() shows message and adds severity class', () => {
    q.enqueue('Hello', 'info', 2500);
    expect(el.classList.contains('show')).toBe(true);
    expect(el.classList.contains('toast--info')).toBe(true);
    expect(el.textContent).toBe('Hello');
  });

  it('hides after duration', () => {
    q.enqueue('Hi', 'info', 2500);
    vi.advanceTimersByTime(2500);
    expect(el.classList.contains('show')).toBe(false);
    expect(el.textContent).toBe('');
  });

  it('INFO replaces current INFO immediately', () => {
    q.enqueue('First', 'info', 2500);
    q.enqueue('Second', 'info', 2500);
    expect(el.textContent).toBe('Second');
  });

  it('WARN replaces current INFO immediately', () => {
    q.enqueue('Info msg', 'info', 2500);
    q.enqueue('Warning!', 'warn', 4000);
    expect(el.textContent).toBe('Warning!');
    expect(el.classList.contains('toast--warn')).toBe(true);
  });

  it('ERROR is queued after current message, not replaced', () => {
    q.enqueue('Current', 'info', 2500);
    q.enqueue('Error occurred', 'error', 6000);
    // Current still showing
    expect(el.textContent).toBe('Current');
    // After current expires, error appears
    vi.advanceTimersByTime(2500);
    expect(el.textContent).toBe('Error occurred');
    expect(el.classList.contains('toast--error')).toBe(true);
  });

  it('clear() removes toast and empties queue', () => {
    q.enqueue('First', 'info', 2500);
    q.enqueue('Error', 'error', 6000);
    q.clear();
    expect(el.classList.contains('show')).toBe(false);
    expect(el.textContent).toBe('');
    // Advancing time should not show queued error
    vi.advanceTimersByTime(10000);
    expect(el.textContent).toBe('');
  });

  it('severity class is replaced between messages', () => {
    q.enqueue('Info', 'info', 2500);
    expect(el.classList.contains('toast--info')).toBe(true);
    q.enqueue('Warn', 'warn', 2500);
    expect(el.classList.contains('toast--warn')).toBe(true);
    expect(el.classList.contains('toast--info')).toBe(false);
  });

  it('multiple errors are dequeued in order', () => {
    q.enqueue('Error 1', 'error', 1000);
    q.enqueue('Error 2', 'error', 1000);
    expect(el.textContent).toBe('Error 1');
    vi.advanceTimersByTime(1000);
    expect(el.textContent).toBe('Error 2');
    vi.advanceTimersByTime(1000);
    expect(el.classList.contains('show')).toBe(false);
  });
});
