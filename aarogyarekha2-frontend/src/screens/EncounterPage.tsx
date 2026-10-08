import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n/I18n';
import { ConsentForm } from '../components/ConsentForm';
import { FollowUpControl, YesNo } from '../components/FollowUpControl';
import { draftReady, submitDrafts, type Draft } from '../lib/answerDrafts';
import { UrgencyPlate } from '../components/Plate';
import { Banner, Provenance } from '../components/Provenance';
import { ReviewPanel } from '../components/ReviewPanel';
import { ReferralPanel } from '../components/ReferralPanel';
import { DocumentsPanel } from '../components/DocumentsPanel';
import { TranslateBar } from '../components/TranslateBar';
import { Timeline } from '../components/Timeline';
import { pushRecent } from '../lib/recentPatients';
import { TextHints } from '../components/TextHints';
import { QUESTION_LANGS, questionIn } from '../i18n/questions';
import { audienceOf, needsClinician, orderForAudience } from '../lib/questionAudience';
import { HistoryPanel } from '../components/HistoryPanel';
import { MeasurementForm } from '../components/MeasurementForm';
import { NotesPanel } from '../components/NotesPanel';
import { ScenarioChecklist } from '../components/ScenarioChecklist';
import { TrendPanel } from '../components/TrendPanel';
import { FollowupsPanel } from '../components/FollowupsPanel';
import { VoiceInput } from '../components/VoiceInput';
import { canReviewAt, useMe } from './meContext';
import { RULES_CLINICALLY_VALIDATED } from '../config';
import { ApiError } from '../lib/api';
import { AiOpinion } from '../components/AiOpinion';
import { CaseSummary } from '../components/CaseSummary';
import { VisitPanel } from '../components/VisitPanel';
import { JourneyBar } from '../components/JourneyBar';
import { StepPanel } from '../components/StepPanel';
import { Fold } from '../components/Fold';
import { journey, type StepKey } from '../lib/journey';
import { ReportDetails } from '../components/ReportDetails';
import { RecordContextPanel } from '../components/RecordContextPanel';
import { ageSex, formatTime, isTier, languageLabel, latestVitals, scenarioLabel, TIER_WORD, tierOfUrgency, vitalLabel, vitalUnit } from '../lib/format';
import type { EncounterSummary, Tier, UrgencyCode } from '../lib/types';
import { PaneFrame } from './PaneFrame';
import { useQueue } from './queueContext';

const EDITABLE = new Set(['draft', 'submitted', 'in_review']);

/** The most open questions shown at once. The list is ranked by how much an answer could change the priority, so the first ones matter most. */
const QUESTION_LIMIT = 12;

