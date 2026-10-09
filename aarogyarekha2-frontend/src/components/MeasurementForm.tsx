import { useState, type FormEvent } from 'react';
import type { Api } from '../lib/types';
import { Banner } from './Provenance';

export const MEASUREMENTS: { kind: string; label: string; unit: string; min: number; max: number }[] = [
  { kind: 'temperature_c', label: 'Temperature', unit: '°C', min: 25, max: 45 },
  { kind: 'pulse_bpm', label: 'Pulse', unit: 'per minute', min: 20, max: 250 },
  { kind: 'resp_rate_pm', label: 'Breathing rate', unit: 'per minute', min: 4, max: 80 },
  { kind: 'spo2_pct', label: 'Oxygen saturation (SpO2)', unit: '%', min: 50, max: 100 },
  { kind: 'bp_systolic_mmhg', label: 'Blood pressure, top number', unit: 'mmHg', min: 40, max: 300 },
  { kind: 'bp_diastolic_mmhg', label: 'Blood pressure, bottom number', unit: 'mmHg', min: 20, max: 200 },
  { kind: 'blood_glucose_mgdl', label: 'Blood sugar', unit: 'mg/dL', min: 10, max: 900 },
  { kind: 'weight_kg', label: 'Weight', unit: 'kg', min: 0.3, max: 400 },
  { kind: 'height_cm', label: 'Height', unit: 'cm', min: 20, max: 250 },
  { kind: 'muac_cm', label: 'Mid-upper arm size (MUAC)', unit: 'cm', min: 3, max: 60 },
];

export function MeasurementForm({ api, encounterId, onSaved }: { api: Api; encounterId: string; onSaved: () => void }) {
  const [kind, setKind] = useState(MEASUREMENTS[0]!.kind);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const m = MEASUREMENTS.find(x => x.kind === kind)!;

  async function submit(e: FormEvent) {
    e.preventDefault(); setSaved(null);
    const n = Number(value);
    if (value.trim() === '' || !Number.isFinite(n)) { setError('Type a number.'); return; }
    if (n < m.min || n > m.max) { setError(`${m.label} should be between ${m.min} and ${m.max} ${m.unit}. Check the number.`); return; }
    setBusy(true); setError(null);
    try { await api.addVital(encounterId, { kind, value: n }); setSaved(`${m.label} ${n} ${m.unit} saved.`); setValue(''); onSaved(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="block" aria-label="Add a measurement by hand">
      <div className="block__head"><h3>Add a measurement</h3></div>
      <div className="block__body">
        <p className="tiny muted">Type a reading by hand, for example when a report could not be read. Assess again afterwards.</p>
        {error && <Banner kind="error">{error}</Banner>}
        <form onSubmit={submit} noValidate style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field"><label htmlFor="ms-kind">Measurement</label><select id="ms-kind" className="select" value={kind} onChange={e => { setKind(e.target.value); setError(null); }} disabled={busy}>{MEASUREMENTS.map(x => <option key={x.kind} value={x.kind}>{x.label}</option>)}</select></div>
          <div className="field" style={{ width: 140 }}><label htmlFor="ms-val">Value ({m.unit})</label><input id="ms-val" className="input" inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} disabled={busy} /></div>
          <button className="btn btn--small" type="submit" disabled={busy}>Save</button>
        </form>
        {saved && <p className="small" role="status">{saved}</p>}
      </div>
    </section>
  );
}
