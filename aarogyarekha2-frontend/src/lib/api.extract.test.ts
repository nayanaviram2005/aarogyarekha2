import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from './api';

const res = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const make = (script: (url: string, init?: RequestInit) => Promise<Response>) => { const f = vi.fn(script); return { f, api: createApi('http://api', async () => 'tok', f as never, async () => {}) }; };

describe('extractDocument (background job)', () => {
  it('starts the job, checks back until done, then returns the rows', async () => {
    let polls = 0;
    const { api, f } = make(async (url, init) => {
      if (url.endsWith('/extract?async=1')) { expect(init?.method).toBe('POST'); return res(202, { jobId: 'j1', status: 'queued' }); }
      if (url.endsWith('/jobs/j1')) return res(200, { status: ++polls < 3 ? 'running' : 'done', error: null });
      if (url.endsWith('/documents/d1/extraction')) return res(200, { extraction: { id: 'x1', fields: [] } });
      return res(404, {});
    });
    expect(await api.extractDocument('d1', 'hi')).toEqual({ id: 'x1', fields: [] }); expect(polls).toBe(3);
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toEqual({ language: 'hi' });
  });
  it('a finished job that carries a reason (for example a scanned PDF) is shown as that plain message', async () => {
    const { api } = make(async url => (url.includes('extract') ? res(202, { jobId: 'j' }) : res(200, { status: 'done', error: 'This PDF is a scan with no text in it. Upload a clear photo of each page instead.' })));
    await expect(api.extractDocument('d')).rejects.toMatchObject({ status: 422, message: expect.stringContaining('photo') });
  });
  it('a failed job, a refused start and a lost job are all plain ApiErrors', async () => {
    await expect(make(async url => (url.includes('extract') ? res(202, { jobId: 'j' }) : res(200, { status: 'failed', error: 'This took too long.' }))).api.extractDocument('d')).rejects.toMatchObject({ status: 422, message: 'This took too long.' });
    await expect(make(async () => res(429, { error: 'Too many reports are waiting to be read. Wait a minute and try again.' })).api.extractDocument('d')).rejects.toMatchObject({ status: 429 });
    await expect(make(async url => (url.includes('extract') ? res(202, { jobId: 'j' }) : res(404, { issue: [{ details: { text: 'No such job. It may have finished long ago, or the server restarted. Start it again.' } }] }))).api.extractDocument('d')).rejects.toMatchObject({ status: 404, message: expect.stringContaining('server restarted') });
  });
  it('no job id from the server, or the network down, are plain errors; not signed in is 401', async () => {
    await expect(make(async () => res(202, {})).api.extractDocument('d')).rejects.toBeInstanceOf(ApiError);
    await expect(make(async () => { throw new Error('offline'); }).api.extractDocument('d')).rejects.toMatchObject({ status: 0 });
    await expect(createApi('http://api', async () => null, vi.fn() as never).extractDocument('d')).rejects.toMatchObject({ status: 401 });
  });
  it('gives up after about three minutes of waiting', async () => {
    let n = 0; const { api } = make(async url => (url.includes('extract') ? res(202, { jobId: 'j' }) : (n++, res(200, { status: 'running', error: null }))));
    await expect(api.extractDocument('d')).rejects.toMatchObject({ status: 504 }); expect(n).toBe(180);
  });
});
