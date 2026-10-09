import type { Me } from '../deps.js';

export interface ProfileRow { user_id?: string | null; display_name?: string | null }
export interface MembershipRow { user_id?: string | null; facility_id: string; role: string; is_active?: boolean | null; facility?: { name?: string | null; type?: string | null } | null }

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
