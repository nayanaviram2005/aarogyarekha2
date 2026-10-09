import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MISSES_BEFORE_OFFLINE, PING_OK_MS, PING_RETRY_MS, PING_TIMEOUT_MS, useApiHealth } from './useApiHealth';
import type { Api } from './types';

const api = (health: () => Promise<boolean>) => ({ health }) as unknown as Api;
const hook = (h: () => Promise<boolean>) => { const a = api(h); return renderHook(() => useApiHealth(a)); };
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useApiHealth', () => {
  it('starts as connecting and becomes online on the first good answer', async () => {
    const { result } = hook(async () => true);
    expect(result.current).toBe('connecting'); await flush(); expect(result.current).toBe('online');
  });
  it('one miss is only "connecting"; offline needs two in a row, and a good answer clears it', async () => {
    const answers = [false, false, true]; const health = vi.fn(async () => answers.shift() ?? true);
    const { result } = hook(health);
    await flush(); expect(result.current).toBe('connecting');
    await flush(PING_RETRY_MS); expect(MISSES_BEFORE_OFFLINE).toBe(2); expect(result.current).toBe('offline');
    await flush(PING_RETRY_MS); expect(result.current).toBe('online');
  });
  it('looks again quickly after a miss and slowly when all is well', async () => {
    const health = vi.fn(async () => true); hook(health);
    await flush(); expect(health).toHaveBeenCalledTimes(1);
    await flush(PING_OK_MS - 1); expect(health).toHaveBeenCalledTimes(1); await flush(1); expect(health).toHaveBeenCalledTimes(2);
  });
  it('counts a check that hangs as a miss, and a thrown error too', async () => {
    const { result } = hook(() => new Promise<boolean>(() => {}));
    await flush(PING_TIMEOUT_MS); expect(result.current).toBe('connecting');
    const bad = hook(async () => { throw new Error('x'); }); await flush(); expect(bad.result.current).toBe('connecting');
  });
  it('checks again at once when the browser regains its connection', async () => {
    const health = vi.fn(async () => true); hook(health); await flush();
    act(() => { window.dispatchEvent(new Event('online')); }); await flush(); expect(health).toHaveBeenCalledTimes(2);
  });
  it('does nothing without an api, and stops checking when it unmounts', async () => {
    const none = renderHook(() => useApiHealth(null)); await flush(PING_OK_MS); expect(none.result.current).toBe('connecting');
    const health = vi.fn(async () => true); const r = hook(health); await flush(); r.unmount(); await flush(PING_OK_MS * 3); expect(health).toHaveBeenCalledTimes(1);
  });
});
