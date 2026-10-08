import { roleLabel } from './format';
import type { Me } from './types';

/** Most senior first. A person who holds several roles is shown with the one that carries the most responsibility. */
const RANK = ['medical_officer', 'doctor', 'nurse', 'health_worker', 'facility_admin'];

export function rolesOf(me: Me | null): string[] {
  const set = new Set((me?.memberships ?? []).map(m => m.role));
  return [...set].sort((a, b) => (RANK.indexOf(a) === -1 ? 99 : RANK.indexOf(a)) - (RANK.indexOf(b) === -1 ? 99 : RANK.indexOf(b)));
}
export const primaryRole = (me: Me | null): string | null => rolesOf(me)[0] ?? null;

/** "Seed Doctor A · Doctor". Falls back to the role alone, or to "Signed in", so the corner never sits empty. */
export function accountLabel(me: Me | null): string {
  const role = primaryRole(me); const extra = rolesOf(me).length - 1;
  const r = role ? `${roleLabel(role)}${extra > 0 ? ` +${extra}` : ''}` : null;
  return [me?.displayName, r].filter(Boolean).join(' · ') || 'Signed in';
}

/** One line per facility: "Seed PHC Khordha: Doctor". */
export function rolesByFacility(me: Me | null): { facility: string; roles: string[] }[] {
  const by = new Map<string, { facility: string; roles: string[] }>();
  for (const m of me?.memberships ?? []) {
    const e = by.get(m.facilityId) ?? { facility: m.facilityName ?? m.facilityId.slice(0, 8), roles: [] };
    e.roles.push(roleLabel(m.role)); by.set(m.facilityId, e);
  }
  return [...by.values()];
}
