/**
 * Offline outbox: notes taken while the connection is down, kept on this device until they can be sent.
 *
 * What it protects, honestly:
 *   * every note is encrypted (AES-GCM) before it touches the disk, with a key the browser will not let a script read out,
 *   * notes older than 24 hours are deleted, and "Discard" deletes at once,
 *   * nothing is sent anywhere from here: sending is a separate, signed-in step.
 * What it does NOT protect against: someone using the same browser profile on the same computer, or malware in it. The key
 * lives in the same browser. On a shared computer, give each person their own computer login.
 */
export const MAX_AGE_MS = 24 * 3_600_000;

export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface Note { id: string; savedAt: number; data: Record<string, unknown> }
interface Sealed { iv: ArrayBuffer; ct: ArrayBuffer; savedAt: number }

const KEY_NAME = 'key';
const NOTE_PREFIX = 'note:';

/** In-memory store for tests and for browsers without IndexedDB. Nothing survives a reload. */
export function memoryStore(): KeyValueStore {
  const m = new Map<string, unknown>();
  return { get: async k => m.get(k), set: async (k, v) => { m.set(k, v); }, del: async k => { m.delete(k); }, keys: async () => [...m.keys()] };
}

/** IndexedDB-backed store. Values may be CryptoKeys, which IndexedDB can hold without exposing their bytes. */
export function idbStore(dbName = 'aarogyarekha-offline'): KeyValueStore {
  const open = () => new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(dbName, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const run = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((res, rej) => { const tx = db.transaction('kv', mode); const r = f(tx.objectStore('kv')); tx.oncomplete = () => { db.close(); res(r.result); }; tx.onerror = () => { db.close(); rej(tx.error); }; });
  };
  return {
    get: k => run('readonly', s => s.get(k)),
    set: async (k, v) => { await run('readwrite', s => s.put(v, k)); },
    del: async k => { await run('readwrite', s => s.delete(k)); },
    keys: async () => (await run('readonly', s => s.getAllKeys())).map(String),
  };
}

export const outboxAvailable = (): boolean => typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && !!crypto.subtle;

export function createOutbox(store: KeyValueStore, now: () => number = Date.now) {
  async function key(create: boolean): Promise<CryptoKey | null> {
    const have = (await store.get(KEY_NAME)) as CryptoKey | undefined;
    if (have) return have;
    if (!create) return null;
    const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);   // false = cannot be exported
    await store.set(KEY_NAME, k);
    return k;
  }

  async function open(s: Sealed, k: CryptoKey): Promise<Record<string, unknown> | null> {
    try { return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: s.iv }, k, s.ct))) as Record<string, unknown>; }
    catch { return null; }                                     // wrong key or tampered: treat as unreadable, never as data
  }

  return {
    async put(id: string, data: Record<string, unknown>): Promise<void> {
      const k = (await key(true))!; const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify(data)));
      await store.set(NOTE_PREFIX + id, { iv: iv.buffer, ct, savedAt: now() } satisfies Sealed);
    },
    /** Readable notes, oldest first. Notes past 24 hours or that cannot be decrypted are deleted on the way. */
    async list(): Promise<Note[]> {
      const k = await key(false); const out: Note[] = [];
      for (const full of (await store.keys()).filter(x => x.startsWith(NOTE_PREFIX))) {
        const s = (await store.get(full)) as Sealed | undefined; const id = full.slice(NOTE_PREFIX.length);
        if (!s || !k || now() - s.savedAt > MAX_AGE_MS) { await store.del(full); continue; }
        const data = await open(s, k);
        if (!data) { await store.del(full); continue; }
        out.push({ id, savedAt: s.savedAt, data });
      }
      return out.sort((a, b) => a.savedAt - b.savedAt);
    },
    async remove(id: string): Promise<void> { await store.del(NOTE_PREFIX + id); },
    /** Deletes every note and the key. */
    async wipe(): Promise<void> { for (const k of await store.keys()) await store.del(k); },
  };
}
export type Outbox = ReturnType<typeof createOutbox>;
