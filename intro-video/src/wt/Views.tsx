import type { CSSProperties, ReactNode } from 'react';
import { COLOR, FONT } from '../tokens';
import { BTN, CENTER_W, CENTER_X, type Rect } from './layout';
import { WBox, WBtn, WCheck, WChip, WInput, WLabel, WPlate } from './atoms';
import { MARKS } from './Chrome';
import { cursorAt, DRAG } from './cursor';
import { lin, p, press, typed } from './util';

const abs = (style: CSSProperties): CSSProperties => ({ position: 'absolute', ...style });
const X = CENTER_X;

export const ViewFrame = ({ t, from, to, children }: { t: number; from: number; to: number; children: ReactNode }) => {
  if (t < from || t > to) return null;
  const o = Math.min(p(t, from, from + 0.5), 1 - p(t, to - 0.4, to));
  return <div style={abs({ left: 0, top: 0, width: 1920, height: 1080, opacity: o, translate: `0px ${(1 - p(t, from, from + 0.6)) * 14}px` })}>{children}</div>;
};

/** A control placed exactly on its rectangle (in world pixels), so the cursor's target and the button are the same place. */
const At = ({ b, children }: { b: Rect; children: ReactNode }) => <div style={abs({ left: b.x, top: b.y, width: b.w, height: b.h })}>{children}</div>;

const STEPS: [string, string][] = [['Check-in', 'Add details'], ['Questions', 'Danger signs'], ['Sign-off', 'Reviewer'], ['Visit', 'Call in, refer, finish']];

