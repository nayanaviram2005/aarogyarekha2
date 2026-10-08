// Who is signed in: their own name and their own facility roles, and nothing else.
//
// Why this exists. Row-level security lets a person SEE some other people's rows: colleagues' profiles (so reviewers' names show), and,
// for a facility administrator, every membership at their facility. Reading "the profile" and "the memberships" without asking for
// THIS user's rows therefore returned several profiles (an error, so a doctor's screen loaded with no role and every action looked
// forbidden) and, for an administrator, the roles of their staff (so an administrator looked like a doctor). Every role check in the
// API and the screens is built on this result, so it must be exactly the caller's own.
import type { Me } from '../deps.js';

export interface ProfileRow { user_id?: string | null; display_name?: string | null }
export interface MembershipRow { user_id?: string | null; facility_id: string; role: string; is_active?: boolean | null; facility?: { name?: string | null; type?: string | null } | null }

/** @param userId the verified id of the caller (never taken from the request body) */
export function shapeMe(userId: string, profiles: ProfileRow[], memberships: MembershipRow[]): Me {
  const mine = profiles.find(p => p.user_id === userId) ?? (profiles.length === 1 && !profiles[0]!.user_id ? profiles[0] : undefined);
  const seen = new Set<string>(); const out: Me['memberships'] = [];
  for (const m of memberships) {
    if (m.user_id !== userId || m.is_active === false) continue;
    const key = `${m.facility_id}:${m.role}`; if (seen.has(key)) continue; seen.add(key);
    out.push({ facilityId: m.facility_id, facilityName: m.facility?.name ?? null, facilityType: m.facility?.type ?? null, role: m.role });
  }
  return { displayName: mine?.display_name ?? null, memberships: out };
}
