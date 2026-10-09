import { createContext, useContext } from 'react';
import type { Me } from '../lib/types';

export const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);

export function canWriteDoctorNoteAt(me: Me | null, facilityId: string): boolean {
  return !!me?.memberships.some(m => m.facilityId === facilityId && ['doctor', 'medical_officer'].includes(m.role));
}

export function canReviewAt(me: Me | null, facilityId: string): boolean {
  return !!me?.memberships.some(m => m.facilityId === facilityId && ['nurse', 'doctor', 'medical_officer'].includes(m.role));
}
