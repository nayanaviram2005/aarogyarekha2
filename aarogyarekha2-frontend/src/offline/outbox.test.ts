import { describe, expect, it } from 'vitest';
import { createOutbox, MAX_AGE_MS, memoryStore } from './outbox';

const note = { name: 'Meera Das', age: '28', complaint: 'bukhar' };

describe('outbox', () => {
  it('round-trips a note', async () => {
    const o = createOutbox(memoryStore()); await o.put('a', note);
    expect(await o.list()).toMatchObject([{ id: 'a', data: note }]);
  });
  it('what is on disk is encrypted: no readable name or complaint anywhere in the stored value', async () => {
    const s = memoryStore(); await createOutbox(s).put('a', note);
    const raw = (await s.get('note:a')) as { iv: ArrayBuffer; ct: ArrayBuffer };
    const text = new TextDecoder('latin1').decode(raw.ct);
    expect(text).not.toContain('Meera'); expect(text).not.toContain('bukhar');
    expect(Object.keys(raw).sort()).toEqual(['ct', 'iv', 'savedAt']);
  });
  it('the key is created as non-extractable', async () => {
    const s = memoryStore(); await createOutbox(s).put('a', note);
    const k = (await s.get('key')) as CryptoKey;
    expect(k.extractable).toBe(false); await expect(crypto.subtle.exportKey('raw', k)).rejects.toThrow();
  });
  it('the same note encrypts differently each time (fresh random IV)', async () => {
    const s = memoryStore(); const o = createOutbox(s); await o.put('a', note); await o.put('b', note);
    const a = (await s.get('note:a')) as { iv: ArrayBuffer }; const b = (await s.get('note:b')) as { iv: ArrayBuffer };
    expect(new Uint8Array(a.iv)).not.toEqual(new Uint8Array(b.iv));
  });
  it('lists oldest first', async () => {
    let t = 1000; const o = createOutbox(memoryStore(), () => t);
    await o.put('late', note); t = 500; await o.put('early', note); t = 1500;
    expect((await o.list()).map(n => n.id)).toEqual(['early', 'late']);
  });
  it('removes one note', async () => {
    const o = createOutbox(memoryStore()); await o.put('a', note); await o.put('b', note); await o.remove('a');
    expect((await o.list()).map(n => n.id)).toEqual(['b']);
  });
  it('deletes notes older than 24 hours, for real, when listing', async () => {
    let t = 0; const s = memoryStore(); const o = createOutbox(s, () => t);
    await o.put('old', note); t = MAX_AGE_MS - 1; await o.put('fresh', note); t = MAX_AGE_MS + 1;
    expect((await o.list()).map(n => n.id)).toEqual(['fresh']);
    expect(await s.get('note:old')).toBeUndefined();
  });
  it('a note that cannot be decrypted (key replaced) is deleted and never returned', async () => {
    const s = memoryStore(); await createOutbox(s).put('a', note);
    await s.set('key', await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
    expect(await createOutbox(s).list()).toEqual([]); expect(await s.get('note:a')).toBeUndefined();
  });
  it('a tampered note is deleted and never returned', async () => {
    const s = memoryStore(); await createOutbox(s).put('a', note);
    const raw = (await s.get('note:a')) as { iv: ArrayBuffer; ct: ArrayBuffer; savedAt: number };
    const bytes = new Uint8Array(raw.ct.slice(0)); bytes[0] = bytes[0]! ^ 0xff; await s.set('note:a', { ...raw, ct: bytes.buffer });
    expect(await createOutbox(s).list()).toEqual([]);
  });
  it('notes with no key at all (key was lost) are discarded', async () => {
    const s = memoryStore(); await createOutbox(s).put('a', note); await s.del('key');
    expect(await createOutbox(s).list()).toEqual([]); expect(await s.get('note:a')).toBeUndefined();
  });
  it('wipe removes every note and the key', async () => {
    const s = memoryStore(); const o = createOutbox(s); await o.put('a', note); await o.put('b', note); await o.wipe();
    expect(await s.keys()).toEqual([]);
  });
  it('an empty outbox lists nothing without making a key', async () => {
    const s = memoryStore(); expect(await createOutbox(s).list()).toEqual([]); expect(await s.keys()).toEqual([]);
  });
});
