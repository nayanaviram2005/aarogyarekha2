import { describe, expect, it } from 'vitest';
import { shapeMe } from '../src/auth/me.js';
import { buildApp } from '../src/app.js';
import type { Deps, UserReader } from '../src/deps.js';

const F1 = 'f1', F2 = 'f2';
const fac = (name: string) => ({ name, type: 'phc' });

describe('shapeMe: exactly the caller\'s own name and roles', () => {
  it('a doctor who can also SEE colleagues\' profiles gets their own name, not an error', () => {
    const me = shapeMe('doc', [{ user_id: 'nurse', display_name: 'Nurse N' }, { user_id: 'doc', display_name: 'Dr. D' }, { user_id: 'admin', display_name: 'Admin A' }], [{ user_id: 'doc', facility_id: F1, role: 'doctor', facility: fac('PHC') }]);
    expect(me).toEqual({ displayName: 'Dr. D', memberships: [{ facilityId: F1, facilityName: 'PHC', facilityType: 'phc', role: 'doctor' }] });
  });
  it('a facility administrator who can SEE every membership at the facility does not inherit their staff\'s roles', () => {
    const rows = [
      { user_id: 'admin', facility_id: F1, role: 'facility_admin' }, { user_id: 'doc', facility_id: F1, role: 'doctor' },
      { user_id: 'nurse', facility_id: F1, role: 'nurse' }, { user_id: 'hw', facility_id: F1, role: 'health_worker' },
    ];
    expect(shapeMe('admin', [], rows).memberships.map(m => m.role)).toEqual(['facility_admin']);
  });
  it('a deactivated role is not a role, and the same role twice is listed once', () => {
    const me = shapeMe('u', [], [{ user_id: 'u', facility_id: F1, role: 'nurse', is_active: false }, { user_id: 'u', facility_id: F2, role: 'doctor' }, { user_id: 'u', facility_id: F2, role: 'doctor' }]);
    expect(me.memberships).toEqual([{ facilityId: F2, facilityName: null, facilityType: null, role: 'doctor' }]);
  });
  it('several roles at several facilities are all kept', () => {
    expect(shapeMe('u', [], [{ user_id: 'u', facility_id: F1, role: 'nurse' }, { user_id: 'u', facility_id: F2, role: 'doctor' }]).memberships).toHaveLength(2);
  });
  it('a row without a user id never counts as the caller\'s (nothing is assumed)', () => {
    expect(shapeMe('u', [], [{ facility_id: F1, role: 'doctor' }]).memberships).toEqual([]);
  });
  it('someone with no profile row still gets their roles and a null name', () => {
    expect(shapeMe('u', [{ user_id: 'other', display_name: 'X' }], [{ user_id: 'u', facility_id: F1, role: 'nurse' }])).toMatchObject({ displayName: null, memberships: [{ role: 'nurse' }] });
  });
});

describe('the reader is built for the verified user', () => {
  it('passes the verified user id to the reader factory, never anything from the request', async () => {
    let got: [string, string] | null = null;
    const deps = {
      verifyToken: async () => ({ userId: 'verified-user', aal: 'aal2' as const }),
      userReader: (token: string, userId: string) => { got = [token, userId]; return { getMe: async () => ({ displayName: 'X', memberships: [] }) } as unknown as UserReader; },
      audit: async () => {},
    } as unknown as Deps;
    const app = await buildApp({ allowedOrigins: [] }, deps);
    const r = await app.inject({ method: 'GET', url: '/me', headers: { authorization: 'Bearer tok', 'x-user-id': 'someone-else' } });
    expect(r.statusCode).toBe(200); expect(got).toEqual(['tok', 'verified-user']); expect(r.json().userId).toBe('verified-user');
  });
});