export function EncounterPage() {
  const { id } = useParams();
  const { api } = useAuth();
  const queue = useQueue();
  const [summary, setSummary] = useState<EncounterSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!api || !id) return;
    try { setSummary(await api.summary(id)); setError(null); }
    catch (e) { setSummary(null); setError((e as Error).message); }
    finally { setLoading(false); }
  }, [api, id]);

  useEffect(() => { setLoading(true); setSummary(null); void load(); }, [load]);
  useEffect(() => { if (summary) pushRecent(sessionStorage, { encounterId: summary.encounter.id, ref: summary.patient.public_ref }); }, [summary?.encounter.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const changed = useCallback(async () => { await Promise.all([load(), queue.refresh()]); }, [load, queue]);

  const center = loading ? <p className="muted" role="status">Loading…</p>
    : error ? <Banner kind="error" title="Cannot open this record">{error}</Banner>
    : summary ? <Workspace summary={summary} onChanged={changed} />
    : null;
  return <PaneFrame startOn="note" resetKey={id} center={center} context={summary ? <ContextPanel summary={summary} /> : null} />;
}

function Workspace({ summary: s, onChanged }: { summary: EncounterSummary; onChanged: () => Promise<void> }) {
  const { api } = useAuth();
  const [assessing, setAssessing] = useState(false);
  const [reportsKey, setReportsKey] = useState(0);
  const [sel, setSel] = useState<StepKey>('checkin');
  const [aiHelp, setAiHelp] = useState<'ask' | null>(null);
  const [err, setErr] = useState<ApiError | Error | null>(null);
  const [answeredSince, setAnsweredSince] = useState(0);
  const editable = EDITABLE.has(s.encounter.status) && s.consentActive !== false;
  const a = s.assessment;
  const lang = s.encounter.language;
  const me = useMe();
  const { refresh: refreshQueue } = useQueue();
  const { t } = useI18n();

  // Effective priority = what is in force now (a reviewer may have changed what the rules produced).
  const effUrgency = (s.queue?.urgency_code ?? a?.urgency_code ?? null) as UrgencyCode | null;
  const effTier = tierOfUrgency(effUrgency);
  const isReview = (r: { action: string }) => r.action === 'approve' || r.action === 'override_urgency';
  const forCurrent = a ? s.reviews.filter(r => r.assessment_id === a.id && isReview(r)) : [];
  const currentReview = forCurrent[forCurrent.length - 1] ?? null;
  const earlierReview = !currentReview ? [...s.reviews].reverse().find(isReview) ?? null : null;
  const changedByReviewer = !!a && !!effUrgency && effUrgency !== a.urgency_code;

  async function assess(skipSubmit = false) {
    if (!api) return;
    setAssessing(true); setErr(null);
    try { if (!skipSubmit && pendingCount > 0) { await submitDrafts(api, s.encounter.id, pending); setDrafts({}); } const r = await api.assess(s.encounter.id); setAnsweredSince(0); setAiHelp(r.aiOpinion?.status === 'no_consent' ? 'ask' : null); await onChanged(); }
    catch (e) { setErr(e as Error); }
    finally { setAssessing(false); }
  }

  const pt = new Map((a?.note.missing ?? []).map(m => [m.code, m.potentialTier]));
  const checkLabel = new Map((a?.note.missing ?? []).map(m => [m.code, m.label.replace(/^Not yet assessed:\s*/, '')]));
  const audience = audienceOf(me?.memberships.find(m => m.facilityId === s.encounter.facility_id)?.role ?? me?.memberships[0]?.role);
  const [qLang, setQLang] = useState<'en' | 'hi' | 'or'>(lang === 'hi' || lang === 'or' ? lang : 'en');
  const [showAllQ, setShowAllQ] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const setDraft = (code: string, d: Draft | null) => setDrafts(prev => { const next = { ...prev }; if (d) next[code] = d; else delete next[code]; return next; });
  // Only questions the CURRENT assessment lists (an older, longer list may still be stored); the rest stay hidden until the next assessment.
  const open = orderForAudience(s.followUps.filter(f => f.status === 'open' && f.field_code && (pt.size === 0 || pt.has(f.field_code)))
    .map((f, i) => ({ f, i, p: pt.get(f.field_code!) ?? null, fieldCode: f.field_code, potentialTier: pt.get(f.field_code!) ?? null })), audience);
  const done = s.followUps.filter(f => f.status !== 'open');
  // Only answers to questions that are still open and complete count. They are all saved together when the reviewer submits.
  const openCodes = new Set(open.map(o => o.f.field_code!));
  const pending = Object.fromEntries(Object.entries(drafts).filter(([code, d]) => openCodes.has(code) && draftReady(code, d)));
  const pendingCount = Object.keys(pending).length;
  async function submitAnswers() {
    if (!api || pendingCount === 0) return;
    setSubmitting(true); setSubmitErr(null);
    try { await submitDrafts(api, s.encounter.id, pending); setDrafts({}); setAnsweredSince(c => c + 1); }
    catch (er) { setSubmitErr((er as Error).message); setSubmitting(false); return; }
    setSubmitting(false);
    await assess(true);                                                     // the patient is assessed again with the new answers (shows its own error if it fails)
  }
  const vitals = latestVitals(s.vitals);
  const signs = Object.entries(s.triageContext.signs ?? {});
  // Where this patient is in the triage-desk journey, and the one thing to do next (the card at the top).
  const jr = journey({ consent: s.consentActive, status: s.encounter.status, hasAssessment: !!a, recorded: s.symptoms.length > 0 || vitals.length > 0 || !!s.encounter.chief_complaint_original,
    openQuestions: open.length, signedOff: !!currentReview, queueStatus: s.queue?.status ?? null, canReview: canReviewAt(me, s.encounter.facility_id) });
  // The step on screen. It follows the recommended step as the patient moves along, and the person can open any other step to look at or change it.
  useEffect(() => { setSel(jr.recommended ?? 'visit'); }, [jr.next]);          // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <header>
        <h2>{s.patient.full_name}</h2>
        <p className="muted small">{s.patient.public_ref} · {ageSex(s.patient)} · {languageLabel(s.patient.preferred_language)} · {scenarioLabel(s.encounter.scenario)}</p>
        <p lang={lang} style={{ marginTop: 8, fontSize: 'var(--fs-16)' }}>{s.encounter.chief_complaint_original ?? <span className="muted">No complaint recorded</span>}</p>
        <TextHints text={[s.encounter.chief_complaint_original ?? '', ...s.symptoms.map(x => x.text_original)].join(' . ')} language={lang} />
        {s.encounter.chief_complaint_translated && <p className="small muted">In English (machine translation, not verified): {s.encounter.chief_complaint_translated}</p>}
        {api && editable && (lang === 'hi' || lang === 'or') && (!s.encounter.chief_complaint_translated || s.symptoms.some(x => (x.lang === 'hi' || x.lang === 'or') && !x.text_translated)) && <div style={{ marginTop: 8 }}><TranslateBar api={api} encounterId={s.encounter.id} patientId={s.patient.id} onDone={() => void onChanged()} /></div>}
      </header>

      <JourneyBar j={jr} selected={sel} onSelect={setSel} />

      {api && s.consentActive !== false && <RecordContextPanel api={api} encounterId={s.encounter.id} refreshKey={reportsKey} />}

      {aiHelp === 'ask' && api && (
        <section className="block" aria-label="Optional AI help">
          <div className="block__body">
            <Banner kind="info" title="An outside AI service could help with this patient">It would choose which questions fit the symptoms, word them for this patient, and give a second opinion on priority. It can raise the priority, never lower it. It needs the patient's separate agreement. You can skip this: the rules still work without it.</Banner>
            <ConsentForm api={api} patientId={s.patient.id} purpose="external_ai_processing" onRecorded={() => { setAiHelp(null); void assess(); }} />
            <button type="button" className="btn btn--small btn--quiet" onClick={() => setAiHelp(null)}>Skip for now</button>
          </div>
        </section>
      )}

      {!EDITABLE.has(s.encounter.status) && <Banner kind="info">This encounter is {s.encounter.status} and can no longer be changed.</Banner>}

        <Provenance label="Triage assessment" reviewedBy={currentReview ? currentReview.reviewer_name ?? 'a reviewer' : null} reviewedAt={currentReview ? formatTime(currentReview.created_at) : null}>
          {a ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <UrgencyPlate tier={effTier ?? a.note.tier} large />
                <span className="muted small">Assessment {a.version} · {formatTime(a.created_at)}</span>
                {a.note.vulnerable && <span className="chip">Priority group: age or pregnancy</span>}
                {changedByReviewer && <span className="chip chip--warn">Changed by a reviewer · rules said {TIER_WORD[a.note.tier]}</span>}
              </div>
              {changedByReviewer && currentReview?.action === 'override_urgency' && (
                <div>
                  <h4>Why a reviewer changed it</h4>
                  <p>{currentReview.reason}</p>
                  <p className="tiny muted">{currentReview.reviewer_name ?? 'A reviewer'} · {formatTime(currentReview.created_at)}</p>
                </div>
              )}
              {earlierReview && <Banner kind="info">An earlier assessment was reviewed by {earlierReview.reviewer_name ?? 'a reviewer'} on {formatTime(earlierReview.created_at)}. This newer assessment has not been reviewed yet.</Banner>}
              <div>
                <h4>{changedByReviewer ? `Why the rules said ${TIER_WORD[a.note.tier].toLowerCase()}` : 'Why this priority'}</h4>
                <p>{a.note.winning.detail}</p>
                <p className="tiny muted">Rule {a.note.winning.ruleId}</p>
              </div>
              {a.note.aiOpinion && <AiOpinion opinion={a.note.aiOpinion} />}
              {isTier(a.note.potentialTier) && a.note.potentialTier < a.note.tier && (
                <Banner kind="warn" title={`Could be ${TIER_WORD[a.note.potentialTier as Tier].toLowerCase()}`}>
                  Some information is still missing. Answering the questions below may raise the priority.
                </Banner>
              )}
              {a.note.insufficientData && <Banner kind="info">Nothing has been assessed yet, so this is a provisional priority.</Banner>}
              {a.note.news2.applicable && a.note.news2.score != null && <p className="small">Early-warning score from vital signs: <strong>{a.note.news2.score}</strong></p>}
              <details>
                <summary className="small strong" style={{ cursor: 'pointer' }}>How this was decided</summary>
                <table className="table" style={{ marginTop: 8 }}>
                  <thead><tr><th>Rule</th><th>Result</th><th>Detail</th></tr></thead>
                  <tbody>{a.note.log.map((l, i) => <tr key={i}><td>{l.ruleId}</td><td>{TIER_WORD[l.tier]}</td><td>{l.detail}</td></tr>)}</tbody>
                </table>
                <p className="tiny muted" style={{ marginTop: 8 }}>The most urgent result wins. Rules: {a.note.ruleSet.name} {a.note.ruleSet.version} ({a.note.ruleSet.status}).</p>
              </details>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><UrgencyPlate tier={null} assessed={false} large /><span className="muted small">This encounter has not been assessed.</span></div>
          )}
        
          {err && ((err as ApiError).isRulesNotApproved
            ? <Banner kind="warn" title="Triage rules are not approved yet">No assessment was stored. A qualified reviewer must approve the rule set first.</Banner>
            : <Banner kind="error" title="Assessment not completed">{err.message}</Banner>)}
        
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className={`btn ${answeredSince > 0 || !a ? 'btn--primary' : ''}`} onClick={() => void assess()} disabled={assessing || !editable}>
              {assessing ? 'Assessing…' : a ? 'Assess again' : 'Assess now'}
            </button>
            {answeredSince > 0 && <span className="small muted">Answers saved. Assess again to update the priority.</span>}
          </div>
        </Provenance>

      <StepPanel j={jr} selected={sel} onSelect={setSel} assessing={assessing} editable={editable} onAssess={() => void assess()}>
        {sel === 'checkin' && (
          <>
            {jr.next === 'consent' && api && <ConsentForm api={api} patientId={s.patient.id} onRecorded={() => void onChanged()} />}
            {api && editable && (
              <section className="block" aria-label="Add a symptom by voice">
                <div className="block__head"><h3>{t('enc.voice')}</h3></div>
                <div className="block__body"><VoiceInput api={api} encounterId={s.encounter.id} patientId={s.patient.id} defaultLanguage={lang ?? 'en'} onSaved={() => void onChanged()} /></div>
              </section>
            )}
            {api && editable && <MeasurementForm api={api} encounterId={s.encounter.id} onSaved={() => void onChanged()} />}
            {api && <DocumentsPanel api={api} encounterId={s.encounter.id} editable={editable} onMeasurementAdded={() => void onChanged()} onReadingChanged={() => setReportsKey(k => k + 1)} />}
            <section className="block" aria-label="Recorded information">
              <div className="block__head"><h3>{t('enc.recorded')}</h3></div>
              <div className="block__body block__body--flush">
                <table className="table">
                  <thead><tr><th>{t('enc.thSymptom')}</th><th>{t('enc.thFor')}</th><th className="num">{t('enc.thSeverity')}</th></tr></thead>
                  <tbody>
                    {s.symptoms.length === 0 && <tr><td colSpan={3} className="muted">None recorded</td></tr>}
                    {s.symptoms.map(x => (
                      <tr key={x.id}><td lang={x.lang ?? undefined}>{x.text_original}{x.text_translated && <span className="muted"> ({x.text_translated})</span>}</td>
                        <td>{x.duration_value != null ? `${x.duration_value} ${x.duration_unit}` : ''}</td><td className="num">{x.severity ?? ''}</td></tr>
                    ))}
                  </tbody>
                </table>
                <table className="table" style={{ borderTop: '1px solid var(--rule-strong)' }}>
                  <thead><tr><th>{t('enc.thMeasurement')}</th><th className="num">{t('enc.thValue')}</th><th>{t('enc.thTaken')}</th></tr></thead>
                  <tbody>
                    {vitals.length === 0 && <tr><td colSpan={3} className="muted">None recorded</td></tr>}
                    {vitals.map(v => <tr key={v.id}><td>{vitalLabel(v.kind)}</td><td className="num">{String(v.value)} {vitalUnit(v.kind)}</td><td>{formatTime(v.measured_at)}</td></tr>)}
                  </tbody>
                </table>
                {(signs.length > 0 || s.triageContext.consciousness) && (
                  <table className="table" style={{ borderTop: '1px solid var(--rule-strong)' }}>
                    <thead><tr><th>{t('enc.thChecked')}</th><th>{t('enc.thAnswer')}</th></tr></thead>
                    <tbody>
                      {s.triageContext.consciousness && <tr><td>Responsiveness</td><td>{s.triageContext.consciousness}</td></tr>}
                      {signs.map(([k, v]) => <tr key={k}><td>{k.replace(/_/g, ' ')}</td><td>{v ? 'Yes' : 'No'}</td></tr>)}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </>
        )}
        {sel === 'questions' && (
          <>
            {a && (
              <section className="block" aria-label="Information still needed">
                <div className="block__head"><h3>{t('enc.stillNeeded')}</h3><span className="chip">{open.length}</span><span className="grow" /><label className="small" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>Also show in <select className="select" value={qLang} onChange={ev => setQLang(ev.target.value as 'en' | 'hi' | 'or')} aria-label="Show questions also in">{QUESTION_LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}</select></label></div>
                <div className="block__body">
                  {open.length === 0 ? <p className="muted small">Nothing outstanding.</p> : (
                    <ol>{(showAllQ ? open : open.slice(0, QUESTION_LIMIT)).map((o, n) => api && (
                      <FollowUpControl key={o.f.field_code} fieldCode={o.f.field_code!} draft={drafts[o.f.field_code!]} onDraft={d => setDraft(o.f.field_code!, d)} question={o.f.question_text} checks={o.f.field_code!.startsWith('sign.') ? checkLabel.get(o.f.field_code!) ?? null : null} translated={questionIn(o.f.field_code!, qLang)} translatedLang={qLang} needsClinician={audience === 'health_worker' && needsClinician(o.f.field_code)}
                        rank={n + 1} potentialTier={o.p} disabled={!editable || submitting} />
                    ))}</ol>
                  )}
                  {open.length > 0 && editable && (
                    <div className="submitbar" role="group" aria-label="Submit answers">
                      <span className="small" role="status">{pendingCount === 0 ? 'Choose an answer for each question, then submit them together. The patient is assessed again when you submit.' : `${pendingCount} answer${pendingCount === 1 ? '' : 's'} chosen, not yet submitted`}</span>
                      <span className="grow" />
                      {pendingCount > 0 && <button type="button" className="btn btn--small btn--quiet" onClick={() => setDrafts({})} disabled={submitting}>Clear</button>}
                      <button type="button" className="btn btn--primary" onClick={() => void submitAnswers()} disabled={pendingCount === 0 || submitting || assessing}>{submitting ? 'Submitting…' : assessing ? 'Assessing…' : 'Submit answers'}</button>
                    </div>
                  )}
                  {submitErr && <p className="small" role="alert" style={{ color: 'var(--urg-red)', fontWeight: 500 }}>{submitErr}</p>}
                  {open.length > QUESTION_LIMIT && (
                    <button type="button" className="btn btn--small btn--quiet" onClick={() => setShowAllQ(v => !v)}>{showAllQ ? 'Show fewer questions' : `Show ${open.length - QUESTION_LIMIT} more questions`}</button>
                  )}
                  {done.length > 0 && (
                    <details><summary className="small strong" style={{ cursor: 'pointer' }}>{done.length} answered</summary>
                      <p className="tiny muted" style={{ marginTop: 8 }}>Tapped the wrong answer? Change it here, then assess again.</p>
                      <ul>{done.map((d, i) => {
                        const key = d.field_code?.startsWith('sign.') ? d.field_code.slice(5) : null;
                        return (
                          <li key={i} className="small" style={{ padding: '8px 0', borderBottom: '1px solid var(--rule)' }}>
                            <p style={{ marginBottom: 4 }}>{d.question_text}</p>
                            {key && api
                              ? <YesNo label={d.question_text} value={s.triageContext.signs?.[key]} disabled={!editable}
                                  onPick={v => { void api.saveInputs(s.encounter.id, { signs: { [key]: v } }).then(() => { setAnsweredSince(c => c + 1); return onChanged(); }).catch(er => setErr(er as Error)); }} />
                              : <strong>{d.answer_text}</strong>}
                          </li>
                        );
                      })}</ul>
                    </details>
                  )}
                </div>
              </section>
            )}
          </>
        )}
        {sel === 'signoff' && (
          <>
            {a && api && (
              <ReviewPanel api={api} encounterId={s.encounter.id} patientId={s.patient.id} assessmentId={a.id} rulesUrgency={a.urgency_code} effectiveUrgency={effUrgency ?? a.urgency_code}
                ruleFloor={['floor', 'pregnancy_bp'].includes(a.note.winning.layer)} current={currentReview} reviewerName={me?.displayName ?? null}
                canReview={canReviewAt(me, s.encounter.facility_id)} disabled={!['submitted', 'in_review'].includes(s.encounter.status) || s.consentActive === false}
                onDone={() => void onChanged()} />
            )}
          </>
        )}
        {sel === 'visit' && (
          <>
            {api && <VisitPanel bare api={api} summary={s} canReview={canReviewAt(me, s.encounter.facility_id)} reviewedCurrent={!!currentReview} onChanged={async () => { await onChanged(); await refreshQueue(); }} />}
            {!s.queue && s.encounter.status !== 'closed' && s.encounter.status !== 'referred' && <p className="small muted">The visit starts once the patient has a draft priority and a nurse or doctor has signed it off.</p>}
            {a && api && (
              <ReferralPanel api={api} encounterId={s.encounter.id} patientId={s.patient.id} effectiveUrgency={(effUrgency ?? a.urgency_code) as UrgencyCode}
                signedOff={!!currentReview} canReview={canReviewAt(me, s.encounter.facility_id)} disabled={s.consentActive === false} onChanged={() => void onChanged()} />
            )}
          </>
        )}
      </StepPanel>

      <Fold title="Background" hint="History, trends, reminders, notes, checklist">
        {api && <HistoryPanel api={api} patientId={s.patient.id} editable={s.consentActive !== false} canConfirm={canReviewAt(me, s.encounter.facility_id)} defaultLanguage={lang ?? 'en'} />}
        {api && (s.encounter.scenario === 'chronic_checkin' || s.vitals.some(v => v.kind === 'blood_glucose_mgdl' || v.kind === 'bp_systolic_mmhg')) && <TrendPanel api={api} patientId={s.patient.id} refreshKey={s.vitals.length} />}
        {api && <FollowupsPanel api={api} encounterId={s.encounter.id} patientId={s.patient.id} editable={s.consentActive !== false} />}
        {api && <ScenarioChecklist api={api} summary={s} editable={editable} onChanged={() => void onChanged()} />}
        {api && <NotesPanel api={api} encounterId={s.encounter.id} assessmentId={a?.id ?? null} canWrite={canReviewAt(me, s.encounter.facility_id)} disabled={s.consentActive === false} />}
      </Fold>
      <Fold title="Reports read and timeline" hint="Key details from reports, the story so far, everything recorded">
        {api && <ReportDetails api={api} encounterId={s.encounter.id} refreshKey={reportsKey} />}
        <CaseSummary summary={s} />
        <Timeline summary={s} />
      </Fold>
    </>
  );
}

const word = (u: string | null) => TIER_WORD[tierOfUrgency(u) ?? 4].toLowerCase();
/** "Confirmed urgent" / "Changed from urgent to immediate". */
export function reviewSentence(r: { action: string; from_urgency_code: string | null; to_urgency_code: string | null }): string {
  return r.action === 'approve' ? `Confirmed ${word(r.to_urgency_code)}` : `Changed from ${word(r.from_urgency_code)} to ${word(r.to_urgency_code)}`;
}

function ContextPanel({ summary: s }: { summary: EncounterSummary }) {
  const a = s.assessment;
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section><h3 style={{ marginBottom: 8 }}>Patient</h3>
        <dl className="kv"><dt>Name</dt><dd>{s.patient.full_name}</dd><dt>Record</dt><dd>{s.patient.public_ref}</dd><dt>Age, sex</dt><dd>{ageSex(s.patient)}</dd><dt>Language</dt><dd>{languageLabel(s.patient.preferred_language)}</dd></dl></section>
      <section><h3 style={{ marginBottom: 8 }}>Encounter</h3>
        <dl className="kv"><dt>Status</dt><dd>{s.encounter.status.replace('_', ' ')}</dd><dt>Type</dt><dd>{scenarioLabel(s.encounter.scenario)}</dd><dt>Started</dt><dd>{formatTime(s.encounter.created_at)}</dd>
          <dt>Submitted</dt><dd>{formatTime(s.encounter.submitted_at) || '—'}</dd><dt>Assessed</dt><dd>{a ? formatTime(a.created_at) : '—'}</dd>
          <dt>Consent</dt><dd>{s.consentActive === true ? <span className="chip chip--ok">Recorded</span> : s.consentActive === false ? <span className="chip chip--warn">Not recorded</span> : 'Unknown'}</dd></dl></section>
      {a && <section><h3 style={{ marginBottom: 8 }}>Rules used</h3>
        <dl className="kv"><dt>Rule set</dt><dd>{a.note.ruleSet.name}</dd><dt>Version</dt><dd>{a.note.ruleSet.version}</dd><dt>Status</dt><dd>{a.note.ruleSet.status}</dd><dt>Validation</dt><dd>{RULES_CLINICALLY_VALIDATED ? 'Clinically validated' : <span className="chip chip--warn">Not clinically validated</span>}</dd></dl></section>}
      {s.reviews.length > 0 && <section><h3 style={{ marginBottom: 8 }}>Review history</h3>
        <ul>{[...s.reviews].reverse().map(r => (
          <li key={r.id} className="small" style={{ padding: '8px 0', borderBottom: '1px solid var(--rule)' }}>
            <strong>{r.reviewer_name ?? 'A reviewer'}</strong> <span className="muted">· {formatTime(r.created_at)}</span>
            <div>{reviewSentence(r)}</div>
            {r.reason && <div className="muted">{r.reason}</div>}
          </li>))}</ul></section>}
      <p className="tiny muted">This view of the record has been logged.</p>
    </div>
  );
}
