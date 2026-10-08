// A consent counts only if it has not been revoked and has not expired. Pure, so it can be tested without a database.
export interface ConsentRow { revoked_at: string | null; expires_at: string | null; granted_at?: string | null }

export function isConsentActive(rows: ConsentRow[], now: Date = new Date()): boolean {
  return rows.some(r => {
    if (r.revoked_at) return false;
    if (r.expires_at && Date.parse(r.expires_at) <= now.getTime()) return false;
    if (r.granted_at && Date.parse(r.granted_at) > now.getTime()) return false;   // not yet in force
    return true;
  });
}
