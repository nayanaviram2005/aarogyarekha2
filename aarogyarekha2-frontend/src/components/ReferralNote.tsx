import { useEffect, useRef } from 'react';
import { formatAge, formatSex, formatTime, languageLabel, PRIORITY_LABEL } from '../lib/format';
import type { FhirBundle, ReferralView } from '../lib/types';
import { Narrative } from './Narrative';
import { UrgencyPlate } from './Plate';
import { SHOW_HACKATHON_BAR } from '../config';

type Res = { resourceType: string; id?: string; [k: string]: any };
const all = (b: FhirBundle, type: string): Res[] => (b.entry ?? []).map(e => e.resource as Res).filter(r => r.resourceType === type);
const first = (b: FhirBundle, type: string): Res | undefined => all(b, type)[0];

const TIER_OF_PRIORITY = { stat: 1, asap: 2, urgent: 3, routine: 4 } as const;
const SECTION_ORDER = ['Reported complaint', 'Symptoms reported', 'Measurements', 'Danger-sign checks'];
const NOTICE = 'Organises information for review. Does not diagnose or advise treatment.';

const measurement = (o: Res): string => {
  const label = o.code?.text ?? o.code?.coding?.[0]?.display ?? 'Measurement';
  const q = o.valueQuantity as { value?: number; unit?: string } | undefined;
  const parts = ((o.component ?? []) as Res[]).map(c => `${c.code?.coding?.[0]?.display ?? c.code?.text ?? ''} ${c.valueQuantity?.value ?? ''} ${c.valueQuantity?.unit ?? ''}`.trim());
  return `${label}: ${q ? `${q.value} ${q.unit ?? ''}`.trim() : parts.join(', ')}`;
};
const isAge = (o: Res) => o.code?.coding?.[0]?.code === '30525-0';

export interface NoteSection { title: string; lines?: string[]; xhtml?: string }

export function readNote(bundle: FhirBundle, facilities: { from?: string | null; to?: string | null } = {}) {
  const comp = first(bundle, 'Composition');
  const patient = first(bundle, 'Patient');
  const sr = first(bundle, 'ServiceRequest');
  const orgs = all(bundle, 'Organization');
  const org = (id: string | undefined) => orgs.find(o => o.id === id);
  const idOf = (ref?: string) => ref?.split('/')[1];
  const ext = ((sr?.extension as Res[] | undefined)?.[0]?.extension as Res[] | undefined) ?? [];
  const x = (url: string) => ext.find(e => e.url === url);
  const ageExt = (patient?.extension as Res[] | undefined)?.find(e => String(e.url).endsWith('/age-years-reported'));
  const ageObs = all(bundle, 'Observation').find(isAge)?.valueQuantity as { value?: number } | undefined;
  const priority = sr?.priority as 'routine' | 'urgent' | 'asap' | 'stat' | undefined;

  let sections: NoteSection[];
  let changed = x('changedByReviewer')?.valueBoolean as boolean | undefined;
  if (comp) {
    sections = ((comp.section as { title: string; text?: { div?: string } }[] | undefined) ?? []).map(s => ({ title: s.title, xhtml: s.text?.div ?? '' }));
  } else {
    const named = new Map<string, string[]>(); const rest: NoteSection[] = [];
    for (const n of (sr?.note ?? []) as { text?: string }[]) {
      const text = String(n.text ?? ''); const cut = text.indexOf(': ');
      if (cut < 0) continue;
      const title = text.slice(0, cut); const lines = text.slice(cut + 2).split('; ').map(l => l.trim()).filter(Boolean);
      if (SECTION_ORDER.includes(title)) named.set(title, lines); else rest.push({ title, lines });
      if (title.startsWith('Review priority') && /A reviewer changed this priority/.test(text)) changed = true;
    }
    const measurements = all(bundle, 'Observation').filter(o => !isAge(o)).map(measurement);
    if (measurements.length) named.set('Measurements', measurements);
    const reason = sr?.reasonCode?.[0]?.text as string | undefined;
    sections = [
      ...(reason ? [{ title: 'Reason for referral', lines: [reason] }] : []),
      ...SECTION_ORDER.filter(t => named.has(t)).map(t => ({ title: t, lines: named.get(t)! })),
      ...rest, { title: 'Notice', lines: [NOTICE] },
    ];
  }
  return {
    title: (comp?.title as string) ?? 'Referral note',
    sections,
    from: (org(idOf(comp?.custodian?.reference))?.name as string | undefined) ?? facilities.from ?? undefined,
    to: (org(idOf(sr?.performer?.[0]?.reference))?.name as string | undefined) ?? facilities.to ?? undefined,
    patient: patient ? {
      name: (patient.name?.[0]?.text as string) ?? 'Name not recorded',
      ref: (patient.identifier as { system: string; value: string }[] | undefined)?.find(i => i.system.endsWith('/public-ref'))?.value,
      sex: (patient.gender as 'female' | 'male' | 'other' | 'unknown') ?? 'unknown',
      age: formatAge({ birth_date: (patient.birthDate as string) ?? null, age_years_reported: (ageExt?.valueInteger as number) ?? ageObs?.value ?? null }),
      language: patient.communication?.[0]?.language?.coding?.[0]?.code as string | undefined,
    } : null,
    priority,
    tier: (x('tier')?.valueInteger as number | undefined) ?? (priority ? TIER_OF_PRIORITY[priority] : undefined),
    changed,
    reviewer: comp?.attester?.[0]?.party?.display as string | undefined,
    reviewedAt: comp?.attester?.[0]?.time as string | undefined,
    status: (comp?.status as string | undefined) ?? (sr?.status === 'active' ? 'final' : sr?.status === 'draft' ? 'preliminary' : undefined),
  };
}

