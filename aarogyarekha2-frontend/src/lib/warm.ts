/**
 * Wakes a sleeping API. A free host puts a server to sleep after a while with no requests, and the first request then waits about a minute.
 * This sends one throwaway request to the health address as soon as the landing or sign-in page opens, so the server is waking while the
 * person types, and is ready by the time they have signed in. The answer is ignored and nothing is sent in it.
 */
export function warmApi(baseUrl: string, fetchImpl: typeof fetch = fetch): void {
  if (import.meta.env.MODE === 'test' && fetchImpl === fetch) return;      // tests never touch the network unless they hand in their own fetch
  try {
    void fetchImpl(`${baseUrl.replace(/\/+$/, '')}/health`, { method: 'GET', mode: 'no-cors', cache: 'no-store', credentials: 'omit', keepalive: true }).catch(() => { /* a sleeping or absent server is not an error here */ });
  } catch { /* fetch missing or blocked: nothing to do */ }
}