/** The patient's header and the four-step bar. */
export const PatientHead = ({ t, hoverStep }: { t: number; hoverStep: number }) => {
  const cur = t < 53.4 ? 0 : t < 81.5 ? 1 : t < 95 ? 2 : 3;
  const o = p(t, 20.4, 21.4) * (1 - p(t, 113.2, 114.0));
  return (
    <div style={abs({ left: 0, top: 0, width: 1920, height: 1080, opacity: o })}>
      <div style={abs({ left: X, top: 92, fontSize: 36, fontWeight: 700 })}>Asha Rao</div>
      <div style={abs({ left: X, top: 142, fontSize: 17, color: COLOR.muted })}>AR-0007 · 27 y, female · English · Outpatient queue</div>
      <div style={abs({ left: X, top: 170, fontSize: 19 })}>Fever and cough for three days</div>
      <div style={abs({ left: X, top: 210, width: CENTER_W, height: 84, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', border: `1.5px solid ${COLOR.rule}`, background: COLOR.panel })}>
        {STEPS.map(([name, sub], i) => {
          const on = i === cur; const done = i < cur; const hov = hoverStep === i;
          return (
            <div key={name} style={{ padding: '12px 16px', borderRight: i < 3 ? `1.5px solid ${COLOR.ruleSoft}` : 'none', background: on ? COLOR.actionTint : hov ? '#f5f8f9' : COLOR.panel, boxShadow: on ? `inset 0 -4px 0 ${COLOR.action}` : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 19, fontWeight: on ? 700 : 600 }}>
                <span style={{ width: 26, height: 26, border: `2px solid ${done ? COLOR.green : COLOR.ink}`, display: 'grid', placeItems: 'center', fontSize: 14, color: done ? COLOR.green : COLOR.ink }}>{done ? <WCheck size={16} /> : i + 1}</span>{name}
              </div>
              <div style={{ fontSize: 14, color: COLOR.muted, marginTop: 4, display: 'flex', gap: 8 }}>{sub}{on && <WChip tone="action">Next</WChip>}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Panel = ({ top, h, children, w = CENTER_W, left = X, style }: { top: number; h?: number; children: ReactNode; w?: number; left?: number; style?: CSSProperties }) => (
  <WBox style={{ position: 'absolute', left, top, width: w, height: h, padding: 22, ...style }}>{children}</WBox>
);

/** 1. The next-step card and the consent pop-up. */
export const Consent = ({ t }: { t: number }) => {
  const modal = Math.min(p(t, 27.2, 27.8), 1 - p(t, 30.2, 30.6));
  const done = p(t, 30.4, 30.9);
  return (
    <>
      <Panel top={330} h={300} style={{ borderColor: COLOR.action, borderWidth: 3 }}>
        <WLabel>Next step · nurse or doctor</WLabel>
        <div style={{ fontSize: 30, fontWeight: 700, margin: '12px 0 8px' }}>{done > 0.5 ? 'Consent recorded' : 'Record the patient’s consent'}</div>
        <div style={{ fontSize: 18, color: COLOR.muted, maxWidth: 760, lineHeight: 1.4 }}>{done > 0.5 ? 'Spoken consent from the patient, witnessed by Dr. R. Sen. Triage can start.' : 'Nothing is saved, shared or texted until the patient agrees.'}</div>
      </Panel>
      <At b={BTN.recordConsent}>{done > 0.5 ? <WChip tone="ok">Recorded</WChip> : <WBtn label="Record consent" primary w={BTN.recordConsent.w} h={BTN.recordConsent.h} scale={press(t, 27.0)} />}</At>
      {modal > 0 && (
        <>
          <div style={abs({ left: 0, top: 0, width: 1920, height: 1080, background: 'rgba(21,35,45,0.5)', opacity: modal })} />
          <WBox style={{ position: 'absolute', left: 580, top: 360, width: 760, height: 380, padding: 32, opacity: modal, borderColor: COLOR.ink, borderWidth: 2 }}>
            <div style={{ fontSize: 30, fontWeight: 700 }}>Consent for triage</div>
            <div style={{ fontSize: 18, lineHeight: 1.45, margin: '14px 0 22px', background: COLOR.paper, padding: '12px 16px', borderLeft: `4px solid ${COLOR.rule}` }}>We are recording your symptoms and health readings so the health team can decide who needs to be seen first. A nurse or doctor reviews every result. This system does not diagnose or decide your treatment.</div>
            <span style={abs({ left: 300, top: 276, fontSize: 15, color: COLOR.muted, width: 420 })}>Recorded as spoken consent, witnessed by Dr. R. Sen.</span>
          </WBox>
          <div style={{ ...abs({ left: BTN.agree.x, top: BTN.agree.y, width: BTN.agree.w, height: BTN.agree.h }), opacity: modal }}><WBtn label="Patient agrees" primary w={BTN.agree.w} h={BTN.agree.h} scale={press(t, 29.7)} /></div>
        </>
      )}
    </>
  );
};

const MEAS: [string, string][] = [['Temperature', '38.9 °C'], ['Pulse', '112 /min'], ['Breathing', '26 /min'], ['Oxygen saturation', '93 %'], ['Blood pressure', '100 / 60']];

/** A PDF as a small card on the desktop. */
const FileCard = ({ x, y, o = 1 }: { x: number; y: number; o?: number }) => (
  <div style={abs({ left: x - 110, top: y - 30, width: 220, height: 60, border: `2px solid ${COLOR.ink}`, background: COLOR.panel, display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px', fontSize: 17, fontWeight: 700, opacity: o })}>
    <svg width="26" height="30" viewBox="0 0 24 28" fill="none" stroke={COLOR.red} strokeWidth="2" aria-hidden="true"><path d="M4 2h10l6 6v18H4z" /><path d="M14 2v6h6" /></svg>report.pdf
  </div>
);

/** 2. Check-in: complaint, measurements, a PDF record dragged in and read, and speech. */
export const Checkin = ({ t }: { t: number }) => {
  const dropped = t >= DRAG.to;
  const read = lin(t, 40.9, 43.8);
  const voice = p(t, 46.6, 47.0);
  const wave = t >= 46.8 && t < 48.6;
  const [cx] = cursorAt(t);
  const holding = t >= DRAG.from && t < DRAG.to;
  return (
    <>
      <Panel top={330} h={720}>
        <WLabel>Main complaint</WLabel>
        <div style={{ marginTop: 8 }}><WInput text={typed('Fever and cough for three days', t, 32.3, 34.4)} placeholder="Complaint" h={52} /></div>
        <div style={{ marginTop: 22 }}><WLabel>Measurements</WLabel></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px 18px', marginTop: 8 }}>
          {MEAS.map(([k, v], i) => (
            <div key={k} style={{ opacity: p(t, 34.6 + i * 0.3, 35.0 + i * 0.3) }}>
              <div style={{ fontSize: 14, color: COLOR.muted, fontWeight: 600 }}>{k}</div>
              <WInput text={v} h={44} />
            </div>
          ))}
        </div>
        <div style={{ opacity: p(t, 35.4, 36.0) }}>
          <div style={abs({ left: 22, top: 340, width: 460, height: 200, border: `2px dashed ${dropped || holding ? COLOR.action : COLOR.rule}`, background: dropped || (holding && cx < 960) ? COLOR.actionTint : COLOR.panel, padding: 18 })}>
            <WLabel>Add a record</WLabel>
            {!dropped && <div style={{ fontSize: 17, color: COLOR.muted, marginTop: 14 }}>Drop a PDF, JPEG or PNG here</div>}
            {dropped && (
              <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 18 }}><strong>report.pdf</strong><WChip>Lab report</WChip></div>
                <div style={{ height: 10, background: COLOR.ruleSoft }}><div style={{ height: 10, width: `${read * 100}%`, background: COLOR.action }} /></div>
                <div style={{ fontSize: 16, color: read < 1 ? COLOR.muted : COLOR.green, fontWeight: 600 }}>{read < 1 ? 'Reading on this system…' : 'Read · 17 test results found'}</div>
                {read >= 1 && <div style={{ fontSize: 14, color: COLOR.muted }}>Checked first, then attached to this visit.</div>}
              </div>
            )}
          </div>
          <div style={abs({ left: 500, top: 340, width: 460, height: 200, border: `2px solid ${COLOR.rule}`, padding: 18 })}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ width: BTN.mic.w, height: BTN.mic.h, borderRadius: 31, background: voice > 0.5 ? COLOR.red : COLOR.action, display: 'grid', placeItems: 'center', scale: press(t, 46.6) }}>
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
              </span>
              <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.3 }}>Say it in Hindi,<br />Odia or English</div>
              {wave && <div style={{ display: 'flex', gap: 4, alignItems: 'center', height: 40 }}>{[0, 1, 2, 3, 4, 5].map(i => <span key={i} style={{ width: 5, height: 10 + 24 * Math.abs(Math.sin(t * 9 + i)), background: COLOR.red }} />)}</div>}
            </div>
            <div style={{ fontFamily: FONT.devanagari, fontSize: 26, fontWeight: 600, marginTop: 16, minHeight: 36 }}>{typed('तीन दिन से बुखार और खांसी', t, 48.6, 50.0)}</div>
            <div style={{ fontSize: 14, color: COLOR.muted, opacity: p(t, 50.2, 50.8) }}>In English: fever and cough for three days. Machine translation, not verified.</div>
          </div>
          <div style={abs({ left: 22, top: 570, opacity: p(t, 44.0, 44.6) })}><WChip tone="ok">Records on file · 1 uploaded · 17 results read</WChip></div>
        </div>
      </Panel>
      <At b={BTN.getPriority}><WBtn label="Get the priority" primary w={BTN.getPriority.w} h={BTN.getPriority.h} scale={press(t, 52.4)} /></At>
      <DraggedFile t={t} />
    </>
  );
};

/** 3. The priority: the level and why, the layers, and the records on file. */
export const Priority = ({ t }: { t: number }) => {
  const layers: [string, string, boolean][] = [['Danger-sign rules', 'Urgent', false], ['Early-warning score, adults', 'Very urgent', true], ['Pregnancy blood pressure', 'Not applicable', false]];
  const win = p(t, 59.0, 59.6);
  return (
    <>
      <Panel top={330} left={X} w={470} h={250}>
        <WLabel>Priority · draft</WLabel>
        <div style={{ margin: '14px 0' }}><WPlate tier={2} size={32} /></div>
        <WChip tone="warn">Could be urgent · 11 still needed</WChip>
        <div style={{ fontSize: 14, color: COLOR.muted, marginTop: 14, lineHeight: 1.4 }}>Draft rules, transcribed from published protocols. Not clinically validated.</div>
      </Panel>
      <Panel top={330} left={X + 490} w={510} h={250}>
        <WLabel>Why</WLabel>
        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          {layers.map(([n, r, w], i) => (
            <div key={n} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', fontSize: 17, border: `1.5px solid ${w && win > 0.5 ? COLOR.action : COLOR.ruleSoft}`, background: w && win > 0.5 ? COLOR.actionTint : COLOR.panel, opacity: p(t, 54.4 + i * 0.4, 54.9 + i * 0.4) }}><span style={{ fontWeight: 600 }}>{n}</span><span style={{ color: w && win > 0.5 ? COLOR.action : COLOR.muted, fontWeight: 700 }}>{r}</span></div>
          ))}
        </div>
      </Panel>
      <Panel top={600} left={X} w={CENTER_W} h={230} style={{ opacity: p(t, 57.4, 58.0) }}>
        <WLabel>Records on file · 1 uploaded</WLabel>
        <div style={{ fontSize: 18, margin: '12px 0 8px' }}>17 results read. 2 marked outside the printed range by the lab:</div>
        <div style={{ fontSize: 18, lineHeight: 1.6 }}>Haemoglobin 9.1 g/dL (printed LOW) · WBC count 11,200 /cumm (printed HIGH)</div>
        <div style={{ marginTop: 12 }}><WChip tone="warn">15 results not yet checked by a person</WChip></div>
        <div style={{ fontSize: 14, color: COLOR.muted, marginTop: 10 }}>Copied as printed. It does not change the priority by itself.</div>
      </Panel>
    </>
  );
};

const QS = ['Severe difficulty breathing at rest?', 'Fits during this illness?', 'Confused or hard to wake?'];
const ANS: [number, 'yes' | 'no'][] = [[65.0, 'no'], [66.6, 'no'], [68.2, 'yes']];

/** The app's own Yes | No control: one joined box; Yes turns green with a tick, No turns red with a cross. */
const Seg = ({ i, answer, t }: { i: number; answer?: 'yes' | 'no'; t: number }) => {
  const y = BTN.yes(i); const n = BTN.no(i);
  const cell = (b: Rect, which: 'yes' | 'no') => {
    const on = answer === which;
    const bg = on ? (which === 'yes' ? COLOR.green : COLOR.red) : COLOR.panel;
    return (
      <div style={abs({ left: b.x, top: b.y, width: b.w, height: b.h, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: bg, color: on ? '#fff' : COLOR.ink, fontSize: 18, fontWeight: on ? 700 : 500, scale: press(t, ANS[i]![0]) })}>
        {on && (which === 'yes' ? <WCheck size={18} color="#fff" /> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" /></svg>)}
        {which === 'yes' ? 'Yes' : 'No'}
      </div>
    );
  };
  return (
    <>
      <div style={abs({ left: y.x, top: y.y, width: y.w + n.w, height: y.h, border: `1.5px solid ${COLOR.rule}`, borderRadius: 2 })} />
      {cell(y, 'yes')}{cell(n, 'no')}
      <div style={abs({ left: n.x, top: n.y, width: 1.5, height: n.h, background: COLOR.rule })} />
    </>
  );
};

/** 4. Questions, drawn like the app's "Information still needed" panel: tap, then submit all together. */
export const Questions = ({ t }: { t: number }) => {
  const result = p(t, 70.8, 71.4);
  const answered = (i: number) => (t >= ANS[i]![0] ? ANS[i]![1] : undefined);
  const count = QS.filter((_, i) => !answered(i)).length;
  return (
    <>
      <Panel top={330} h={700} style={{ padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 22px', borderBottom: `1.5px solid ${COLOR.ruleSoft}` }}>
          <span style={{ fontSize: 22, fontWeight: 700 }}>Information still needed</span><WChip>{count}</WChip>
          <span style={{ flex: 1 }} /><span style={{ fontSize: 14, color: COLOR.muted }}>Ranked by how much an answer could change the priority</span>
        </div>
        {QS.map((q, i) => (
          <div key={q} style={abs({ left: 0, right: 0, top: 70 + i * 104, height: 104, padding: '16px 22px', borderBottom: `1.5px solid ${COLOR.ruleSoft}`, opacity: p(t, 64.0 + i * 0.3, 64.5 + i * 0.3) })}>
            <div style={{ fontSize: 21, fontWeight: 600 }}>{q}</div>
            <div style={{ fontSize: 14, color: COLOR.muted, marginTop: 4 }}>{['Checks: severe breathing difficulty', 'Checks: convulsions', 'Checks: reduced alertness'][i]}</div>
          </div>
        ))}
      </Panel>
      {QS.map((q, i) => <div key={q} style={{ opacity: p(t, 64.0 + i * 0.3, 64.5 + i * 0.3) }}><Seg i={i} answer={answered(i)} t={t} /></div>)}
      <At b={BTN.submit}><WBtn label={t >= 70.8 ? 'Submitted' : t >= 70.2 ? 'Submitting…' : 'Submit answers'} primary w={BTN.submit.w} h={BTN.submit.h} scale={press(t, 70.2)} style={{ opacity: t >= 70.2 ? 0.7 : 1 }} /></At>
      <div style={abs({ left: 760, top: 734, width: 640, fontSize: 15, color: COLOR.muted, opacity: p(t, 67.0, 67.6) })}>{t >= 70.2 ? 'The patient is assessed again.' : 'Choose an answer for each question, then submit them together. The patient is assessed again when you submit.'}</div>
      <div style={abs({ left: 482, top: 810, opacity: result, translate: `0px ${(1 - result) * 16}px` })}>
        <WLabel>Assessed again</WLabel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 10 }}><WPlate tier={2} size={22} /><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={COLOR.muted} strokeWidth="2.4" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" /></svg><WPlate tier={1} size={30} /></div>
        <div style={{ fontSize: 15, color: COLOR.muted, marginTop: 10 }}>A Yes on a danger sign raised the level. The queue reorders.</div>
      </div>
    </>
  );
};

const ROWS: [string, string, string, 'agree' | 'differ'][] = [['Haemoglobin', '9.1 g/dL', 'printed LOW', 'agree'], ['WBC count', '11,200 /cumm', 'printed HIGH', 'differ'], ['Platelets', '2.4 lakh/cumm', 'no flag printed', 'agree']];
const CONF = [76.0, 77.6, 79.2];

/** 5. Reports: two readers, every row confirmed by a person. */
export const Reports = ({ t }: { t: number }) => (
  <>
    <Panel top={330} h={470}>
      <WLabel>Reports read · rows as printed</WLabel>
      {ROWS.map(([name, v, flag, a], i) => (
        <div key={name} style={abs({ left: 22, right: 22, top: 50 + i * 120, height: 100, display: 'grid', gridTemplateColumns: '1fr 1fr 150px', alignItems: 'center', gap: 16, borderBottom: i < 2 ? `1.5px solid ${COLOR.ruleSoft}` : 'none', opacity: p(t, 74.2 + i * 0.3, 74.7 + i * 0.3) })}>
          <span><div style={{ fontSize: 22, fontWeight: 700 }}>{name}</div><div style={{ fontSize: 15, color: COLOR.muted }}>{flag}</div></span>
          <span style={{ fontSize: 20 }}>{v}</span>
          <span />
        </div>
      ))}
      <div style={abs({ left: 22, bottom: 16, fontSize: 14, color: COLOR.muted })}>This system is strictly non-diagnostic.</div>
    </Panel>
    {ROWS.map(([, , , a], i) => {
      const ok = t >= CONF[i]! + 0.2;
      const b = BTN.confirmRow(i);
      return (
        <div key={i} style={{ opacity: p(t, 74.2 + i * 0.3, 74.7 + i * 0.3) }}>
          {!ok && <div style={abs({ left: b.x - 260, top: b.y + 6 })}><WChip tone={a === 'differ' ? 'warn' : 'action'}>{a === 'differ' ? 'Check against the report' : 'Read as printed'}</WChip></div>}
          {ok ? <div style={abs({ left: b.x - 120, top: b.y, width: b.w + 120, height: b.h, display: 'flex', justifyContent: 'flex-end', alignItems: 'center' })}><span style={{ display: 'inline-flex', gap: 8, color: COLOR.green, fontWeight: 700, fontSize: 18, alignItems: 'center', whiteSpace: 'nowrap' }}><WCheck size={24} /> Confirmed · Doctor</span></div> : <At b={b}><WBtn label="Confirm" w={b.w} h={b.h} scale={press(t, CONF[i]!)} /></At>}
        </div>
      );
    })}
  </>
);

const SIGNED_T = MARKS.SIGNED;

/** 6. Sign-off: confirm, or change with a reason; lowering needs a second confirmation. */
export const SignOff = ({ t }: { t: number }) => {
  const form = Math.min(p(t, 83.2, 83.7), 1 - p(t, 86.5, 86.9));
  const signed = p(t, SIGNED_T, SIGNED_T + 0.5);
  const tick = t > 85.2;
  return (
    <>
      <Panel top={330} h={700}>
        <div style={{ fontSize: 28, fontWeight: 700 }}>Reviewer sign-off</div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 19, margin: '10px 0 22px' }}>The rules set <WPlate tier={1} size={20} /> Confirm it, or change it and say why. Your name is recorded.</div>
        <div style={abs({ left: 22, top: 575, display: 'flex', gap: 12, flexWrap: 'wrap', opacity: p(t, 87.4, 88.0) })}>
          <WChip>Stale assessment: refused</WChip><WChip>Second factor, if required</WChip><WChip>Recorded under your name. Cannot be removed.</WChip>
        </div>
      </Panel>
      <div style={{ opacity: 1 - signed }}>
        <At b={BTN.confirm}><WBtn label="Confirm priority" primary w={BTN.confirm.w} h={BTN.confirm.h} scale={press(t, 88.4)} /></At>
        <At b={BTN.change}><WBtn label="Change priority" w={BTN.change.w} h={BTN.change.h} scale={press(t, 83.0)} /></At>
      </div>
      <div style={abs({ left: BTN.confirm.x, top: BTN.confirm.y, display: 'flex', alignItems: 'center', gap: 14, height: 56, padding: '0 24px', border: `2px solid ${COLOR.green}`, background: COLOR.greenTint, color: COLOR.green, fontSize: 20, fontWeight: 700, opacity: signed })}><WCheck size={28} /> Signed off · Dr. R. Sen · 10:42</div>
      {form > 0 && (
        <div style={{ opacity: form }}>
          <div style={abs({ left: 482, top: 530, width: 920, height: 340, border: `1.5px solid ${COLOR.rule}`, background: COLOR.panel, padding: 20, display: 'grid', gap: 12, alignContent: 'start' })}>
            <WLabel>Change priority</WLabel>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 18 }}>New priority <WPlate tier={4} size={18} /> Reason <WChip>Reassessed at review</WChip></div>
            <div style={{ padding: '14px 16px', border: `2px solid ${COLOR.yellow}`, background: COLOR.yellowTint, color: COLOR.yellow, fontSize: 17, lineHeight: 1.4 }}>
              <strong>Lower than the rules set (Immediate).</strong> A danger-sign rule set this priority. It is recorded and needs your confirmation.
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}><span style={{ width: 24, height: 24, border: `2px solid ${COLOR.yellow}`, display: 'grid', placeItems: 'center' }}>{tick && <WCheck size={18} color={COLOR.yellow} />}</span>I confirm I am lowering this priority.</div>
            </div>
          </div>
          <At b={BTN.applyChange}><WBtn label="Change priority" primary w={BTN.applyChange.w} h={BTN.applyChange.h} /></At>
          <At b={BTN.cancel}><WBtn label="Cancel" w={BTN.cancel.w} h={BTN.cancel.h} scale={press(t, 86.4)} /></At>
        </div>
      )}
    </>
  );
};

/** 7. The visit: call in. */
export const Visit = ({ t }: { t: number }) => (
  <>
    <Panel top={330} h={330}>
      <div style={{ fontSize: 28, fontWeight: 700 }}>The visit</div>
      <div style={abs({ left: 240, top: 80, height: 56, display: 'flex', alignItems: 'center' })}>{t >= MARKS.CALLED + 0.3 && <WChip tone="action">In consultation · Dr. R. Sen</WChip>}</div>
      <div style={abs({ left: 22, top: 170, opacity: p(t, 97.4, 98.0) })}>
        <WLabel>Select treatment option</WLabel>
        <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>{['Treated here', 'Sent home', 'Did not wait', 'Refer to another facility'].map(x => <WChip key={x}>{x}</WChip>)}</div>
        <div style={{ fontSize: 14, color: COLOR.muted, marginTop: 10 }}>Sending a referral takes the patient off the queue.</div>
      </div>
    </Panel>
    <At b={BTN.callIn}><WBtn label="Call in" primary w={BTN.callIn.w} h={BTN.callIn.h} scale={press(t, MARKS.CALLED)} /></At>
  </>
);

const NOTE = 'Fever, cough, oxygen saturation 93 %. Needs admission for observation and chest imaging.';

/** 8. Referral with a note: a named facility, a reason, a preview, and a frozen copy. */
export const Referral = ({ t }: { t: number }) => {
  const sent = p(t, MARKS.SENT, MARKS.SENT + 0.5);
  return (
    <>
      <Panel top={330} h={640} w={600}>
        <div style={{ fontSize: 28, fontWeight: 700 }}>Referral</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 18, alignItems: 'end', marginTop: 16 }}>
          <div><WLabel>Refer to</WLabel><div style={{ marginTop: 6 }}><WInput text={typed('District Hospital, Bhubaneswar', t, 100.0, 101.8)} placeholder="Receiving facility" /></div></div>
          <div><WLabel>Priority</WLabel><div style={{ marginTop: 10 }}><WPlate tier={1} size={20} /></div></div>
        </div>
        <div style={{ marginTop: 18 }}><WLabel>Reason · note to the receiving facility</WLabel>
          <div style={{ marginTop: 6, minHeight: 110, border: `1.5px solid ${COLOR.rule}`, padding: '12px 14px', fontSize: 18, lineHeight: 1.45 }}>{typed(NOTE, t, 102.0, 106.0)}</div>
        </div>
        <div style={{ marginTop: 16, opacity: p(t, 106.4, 107.0) }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: COLOR.green, fontWeight: 700, fontSize: 18 }}><WCheck size={24} /> Sharing consent recorded</span></div>
        {sent > 0 && <div style={abs({ left: 22, top: 590, opacity: sent })}><WChip tone="ok">Sent · requested · every send and open is logged</WChip></div>}
      </Panel>
      <At b={BTN.preview}><WBtn label="Preview" w={BTN.preview.w} h={BTN.preview.h} scale={press(t, 107.2)} /></At>
      <At b={BTN.send}><WBtn label={t >= 109.4 ? 'Sending…' : 'Send referral'} primary w={BTN.send.w} h={BTN.send.h} scale={press(t, 109.4)} /></At>
    </>
  );
};

