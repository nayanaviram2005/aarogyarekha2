import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n/I18n';
import { AI_NOTICE_VERSION, ConsentForm } from '../components/ConsentForm';
import { useMe } from './meContext';
import { RecordsPicker } from '../components/RecordsPicker';
import { buildRegistration, RegisterPatientForm } from '../components/RegisterPatientForm';
import { TemplateFields } from '../components/TemplateFields';
import { TextHints } from '../components/TextHints';
import { noteFor, TEMPLATES } from '../lib/scenarioTemplates';
import { Banner } from '../components/Provenance';
import { ApiError } from '../lib/api';
import { ageSex, CONSCIOUSNESS, LANGUAGES, SCENARIOS } from '../lib/format';
import type { RecordFile } from '../lib/recordsIntake';
import type { PatientBrief, RecordIdentity, SymptomInput } from '../lib/types';
import { PaneFrame } from './PaneFrame';
import { useQueue } from './queueContext';

type Status = 'todo' | 'run' | 'done' | 'fail';
interface Step { key: string; label: string; status: Status }
interface SymptomRow { text: string; value: string; unit: NonNullable<SymptomInput['durationUnit']>; severity: string }

const VITAL_ROWS = [
  { kind: 'temperature_c', label: 'Temperature (°C)' }, { kind: 'pulse_bpm', label: 'Pulse (per minute)' },
  { kind: 'resp_rate_pm', label: 'Breathing rate (per minute)' }, { kind: 'spo2_pct', label: 'Oxygen saturation, SpO2 (%)' },
  { kind: 'bp_systolic_mmhg', label: 'Blood pressure, systolic (mmHg)' }, { kind: 'bp_diastolic_mmhg', label: 'Blood pressure, diastolic (mmHg)' },
] as const;
const UNITS = ['minutes', 'hours', 'days', 'weeks', 'months', 'years'] as const;
const blankSymptom = (): SymptomRow => ({ text: '', value: '', unit: 'days', severity: '' });

export function IntakePage() {
  return <PaneFrame startOn="note" center={<Intake />} context={<div style={{ padding: 16 }}><p className="small muted">Intake adds a patient to the queue. Consent is checked on the server before anything is saved.</p></div>} />;
}

