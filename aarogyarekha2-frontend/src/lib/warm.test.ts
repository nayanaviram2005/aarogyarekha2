import { describe, expect, it, vi } from 'vitest';
import { warmApi } from './warm';

describe('waking the API', () => {
  it('sends one plain request to the health address, with no credentials and no body', () => {
    const f = vi.fn().mockResolvedValue({});
    warmApi('https://api.example.org/', f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://api.example.org/health');
    expect(init).toMatchObject({ method: 'GET', mode: 'no-cors', credentials: 'omit' });
    expect(init).not.toHaveProperty('body'); expect(init).not.toHaveProperty('headers');
  });
  it('never throws, even when the server is asleep or the request fails', async () => {
    expect(() => warmApi('https://x.example', vi.fn().mockRejectedValue(new Error('down')) as unknown as typeof fetch)).not.toThrow();
    expect(() => warmApi('https://x.example', (() => { throw new Error('blocked'); }) as unknown as typeof fetch)).not.toThrow();
    await Promise.resolve();
  });
  it('does not reach the network in tests unless a fetch is handed in', () => {
    const real = vi.spyOn(globalThis, 'fetch').mockResolvedValue({} as Response);
    warmApi('https://x.example'); expect(real).not.toHaveBeenCalled(); real.mockRestore();
  });
});