const Lines = ({ lines }: { lines: string[] }) => (lines.length === 1 ? <p>{lines[0]}</p> : <ul>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>);

export function ReferralNote({ view, onClose, onDownload }: { view: ReferralView; onClose: () => void; onDownload?: () => void }) {
  const n = readNote(view.bundle, { from: view.fromFacility, to: view.referral.toFacility?.name });
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const sent = !view.preview;
  return (
    <div className="note-overlay" role="dialog" aria-modal="true" aria-label="Referral note">
      <div className="note-toolbar">
        <strong>{sent ? 'Referral note' : 'Referral note: preview, not sent'}</strong>
        <span className="grow" />
        {onDownload && <button className="btn btn--small" onClick={onDownload}>Download FHIR file</button>}
        <button className="btn btn--small" onClick={() => window.print()}>Print</button>
        <button ref={closeRef} className="btn btn--small btn--primary" onClick={onClose}>Close</button>
      </div>
      <article className="note-print">
        {!sent && <p className="note-draft">PREVIEW. This referral has not been sent.</p>}
        <header>
          <h2>{n.title}</h2>
          <p className="small">From <strong>{n.from ?? 'the referring facility'}</strong> to <strong>{n.to ?? 'the receiving facility'}</strong></p>
          {sent && view.referral.sentAt && <p className="small muted">Sent {formatTime(view.referral.sentAt)}</p>}
        </header>

        <section className="note-patient">
          {n.patient ? (
            <dl className="kv">
              <dt>Patient</dt><dd><strong>{n.patient.name}</strong></dd>
              {n.patient.ref && <><dt>Record</dt><dd>{n.patient.ref}</dd></>}
              <dt>Age, sex</dt><dd>{n.patient.age}, {formatSex(n.patient.sex).toLowerCase()}</dd>
              {n.patient.language && <><dt>Language</dt><dd>{languageLabel(n.patient.language)}</dd></>}
            </dl>
          ) : <p className="muted">Patient details are not in this document.</p>}
        </section>

        <section className="note-priority">
          <h3>Priority</h3>
          <p style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <UrgencyPlate tier={n.tier ?? null} assessed={n.tier != null} large />
            {n.priority && <span>Referral request: <strong>{PRIORITY_LABEL[n.priority]}</strong></span>}
          </p>
          {n.changed && <p className="small">A reviewer changed the priority from what the rules concluded.</p>}
        </section>

        {n.sections.map((s, i) => (
          <section key={i} className="note-section">
            <h3>{s.title}</h3>
            {s.xhtml ? <Narrative xhtml={s.xhtml} /> : s.lines?.length ? <Lines lines={s.lines} /> : <p className="muted">Nothing recorded.</p>}
          </section>
        ))}

        <footer className="note-foot">
          {n.reviewer ? <p>Priority signed off by <strong>{n.reviewer}</strong>{n.reviewedAt ? `, ${formatTime(n.reviewedAt)}` : ''}.</p> : view.readiness.signedOff ? <p>The priority has been signed off by a nurse or doctor.</p> : <p>The priority has not been signed off.</p>}
          {SHOW_HACKATHON_BAR && <p className="tiny" style={{ marginTop: 8, fontWeight: 600 }}>Hackathon prototype. Synthetic data only. Triage rules are not clinically validated. Not for use with real patients.</p>}
          {sent && view.referral.bundleSha256 && <p className="tiny muted">Document checksum (SHA-256): {view.referral.bundleSha256.slice(0, 16)}…</p>}
        </footer>
      </article>
    </div>
  );
}
