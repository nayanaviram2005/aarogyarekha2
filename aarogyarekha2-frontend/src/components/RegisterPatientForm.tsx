import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../lib/api';
import { LANGUAGES } from '../lib/format';
import { applyIdentity } from '../lib/recordsIntake';
import type { Api, DuplicateMatch, PatientBrief, RecordIdentity, RegisterInput } from '../lib/types';
import { Banner } from './Provenance';

const SEX: { value: PatientBrief['sex']; label: string }[] = [{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: 'other', label: 'Other' }, { value: 'unknown', label: 'Not stated' }];

export function buildRegistration(f: { fullName: string; sex: PatientBrief['sex']; age: string; birthDate: string; language: string; phone?: string; village?: string }): RegisterInput | string {
  const name = f.fullName.trim();
  if (!name) return 'Enter the patient\'s name.';
  if (!/^[\p{L}\p{M}\p{N} .\-']+$/u.test(name)) return 'The name can have letters, numbers, spaces, dots, hyphens and apostrophes only.';
  const out: RegisterInput = { fullName: name, sex: f.sex, preferredLanguage: f.language };
  if (f.birthDate) { if (Date.parse(f.birthDate) > Date.now()) return 'The birth date cannot be in the future.'; out.birthDate = f.birthDate; }
  else {
    const a = f.age.trim();
    if (!/^\d{1,3}$/.test(a) || Number(a) > 130) return 'Enter the age in whole years (0 to 130), or a birth date.';
    out.ageYears = Number(a);
  }
  if (f.phone?.trim()) { if (!/^\+?[0-9][0-9 -]{7,14}$/.test(f.phone.trim())) return 'The phone number looks wrong.'; out.phone = f.phone.trim(); }
  if (f.village?.trim()) out.villageTown = f.village.trim();
  return out;
}

export function RegisterPatientForm({ api, onRegistered, onUseExisting, onCancel, identity }: { api: Api; onRegistered: (p: PatientBrief) => void; onUseExisting?: (m: DuplicateMatch) => void; onCancel?: () => void; identity?: RecordIdentity | null }) {
  const [f, setF] = useState({ fullName: '', sex: 'unknown' as PatientBrief['sex'], age: '', birthDate: '', language: 'en', phone: '', village: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dups, setDups] = useState<DuplicateMatch[] | null>(null);
  useEffect(() => { if (identity) setF(x => applyIdentity(x, identity)); }, [identity]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF(x => ({ ...x, [k]: v })); setDups(null); };

  async function submit(e: FormEvent, confirmNotDuplicate = false) {
    e.preventDefault();
    const req = buildRegistration(f);
    if (typeof req === 'string') { setError(req); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.registerPatient({ ...req, ...(confirmNotDuplicate ? { confirmNotDuplicate: true } : {}) });
      onRegistered({ id: r.id, public_ref: r.publicRef, full_name: req.fullName, sex: req.sex, birth_date: req.birthDate ?? null, age_years_reported: req.birthDate ? null : req.ageYears ?? null, preferred_language: req.preferredLanguage });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.duplicates?.length) { setDups(err.duplicates); setError(null); } else setError((err as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <form className="block" onSubmit={e => void submit(e)} noValidate aria-label="Register a new patient">
      <div className="block__head"><h3>Register a new patient</h3></div>
      <div className="block__body">
        {error && <Banner kind="error">{error}</Banner>}
        {dups && (
          <Banner kind="warn" title="Someone with this name and age is already registered">
            <ul>{dups.map(d => <li key={d.id}>{d.fullName} · {d.publicRef}{d.ageYears != null ? ` · ${d.ageYears} years` : d.birthDate ? ` · born ${d.birthDate}` : ''}{onUseExisting && <> <button type="button" className="btn btn--small" onClick={() => onUseExisting(d)}>Use this person</button></>}</li>)}</ul>
            <button type="button" className="btn btn--small" onClick={e => void submit(e, true)} disabled={busy}>This is a different person. Register anyway.</button>
          </Banner>
        )}
        <div className="field"><label htmlFor="rg-name">Full name</label><input id="rg-name" className="input" value={f.fullName} onChange={e => set('fullName', e.target.value)} maxLength={120} disabled={busy} autoFocus /></div>
        <div className="grid2">
          <div className="field"><label htmlFor="rg-sex">Sex</label><select id="rg-sex" className="select" value={f.sex} onChange={e => set('sex', e.target.value as PatientBrief['sex'])} disabled={busy}>{SEX.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
          <div className="field"><label htmlFor="rg-lang">Language the patient speaks</label><select id="rg-lang" className="select" value={f.language} onChange={e => set('language', e.target.value)} disabled={busy}>{LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}</select></div>
          <div className="field"><label htmlFor="rg-age">Age in years</label><input id="rg-age" className="input" inputMode="numeric" value={f.age} onChange={e => set('age', e.target.value)} disabled={busy || !!f.birthDate} /></div>
          <div className="field"><label htmlFor="rg-dob">Or date of birth</label><input id="rg-dob" className="input" type="date" value={f.birthDate} onChange={e => set('birthDate', e.target.value)} disabled={busy} /></div>
          <div className="field"><label htmlFor="rg-phone">Phone (optional)</label><input id="rg-phone" className="input" inputMode="tel" value={f.phone} onChange={e => set('phone', e.target.value)} disabled={busy} /></div>
          <div className="field"><label htmlFor="rg-village">Village or town (optional)</label><input id="rg-village" className="input" value={f.village} onChange={e => set('village', e.target.value)} maxLength={80} disabled={busy} /></div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--primary" type="submit" disabled={busy}>{busy ? 'Registering…' : 'Register patient'}</button>
          {onCancel && <button type="button" className="btn btn--quiet" onClick={onCancel} disabled={busy}>Cancel</button>}
        </div>
      </div>
    </form>
  );
}
