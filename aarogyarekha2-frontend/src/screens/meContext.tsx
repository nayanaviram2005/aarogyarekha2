import { createContext, useContext } from 'react';
import type { Me } from '../lib/types';

export const MeContext = createContext<Me | null>(null);
/** The signed-in user (name, facilities, roles), or null until it has loaded. */
export const useMe = () => useContext(MeContext);

/** Can this person sign off triage at this facility? (The server enforces it too; this only decides what to show.) */
export function canReviewAt(me: Me | null, facilityId: string): boolean {
  return !!me?.memberships.some(m => m.facilityId === facilityId && ['nurse', 'doctor', 'medical_officer'].includes(m.role));
}
