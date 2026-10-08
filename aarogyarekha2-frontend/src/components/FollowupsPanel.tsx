import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../lib/api';
import { formatTime } from '../lib/format';
import type { Api, Followup, FollowupKind, ReminderChannel } from '../lib/types';
import { ConsentForm } from './ConsentForm';
import { Banner } from './Provenance';

const KIND: Record<FollowupKind, string> = { anc_visit: 'Antenatal visit', chronic_checkin: 'Long-term condition check-in', fever_followup: 'Fever follow-up', vaccination: 'Vaccination', custom: 'Other follow-up' };
const CHANNEL: Record<ReminderChannel, string> = { sms: 'SMS', whatsapp: 'WhatsApp', ivr: 'Phone call', in_app: 'In the app' };
const STATUS: Record<string, string> = { scheduled: 'Waiting to be sent', sent: 'Sent', delivered: 'Delivered', failed: 'Not sent', acknowledged: 'Seen by patient', missed: 'Missed' };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'no date');

/**
 * Plan a follow-up visit and schedule reminders for it. A reminder to the patient needs their separate consent. The reminder text is
 * fixed (facility and date only). In this build reminders go through a MOCK sender: nothing is really sent to any phone.
 */
export function FollowupsPanel({ api, encounterId, patientId, editable }: { api: Api; encounterId: string; patientId: string; editable: boolean }) {
  const [list, setList] = useState<Followup[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [kind, setKind] = useState<FollowupKind>('anc_visit');
  const [days, setDays] = useState('7');
  const [repeat, setRepeat] = useState('');
  const [channel, setChannel] = useState<ReminderChannel>('sms');
  const [busy, setBusy] = useState(false);
  const [needConsentFor, setNeedConsentFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setList(await api.followups(encounterId)); setError(null); } catch (e) { setError(e as Error); setList([]); }
  }, [api, encounterId]);
  useEffect(() => { void load(); }, [load]);

  async function plan(e: FormEvent) {
    e.preventDefault();
    const n = Number(days), r = repeat.trim() === '' ? undefined : Number(repeat);
    if (!Number.isInteger(n) || n < 0 || n > 365) { setError(new Error('Days until the visit must be a whole number from 0 to 365.')); return; }
    if (r !== undefined && (!Number.isInteger(r) || r < 1 || r > 365)) { setError(new Error('Repeat every must be a whole number of days from 1 to 365, or empty.')); return; }
    setBusy(true); setError(null);
    try { await api.createFollowup(encounterId, { kind, firstDueInDays: n, ...(r ? { cadenceDays: r } : {}) }); await load(); } catch (err) { setError(err as Error); } finally { setBusy(false); }
  }

  async function remind(id: string) {
    setBusy(true); setError(null);
    try { await api.scheduleReminder(id, { channel }); setNeedConsentFor(null); await load(); }
    catch (err) {
      if (err instanceof ApiError && err.status === 403 && /agreed to reminders/i.test(err.message)) setNeedConsentFor(id); else setError(err as Error);
    } finally { setBusy(false); }
  }

  async function stop(id: string) {
    setBusy(true); setError(null);
    try { await api.stopFollowup(id); await load(); } catch (err) { setError(err as Error); } finally { setBusy(false); }
  }

  return (
    <section className="block" aria-label="Follow-up and reminders">
      <div className="block__head"><h3>Follow-up and reminders</h3></div>
      <div className="block__body">
        <p className="tiny muted">Reminders say only the facility name and the date. In this build they go through a test sender: nothing is sent to a real phone.</p>
        {error && <Banner kind="error" title="Follow-up">{error.message}</Banner>}
        {list === null && <p className="small muted" role="status">Loading…</p>}
        {list && list.length === 0 && !error && <p className="small muted">No follow-up planned.</p>}
        {list && list.map(f => (
          <div key={f.id} style={{ borderTop: '1px solid var(--rule)', paddingTop: 8 }}>
            <p className="small"><strong>{KIND[f.kind]}</strong> · next {day(f.nextDueAt)}{f.cadenceDays ? ` · repeats every ${f.cadenceDays} days` : ''}{!f.active && ' · stopped'}</p>
            {f.reminders.length > 0 && (
              <ul className="small" style={{ margin: '4px 0' }}>
                {f.reminders.map(r => <li key={r.id}>{CHANNEL[r.channel]} on {day(r.due_at)}: {STATUS[r.status] ?? r.status}{r.sent_at ? ` (${formatTime(r.sent_at)})` : ''}</li>)}
              </ul>
            )}
            {editable && f.active && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label className="small" htmlFor={`ch-${f.id}`}>Remind by</label>
                <select id={`ch-${f.id}`} className="select" value={channel} onChange={e => setChannel(e.target.value as ReminderChannel)} disabled={busy}>
                  {(Object.keys(CHANNEL) as ReminderChannel[]).map(c => <option key={c} value={c}>{CHANNEL[c]}</option>)}
                </select>
                <button type="button" className="btn btn--small" onClick={() => void remind(f.id)} disabled={busy}>Schedule reminder</button>
                <button type="button" className="btn btn--small btn--quiet" onClick={() => void stop(f.id)} disabled={busy}>Stop follow-up</button>
              </div>
            )}
            {needConsentFor === f.id && (
              <div style={{ marginTop: 8 }}>
                <ConsentForm api={api} patientId={patientId} purpose="reminders" dialog onCancel={() => setNeedConsentFor(null)} intro={<Banner kind="warn" title="The patient has not agreed to reminders yet">Ask for their consent first. You can also plan the visit without reminders.</Banner>} onRecorded={() => { setNeedConsentFor(null); void remind(f.id); }} />
              </div>
            )}
          </div>
        ))}
        {editable && (
          <form onSubmit={plan} noValidate style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--rule)', paddingTop: 8 }}>
            <div className="field"><label htmlFor="fu-kind">Plan a follow-up</label>
              <select id="fu-kind" className="select" value={kind} onChange={e => setKind(e.target.value as FollowupKind)} disabled={busy}>
                {(Object.keys(KIND) as FollowupKind[]).map(k => <option key={k} value={k}>{KIND[k]}</option>)}
              </select></div>
            <div className="field" style={{ width: 130 }}><label htmlFor="fu-days">Days until visit</label><input id="fu-days" className="input" inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} disabled={busy} /></div>
            <div className="field" style={{ width: 130 }}><label htmlFor="fu-rep">Repeat every (days)</label><input id="fu-rep" className="input" inputMode="numeric" value={repeat} onChange={e => setRepeat(e.target.value)} disabled={busy} /></div>
            <button className="btn btn--small" type="submit" disabled={busy}>Plan follow-up</button>
          </form>
        )}
      </div>
    </section>
  );
}