/** The referral note as a document, shown beside the form once previewed. */
export const NoteDoc = ({ t }: { t: number }) => {
  const o = p(t, 107.4, 108.0) * (1 - p(t, 113.0, 113.6));
  if (o <= 0) return null;
  return (
    <div style={abs({ left: X + 620, top: 330, width: 380, opacity: o, translate: `${(1 - o) * 30}px 0px` })}>
      <WBox style={{ padding: 20, borderColor: COLOR.ink, borderWidth: 2 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><WLabel>Referral note · PDF</WLabel><WChip tone="warn">{t >= MARKS.SENT ? 'Frozen' : 'Preview'}</WChip></div>
        <div style={{ fontSize: 15, lineHeight: 1.55, marginTop: 10 }}>
          <strong>Patient:</strong> Asha Rao, 27 y, female<br />
          <strong>To:</strong> District Hospital, Bhubaneswar<br />
          <strong>Priority:</strong> Immediate (reviewer-confirmed)<br />
          <strong>Reason:</strong> {NOTE}<br />
          <strong>Records:</strong> 1 report, 17 results<br />
          <strong>Sent by:</strong> Dr. R. Sen
        </div>
        <div style={{ fontSize: 12, color: COLOR.muted, marginTop: 10 }}>No phone number or street address. Frozen when sent.</div>
      </WBox>
    </div>
  );
};

/** The sign-off text message, in the context pane. */
export const Sms = ({ t }: { t: number }) => {
  const o = p(t, 90.4, 91.0) * (1 - p(t, 95.4, 96.0));
  if (o <= 0) return null;
  return (
    <div style={abs({ left: 1524, top: 250, width: 372, opacity: o, translate: `0px ${(1 - o) * 16}px` })}>
      <WBox style={{ padding: 18, borderColor: COLOR.action }}>
        <WLabel>Text message sent · after sign-off</WLabel>
        <div style={{ fontSize: 16, lineHeight: 1.45, margin: '10px 0', padding: '12px 14px', background: COLOR.actionTint, border: `1.5px solid ${COLOR.action}` }}>Hi Asha, your status is IMMEDIATE, so you need immediate attention. Please move ahead quickly to the Khordha PHC triage desk. Reply STOP to stop these messages.</div>
        <div style={{ display: 'flex', gap: 8 }}>{[['English', FONT.sans], ['हिन्दी', FONT.devanagari], ['ଓଡ଼ିଆ', FONT.oriya]].map(([l, f]) => <span key={l} style={{ fontFamily: f, padding: '3px 12px', border: `1.5px solid ${COLOR.rule}`, fontSize: 15, fontWeight: 600 }}>{l}</span>)}</div>
        <div style={{ fontSize: 13, color: COLOR.muted, marginTop: 8 }}>One message, in the patient’s language, only with consent.</div>
      </WBox>
    </div>
  );
};

/** The report on the desktop (bottom right of the view), picked up by the cursor and carried to the drop zone. */
export const DraggedFile = ({ t }: { t: number }) => {
  const [cx, cy] = cursorAt(t);
  return (
    <>
      {t >= 35.8 && t < DRAG.from && <FileCard x={1380} y={950} o={p(t, 35.8, 36.4)} />}
      {t >= DRAG.from && t < DRAG.to && <FileCard x={cx} y={cy} />}
    </>
  );
};

/** All the centre views, with the patient header above them (kept for reference; the walkthrough places each on its own layer). */
export const Center = ({ t, hoverStep }: { t: number; hoverStep: number }) => (
  <>
    <PatientHead t={t} hoverStep={hoverStep} />
    <ViewFrame t={t} from={24.8} to={31.6}><Consent t={t} /></ViewFrame>
    <ViewFrame t={t} from={31.4} to={53.8}><Checkin t={t} /></ViewFrame>
    <ViewFrame t={t} from={53.6} to={63.8}><Priority t={t} /></ViewFrame>
    <ViewFrame t={t} from={63.6} to={74.2}><Questions t={t} /></ViewFrame>
    <ViewFrame t={t} from={74.0} to={81.8}><Reports t={t} /></ViewFrame>
    <ViewFrame t={t} from={81.6} to={95.4}><SignOff t={t} /></ViewFrame>
    <ViewFrame t={t} from={95.2} to={99.6}><Visit t={t} /></ViewFrame>
    <ViewFrame t={t} from={99.4} to={113.0}><Referral t={t} /></ViewFrame>
  </>
);
