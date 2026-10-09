export function warmApi(baseUrl: string, fetchImpl: typeof fetch = fetch): void {
  if (import.meta.env.MODE === 'test' && fetchImpl === fetch) return;
  try {
    void fetchImpl(`${baseUrl.replace(/\/+$/, '')}/health`, { method: 'GET', mode: 'no-cors', cache: 'no-store', credentials: 'omit', keepalive: true }).catch(() => { });
  } catch { }
}
