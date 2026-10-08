// Reads the sign-in assurance level from a Supabase access token. Call ONLY after the token was verified with the auth server
// (verifyToken does). aal2 means the user also passed a second factor (authenticator app) in this session.
export type Aal = 'aal1' | 'aal2';

export function aalOf(token: string): Aal {
  try {
    const part = token.split('.')[1];
    if (!part) return 'aal1';
    const claims = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { aal?: unknown };
    return claims.aal === 'aal2' ? 'aal2' : 'aal1';
  } catch { return 'aal1'; }
}
