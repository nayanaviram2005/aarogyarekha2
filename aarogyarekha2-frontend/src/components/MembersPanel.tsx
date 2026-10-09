import { useCallback, useEffect, useState } from 'react';
import { Banner } from './Provenance';
import { formatTime } from '../lib/format';
import type { Api, MemberChangeView, MemberRole, MemberView } from '../lib/types';

export const ROLE_LABEL: Record<string, string> = { health_worker: 'Health worker', nurse: 'Nurse', doctor: 'Doctor', medical_officer: 'Medical officer', facility_admin: 'Facility administrator' };
const ROLES: MemberRole[] = ['health_worker', 'nurse', 'doctor', 'medical_officer'];
const OP: Record<string, string> = { set_role: 'Role set', deactivate: 'Removed' };
const isRole = (r: string): r is MemberRole => (ROLES as string[]).includes(r);

export function MembersPanel({ api }: { api: Api }) {
  const [members, setMembers] = useState<MemberView[] | null>(null);
  const [changes, setChanges] = useState<MemberChangeView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('nurse');
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setMembers(await api.members()); } catch (e) { setError((e as Error).message); return; }
    try { setChanges(await api.memberChanges()); } catch { setChanges([]); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  async function run(key: string, fn: () => Promise<unknown>, message: string) {
    setBusy(key); setError(null); setDone(null);
    try { await fn(); await load(); setDone(message); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  const many = new Set((members ?? []).map(m => m.facilityId)).size > 1;

  return (
    <section className="block" aria-label="People and roles">
      <div className="block__head"><h3>People and roles</h3></div>
      <div className="block__body">
        <p className="small muted">A person has one role at a facility. Changes are recorded in the audit log. To add someone, they must already have signed in once. Facility administrators are made by the platform administrator.</p>
        {error && <Banner kind="error" title="Not done">{error}</Banner>}
        {done && <p className="small" role="status">{done}</p>}
        {members === null && !error && <p className="small muted" role="status">Loading…</p>}
        {members && members.length === 0 && <p className="small muted">No one is listed yet.</p>}
        {members && members.length > 0 && (
          <table className="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>{members.map(m => {
              const key = m.userId + m.facilityId; const label = m.name ?? m.email ?? m.userId.slice(0, 8); const fac = many ? m.facilityId : undefined;
              return (
                <tr key={key}>
                  <td>{label}{m.isSelf && <span className="tiny muted"> (you)</span>}</td><td>{m.email ?? '—'}</td>
                  <td>{m.canChange
                    ? <select className="select" aria-label={`Role for ${label}`} value={isRole(m.role) ? m.role : ''} disabled={busy === key}
                        onChange={e => { const r = e.target.value as MemberRole; void run(key, () => api.setMemberRole(m.userId, r, fac), `Role for ${label} is now ${ROLE_LABEL[r]}.`); }}>
                        {!isRole(m.role) && <option value="" disabled>{ROLE_LABEL[m.role] ?? m.role}</option>}
                        {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
                    : ROLE_LABEL[m.role] ?? m.role}</td>
                  <td>{m.active ? <span className="chip chip--ok">Active</span> : <span className="chip">Removed</span>}</td>
                  <td>
                    {m.canChange && m.active && <button type="button" className="btn btn--small" disabled={busy === key} onClick={() => { if (window.confirm(`Remove ${label} from this facility? Their history stays.`)) void run(key, () => api.removeMember(m.userId, fac), `${label} was removed.`); }}>Remove</button>}
                    {m.canChange && !m.active && <button type="button" className="btn btn--small" disabled={busy === key} onClick={() => void run(key, () => api.setMemberRole(m.userId, isRole(m.role) ? m.role : 'nurse', fac), `${label} was added back.`)}>Add back</button>}
                  </td>
                </tr>);
            })}</tbody></table>
        )}

        <form style={{ marginTop: 16, display: 'grid', gap: 8, maxWidth: 420 }} onSubmit={e => { e.preventDefault(); const addr = email.trim(); if (!addr) return; void run('add', async () => { await api.addMember({ email: addr, role }); setEmail(''); }, `${addr} was added as ${ROLE_LABEL[role]}.`); }}>
          <h4 style={{ margin: 0 }}>Add a person</h4>
          <label htmlFor="mem-email">Email of their account</label>
          <input id="mem-email" className="input" type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} />
          <label htmlFor="mem-role">Role</label>
          <select id="mem-role" className="select" value={role} onChange={e => setRole(e.target.value as MemberRole)}>{ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
          <div><button type="submit" className="btn btn--primary" disabled={busy === 'add' || !email.trim()}>{busy === 'add' ? 'Adding…' : 'Add person'}</button></div>
        </form>

        {changes.length > 0 && (
          <div style={{ marginTop: 16 }}><h4 style={{ margin: '0 0 6px' }}>Recent changes</h4>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{changes.slice(0, 10).map((c, i) => (
              <li key={i}>{formatTime(c.at)} · {c.actor ?? 'Someone'}: {OP[c.op] ?? c.op}{c.target ? ` · ${c.target}` : ''}{c.role ? ` · ${ROLE_LABEL[c.role] ?? c.role}` : ''}{c.previous && c.previous !== 'none' ? ` (was ${ROLE_LABEL[c.previous] ?? c.previous})` : ''}</li>))}</ul></div>
        )}
      </div>
    </section>
  );
}