function Intake() {
  const { api } = useAuth();
  const { t } = useI18n();
  const queue = useQueue();
  const nav = useNavigate();

  const [q, setQ] = useState('');
  const [results, setResults] = useState<PatientBrief[] | null>(null);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const fromSwitch = (useLocation().state as { patient?: PatientBrief } | null)?.patient ?? null;
  const [patient, setPatient] = useState<PatientBrief | null>(fromSwitch);
  const [registering, setRegistering] = useState(false);
  const [recordFiles, setRecordFiles] = useState<RecordFile[]>([]);
  const [identity, setIdentity] = useState<RecordIdentity | null>(null);
  const [recBusy, setRecBusy] = useState(false);
  const [regNote, setRegNote] = useState<string | null>(null);
  const onFound = (i: RecordIdentity) => setIdentity(cur => ({ ...i, ...(cur ?? {}) }));

  const [scenario, setScenario] = useState('opd_queue');
  const [language, setLanguage] = useState('en');
  const [complaint, setComplaint] = useState('');
  const [tpl, setTpl] = useState<Record<string, string>>({});
  const [vitals, setVitals] = useState<Record<string, string>>({});
  const [symptoms, setSymptoms] = useState<SymptomRow[]>([blankSymptom()]);
  const [consciousness, setConsciousness] = useState('');
  const [oxygen, setOxygen] = useState('');

  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ title: string; text: string; kind: 'warn' | 'error' } | null>(null);
  const [needConsent, setNeedConsent] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);

  const done = useRef<{ encounterId: string | null; keys: Set<string> }>({ encounterId: null, keys: new Set() });
  const docIds = useRef<Record<string, string>>({});
  const startNow = useRef(false);

  useEffect(() => {
    if (!api || patient) return;
    const text = q.trim(); if (text.length < 2) return;
    let live = true;
    const t = window.setTimeout(() => { api.patients(text).then(r => { if (live) { setResults(r); setSearchErr(null); } }).catch(err => { if (live) setSearchErr((err as Error).message); }); }, 300);
    return () => { live = false; window.clearTimeout(t); };
  }, [q, api, patient]);

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!api) return;
    setSearchErr(null);
    try { setResults(await api.patients(q.trim() || undefined)); } catch (err) { setSearchErr((err as Error).message); }
  }

  async function registerFromRecord() {
    if (!api || !identity || recBusy) return;
    setRegNote(null);
    const reg = buildRegistration({ fullName: identity.fullName ?? '', sex: identity.sex ?? 'unknown', age: identity.ageYears !== undefined ? String(Math.floor(identity.ageYears)) : '', birthDate: identity.birthDate ?? '', language: 'en', phone: identity.phone });
    if (typeof reg === 'string') { setRegNote(`${reg} Fill in what the records did not show, then register.`); setRegistering(true); return; }
    setRecBusy(true);
    try { const r = await api.registerPatient(reg); registered({ id: r.id, public_ref: r.publicRef, full_name: reg.fullName, sex: reg.sex, birth_date: reg.birthDate ?? null, age_years_reported: reg.birthDate ? null : reg.ageYears ?? null, preferred_language: reg.preferredLanguage } as PatientBrief); }
    catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.duplicates?.length) { setRegNote('Someone with the same name and age is already registered. Check the list below, or confirm this is a different person.'); setRegistering(true); }
      else setRegNote((err as Error).message);
    } finally { setRecBusy(false); }
  }

  function extractAndRegister() {
    if (identity?.fullName) return registerFromRecord();
    const why = recordFiles.find(r => r.note)?.note;
    setRegNote(`No name could be read from the record${why ? ` (${why})` : ''}. Type the details below, then register.`);
    setRegistering(true);
    return Promise.resolve();
  }

  function registered(p: PatientBrief) {
    choose(p); startNow.current = true; void run(undefined, p);
  }

  function choose(p: PatientBrief) {
    startNow.current = false;
    setPatient(p); setLanguage(p.preferred_language in { en: 1, hi: 1, or: 1 } ? p.preferred_language : 'en');
    done.current = { encounterId: null, keys: new Set() }; setSteps([]); setProblem(null); setNeedConsent(false); setSavedId(null);
  }

  function validate(): { vitalValues: [string, number][]; symptomRows: SymptomInput[] } | string {
    const vitalValues: [string, number][] = [];
    for (const r of VITAL_ROWS) {
      const t = (vitals[r.kind] ?? '').trim(); if (!t) continue;
      const n = Number(t); if (!Number.isFinite(n)) return `${r.label}: enter a number.`;
      vitalValues.push([r.kind, n]);
    }
    const symptomRows: SymptomInput[] = [];
    for (const s of symptoms) {
      if (!s.text.trim()) continue;
      const row: SymptomInput = { text: s.text.trim(), lang: language };
      if (s.value.trim()) { const n = Number(s.value); if (!Number.isFinite(n) || n < 0) return `Duration for "${s.text.trim()}": enter a number.`; row.durationValue = n; row.durationUnit = s.unit; }
      if (s.severity.trim()) { const n = Number(s.severity); if (!Number.isInteger(n) || n < 0 || n > 10) return `Severity for "${s.text.trim()}": enter a whole number from 0 to 10.`; row.severity = n; }
      symptomRows.push(row);
    }
    for (const f of TEMPLATES[scenario]?.fields ?? []) { const a = (tpl[f.key] ?? '').trim(); if (a) symptomRows.push({ text: noteFor(f, a), lang: language }); }
    if (!complaint.trim() && symptomRows.length === 0 && recordFiles.length === 0 && !startNow.current) return 'Enter the main complaint or at least one symptom, or add the patient records.';
    return { vitalValues, symptomRows };
  }

  const staffName = useMe()?.displayName?.trim() || null;
  async function run(e?: FormEvent, justRegistered?: PatientBrief) {
    e?.preventDefault();
    const pt = justRegistered ?? patient;
    if (!api || !pt || busy) return;
    const v = validate();
    if (typeof v === 'string') { setFormErr(v); return; }
    setFormErr(null); setProblem(null); setNeedConsent(false); setBusy(true);

    const nothingYet = !complaint.trim() && v.symptomRows.length === 0 && v.vitalValues.length === 0;
    const plan: { key: string; label: string; go: () => Promise<unknown> }[] = [
      { key: 'encounter', label: 'Start the encounter', go: async () => { const r = await api.createEncounter({ patientId: pt.id, scenario, language, ...(complaint.trim() ? { chiefComplaint: complaint.trim() } : {}) }); done.current.encounterId = r.id; } },
      ...v.symptomRows.map((s, i) => ({ key: `sym${i}`, label: `Save symptom: ${s.text}`, go: () => api.addSymptom(done.current.encounterId!, s) })),
      ...v.vitalValues.map(([kind, value]) => ({ key: `vit-${kind}`, label: `Save ${VITAL_ROWS.find(r => r.kind === kind)!.label.split(' (')[0]!.toLowerCase()}`, go: () => api.addVital(done.current.encounterId!, { kind, value }) })),
      ...(consciousness || oxygen ? [{ key: 'inputs', label: 'Save responsiveness and oxygen', go: () => api.saveInputs(done.current.encounterId!, { ...(consciousness ? { consciousness: consciousness as never } : {}), ...(oxygen ? { onSupplementalOxygen: oxygen === 'yes' } : {}) }) }] : []),
      ...(recordFiles.some(r => r.aiConsent) && staffName ? [{ key: 'ai-consent', label: 'Record the patient’s agreement to the outside AI reader', go: () => api.recordConsent(pt.id, { purpose: 'external_ai_processing', givenBy: 'self', method: 'verbal_witnessed', noticeVersion: AI_NOTICE_VERSION, witnessName: staffName }) }] : []),
      ...recordFiles.flatMap(r => [
        { key: `doc-${r.key}`, label: `Attach ${r.file.name}`, go: async () => { docIds.current[r.key] = (await api.uploadDocument(done.current.encounterId!, r.file, r.kind)).id; } },
        { key: `read-${r.key}`, label: `Read ${r.file.name}`, go: async () => { try { await api.extractDocument(docIds.current[r.key]!, language as 'en' | 'hi' | 'or'); } catch { } } },
      ]),
      { key: 'submit', label: 'Submit to the queue', go: () => api.submit(done.current.encounterId!) },
      ...(nothingYet ? [] : [{ key: 'assess', label: 'Assess priority', go: () => api.assess(done.current.encounterId!) }]),
    ];
    setSteps(plan.map(p => ({ key: p.key, label: p.label, status: done.current.keys.has(p.key) ? 'done' : 'todo' })));
    const mark = (key: string, status: Status) => setSteps(cur => cur.map(s => (s.key === key ? { ...s, status } : s)));

    for (const p of plan) {
      if (done.current.keys.has(p.key)) continue;
      mark(p.key, 'run');
      try { await p.go(); done.current.keys.add(p.key); mark(p.key, 'done'); }
      catch (err) {
        mark(p.key, 'fail'); setBusy(false);
        const ae = err as ApiError;
        if (p.key === 'assess' && ae.isRulesNotApproved) { setSavedId(done.current.encounterId); setProblem({ kind: 'warn', title: 'Saved, but not assessed', text: 'The patient is in the queue. Triage rules are not approved yet, so no priority could be set. A qualified reviewer must approve the rule set first.' }); void queue.refresh(); return; }
        if (ae.isConsent) { setNeedConsent(true); return; }
        setProblem({ kind: 'error', title: 'Not completed', text: `${(err as Error).message} Your entries are kept. Try again to continue from this step.` });
        if (done.current.encounterId) setSavedId(done.current.encounterId);
        return;
      }
    }
    setBusy(false); void queue.refresh();
    nav(`/encounters/${done.current.encounterId}`);
  }

  if (!patient) {
    return (
      <>
        <header><h2>{t('intake.title')}</h2><p className="muted small">Find the patient, then enter what has been observed. If they are not registered yet, register them here.</p></header>
        <section className="block" aria-label="Patient records">
          <div className="block__head"><h3>Start from the patient's records</h3></div>
          <div className="block__body">
            <RecordsPicker api={api!} files={recordFiles} setFiles={setRecordFiles} language={language} onIdentity={onFound} disabled={recBusy} />
            {recordFiles.length > 0 && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn--primary" disabled={recBusy || recordFiles.some(r => r.state === 'reading')} onClick={() => void extractAndRegister()}>
                  {recBusy ? 'Registering…' : recordFiles.some(r => r.state === 'reading') ? 'Reading the record…' : 'Extract details and register'}
                </button>
                <span className="small muted">
                  {identity?.fullName
                    ? `${identity.fullName}${identity.ageYears !== undefined ? `, ${Math.floor(identity.ageYears)} y` : ''}${identity.sex ? `, ${identity.sex}` : ''} · read from the record. Check it is right.`
                    : 'Registers the person the record is about. If no name can be read, you type it below.'}
                </span>
              </div>
            )}
            {regNote && <Banner kind="warn">{regNote}</Banner>}
          </div>
        </section>
        <form className="block" onSubmit={search} role="search">
          <div className="block__head"><h3>{t('intake.find')}</h3></div>
          <div className="block__body">
            <div className="row">
              <div className="field"><label htmlFor="pq">{t('intake.nameOrRef')}</label><input id="pq" className="input" value={q} onChange={e => setQ(e.target.value)} maxLength={60} autoFocus /></div>
              <button className="btn btn--primary" type="submit">{t('intake.search')}</button>
            </div>
            {searchErr && <Banner kind="error">{searchErr}</Banner>}
            {results && results.length === 0 && <p className="muted small">No patients match. Check the spelling, or register a new patient below.</p>}
            {results && results.length > 0 && (
              <ul style={{ border: '1px solid var(--rule)' }}>{results.map(p => (
                <li key={p.id}><button type="button" className="queue-row" onClick={() => choose(p)}>
                  <span className="queue-row__name"><span>{p.full_name}</span></span><span className="queue-row__sub">{p.public_ref} · {ageSex(p)}</span>
                </button></li>))}</ul>
            )}
          </div>
        </form>
        {registering
          ? <><RegisterPatientForm identity={identity} api={api!} onRegistered={p => { setRegistering(false); registered(p); }} onUseExisting={m => { setRegistering(false); choose({ id: m.id, public_ref: m.publicRef, full_name: m.fullName, sex: m.sex, birth_date: m.birthDate, age_years_reported: m.ageYears, preferred_language: 'en' }); }} onCancel={() => setRegistering(false)} /></>
          : <div><button type="button" className="btn" onClick={() => setRegistering(true)}>Register a new patient, or from records</button></div>}
      </>
    );
  }

  return (
    <>
      <header>
        <h2>{t('intake.title')}</h2>
        <p className="small"><strong>{patient.full_name}</strong> <span className="muted">· {patient.public_ref} · {ageSex(patient)}</span> {!busy && !savedId && <button className="btn btn--small btn--quiet" style={{ marginLeft: 8 }} onClick={() => setPatient(null)}>{t('intake.change')}</button>}</p>
      </header>

      <form className="block" onSubmit={run} noValidate>
        <div className="block__head"><h3>{t('intake.observed')}</h3></div>
        <div className="block__body">
          {api && <RecordsPicker api={api} files={recordFiles} setFiles={setRecordFiles} language={language} disabled={busy || !!done.current.encounterId} />}
          <div className="field"><label htmlFor="cc">{t('intake.complaint')}</label><textarea id="cc" autoFocus className="textarea" lang={language} value={complaint} onChange={e => setComplaint(e.target.value)} maxLength={2000} disabled={busy} /></div>
          <TextHints text={complaint} language={language} onPickLanguage={setLanguage} />

          <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={busy}>
            <legend className="strong small" style={{ padding: 0, marginBottom: 8 }}>{t('intake.measurements')}</legend>
            <div className="vitals-grid">{VITAL_ROWS.map(r => (
              <div className="field" key={r.kind}><label htmlFor={`v-${r.kind}`}>{r.label}</label><input id={`v-${r.kind}`} className="input input--num" inputMode="decimal" value={vitals[r.kind] ?? ''} onChange={e => setVitals(v => ({ ...v, [r.kind]: e.target.value }))} /></div>))}
              <div className="field"><label htmlFor="cons">{t('intake.responsiveness')}</label><select id="cons" className="select" value={consciousness} onChange={e => setConsciousness(e.target.value)}><option value="">Not checked</option>{CONSCIOUSNESS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
              <div className="field"><label htmlFor="o2">{t('intake.oxygen')}</label><select id="o2" className="select" value={oxygen} onChange={e => setOxygen(e.target.value)}><option value="">Not checked</option><option value="no">No</option><option value="yes">Yes</option></select></div>
            </div>
          </fieldset>

          <details className="fold">
            <summary className="fold__summary"><span className="fold__title">More detail</span><span className="fold__hint small muted">Optional: visit type, language, how long and how bad each symptom is</span></summary>
            <div className="fold__body">
          <div className="grid2">
            <div className="field"><label htmlFor="sc">{t('intake.visitType')}</label><select id="sc" className="select" value={scenario} onChange={e => { setScenario(e.target.value); setTpl({}); }} disabled={busy}>{SCENARIOS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
            <div className="field"><label htmlFor="lg">{t('intake.spoke')}</label><select id="lg" className="select" value={language} onChange={e => setLanguage(e.target.value)} disabled={busy}>{LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}</select></div>
          </div>
          <TemplateFields scenario={scenario} values={tpl} onChange={setTpl} lang={language} disabled={busy} />
          <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={busy}>
            <legend className="strong small" style={{ padding: 0, marginBottom: 8 }}>{t('intake.symptoms')}</legend>
            {symptoms.map((s, i) => (
              <div className="row" key={i} style={{ marginBottom: 8 }}>
                <div className="field" style={{ flex: '2 1 200px' }}><label htmlFor={`st${i}`}>{t('intake.symptom')}</label><input id={`st${i}`} className="input" lang={language} value={s.text} onChange={e => setSymptoms(r => r.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} maxLength={2000} /></div>
                <div className="field" style={{ flex: '0 1 90px' }}><label htmlFor={`sv${i}`}>{t('intake.for')}</label><input id={`sv${i}`} className="input" inputMode="decimal" value={s.value} onChange={e => setSymptoms(r => r.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} /></div>
                <div className="field" style={{ flex: '0 1 110px' }}><label htmlFor={`su${i}`}>{t('intake.unit')}</label><select id={`su${i}`} className="select" value={s.unit} onChange={e => setSymptoms(r => r.map((x, j) => (j === i ? { ...x, unit: e.target.value as SymptomRow['unit'] } : x)))}>{UNITS.map(u => <option key={u}>{u}</option>)}</select></div>
                <div className="field" style={{ flex: '0 1 100px' }}><label htmlFor={`ss${i}`}>{t('intake.severity')}</label><input id={`ss${i}`} className="input" inputMode="numeric" value={s.severity} onChange={e => setSymptoms(r => r.map((x, j) => (j === i ? { ...x, severity: e.target.value } : x)))} /></div>
              </div>
            ))}
            <button type="button" className="btn btn--small btn--quiet" onClick={() => setSymptoms(r => [...r, blankSymptom()])}>Add another symptom</button>
          </fieldset>
            </div>
          </details>

          {formErr && <Banner kind="error">{formErr}</Banner>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn--primary" type="submit" disabled={busy}>{busy ? 'Saving…' : done.current.encounterId ? 'Continue' : 'Get the priority'}</button>
            <span className="small muted">Danger signs are asked next, ranked by how much they could change the priority.</span>
          </div>
        </div>
      </form>

      {steps.length > 0 && (
        <section className="block" aria-label="Progress"><div className="block__head"><h3>{t('intake.progress')}</h3></div>
          <div className="block__body"><ol className="steps">{steps.map(s => <li key={s.key} className={`step step--${s.status === 'todo' ? 'todo' : s.status}`}><span className="step__mark" aria-hidden="true" /><span>{s.label}{s.status === 'fail' ? ' — failed' : ''}</span></li>)}</ol></div></section>
      )}

      {problem && <Banner kind={problem.kind} title={problem.title}>{problem.text}</Banner>}
      {savedId && <div><Link className="btn" to={`/encounters/${savedId}`}>Open the encounter</Link></div>}
      {needConsent && api && (
        <>
          <ConsentForm api={api} patientId={patient.id} dialog onCancel={() => setNeedConsent(false)} intro={<Banner kind="warn" title="Consent is needed first">No active consent for triage is recorded for {patient.full_name}. Record it, then continue. Nothing has been lost.</Banner>} onRecorded={() => { setNeedConsent(false); void run(); }} />
        </>
      )}
    </>
  );
}
