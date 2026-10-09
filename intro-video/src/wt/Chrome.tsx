import type { CSSProperties, ReactNode } from 'react';
import { COLOR, FONT, type Tier } from '../tokens';
import { H, ROW_H, ROW_Y, TOPBAR, W, QUEUE_W, CONTEXT_X } from './layout';
import { WBtn, WChip, WNotAssessed, WPlate } from './atoms';
import { p, press, track, typed } from './util';

const abs = (style: CSSProperties): CSSProperties => ({ position: 'absolute', ...style });

/** The sign-in screen. Types the address and password, then the button is pressed (the cursor does the click). */
export const Login = ({ t }: { t: number }) => {
  const email = typed('doctor@khordhaphc.example', t, 1.1, 2.3);
  const pw = '•'.repeat(Math.round(10 * p(t, 3.1, 3.9)));
  return (
    <div style={abs({ left: 700, top: 270, width: 520, background: COLOR.panel, border: `1.5px solid ${COLOR.rule}` })}>
      <div style={{ background: COLOR.ink, color: '#fff', padding: '22px 30px' }}>
        <div style={{ fontSize: 30, fontWeight: 700 }}>AarogyaRekha</div>
        <div style={{ fontSize: 16, color: '#d5dde2', marginTop: 4 }}>Triage support for the first desk</div>
      </div>
      <div style={{ padding: 30, display: 'grid', gap: 18 }}>
        <div style={{ display: 'grid', gap: 6 }}><span style={{ fontSize: 15, fontWeight: 600 }}>Email</span><span style={{ height: 56, display: 'flex', alignItems: 'center', padding: '0 14px', border: `1.5px solid ${t > 1 && t < 2.6 ? COLOR.action : COLOR.rule}`, fontSize: 19 }}>{email}</span></div>
        <div style={{ display: 'grid', gap: 6 }}><span style={{ fontSize: 15, fontWeight: 600 }}>Password</span><span style={{ height: 56, display: 'flex', alignItems: 'center', padding: '0 14px', border: `1.5px solid ${t >= 3.0 && t < 4.5 ? COLOR.action : COLOR.rule}`, fontSize: 22, letterSpacing: 3 }}>{pw}</span></div>
        <WBtn label={t > 4.6 ? 'Signing in…' : 'Sign in'} primary h={60} scale={press(t, 4.6)} style={{ width: '100%', opacity: p(t, 3.1, 3.9) > 0.5 ? 1 : 0.55 }} />
      </div>
      <div style={{ padding: '14px 30px', borderTop: `1.5px solid ${COLOR.ruleSoft}`, fontSize: 14, color: COLOR.muted }}>Organises information for review. Does not diagnose or advise treatment.</div>
    </div>
  );
};

const NAV: [string, number][] = [['Queue', 280], ['Scenarios', 370], ['Referrals', 477], ['Offline notes', 594], ['Emergency access', 742]];
const TIPS: [number, number, number, string][] = [[1, 9.2, 10.1, 'Waiting lists by scenario'], [2, 10.1, 11.0, 'Sent and received'], [3, 11.0, 11.9, 'Kept on this computer'], [4, 11.9, 12.8, 'A reason, a short window, reviewed after']];

export const Topbar = ({ t }: { t: number }) => (
  <>
    <div style={abs({ left: 0, top: 0, width: W, height: TOPBAR, background: COLOR.ink })}>
      <span style={abs({ left: 24, top: 15, color: '#fff', fontSize: 24, fontWeight: 700 })}>AarogyaRekha</span>
      {NAV.map(([n, cx], i) => (
        <span key={n} style={abs({ left: cx, top: 19, translate: '-50% 0', color: '#fff', fontSize: 18, fontWeight: i === 0 ? 700 : 500, borderBottom: i === 0 ? '3px solid #fff' : 'none', paddingBottom: 4, whiteSpace: 'nowrap' })}>{n}</span>
      ))}
      <span style={abs({ left: 880, top: 20, color: '#fff', fontSize: 17, fontWeight: 700 })}>Khordha PHC</span>
      <span style={abs({ left: 1090, top: 21, color: '#fff', fontSize: 16 })}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: '#4ade80', marginRight: 8 }} />Connected</span>
      <span style={abs({ right: 24, top: 12, display: 'flex', gap: 16 })}>
        <WBtn label="New patient" primary h={40} style={{ background: COLOR.action, borderColor: '#fff' }} />
        <WBtn label="Switch patient" h={40} style={{ background: 'transparent', color: '#fff', borderColor: '#fff' }} />
        <WBtn label="Doctor · Dr. R. Sen ▾" h={40} style={{ background: 'transparent', color: '#fff', borderColor: '#fff', fontSize: 16 }} />
      </span>
    </div>
    {TIPS.map(([i, a, b, text]) => {
      const o = Math.min(p(t, a, a + 0.25), 1 - p(t, b - 0.25, b));
      return o > 0 ? <span key={text} style={abs({ left: NAV[i]![1], top: 74, translate: '-50% 0', opacity: o, background: COLOR.ink, color: '#fff', fontSize: 15, padding: '7px 12px', whiteSpace: 'nowrap', borderRadius: 2 })}>{text}</span> : null;
    })}
  </>
);

interface Pt { id: string; name: string; who: string; note: string; tier: (t: number) => Tier | null; chip: (t: number) => { text: string; tone: 'plain' | 'action' | 'warn' | 'ok' } | null; slot: (t: number) => number; gone: number; leaveFrom: number }

const AS = 53.2;       // Asha is assessed
const UP = 70.8;       // her priority goes up to Immediate
const SIGNED = 89.6;
const CALLED = 96.6;
const SENT = 111.6;

const PATIENTS: Pt[] = [
  {
    id: 'G', name: 'Gopal Behera', who: '61 y, male', note: 'Chest tightness since morning', gone: 116.4, leaveFrom: 115.6,
    tier: () => 2, slot: t => track(t, [UP, UP + 1, SENT + 0.6, SENT + 1.6, 116, 116.8], [0, 1, 1, 0, 0, 0]),
    chip: t => (t >= 115.4 ? { text: 'Treated here', tone: 'ok' } : t >= 113.6 ? { text: 'In consultation', tone: 'action' } : { text: 'Needs sign-off', tone: 'plain' }),
  },
  {
    id: 'A', name: 'Asha Rao', who: '27 y, female', note: 'Fever and cough for three days', gone: 112.6, leaveFrom: 111.9,
    tier: t => (t < AS ? null : t < UP ? 2 : 1), slot: t => track(t, [UP, UP + 1], [1, 0]),
    chip: t => (t >= SENT ? { text: 'Referred', tone: 'ok' } : t >= CALLED ? { text: 'In consultation', tone: 'action' } : t >= SIGNED ? null : t >= UP ? { text: 'Needs sign-off', tone: 'plain' } : t >= AS ? { text: 'Could be urgent · 11 still needed', tone: 'warn' } : null),
  },
  {
    id: 'P', name: 'Priya Sahu', who: '34 y, female', note: 'Cough and sore throat for four days', gone: 119.0, leaveFrom: 118.2,
    tier: () => 3, slot: t => track(t, [SENT + 0.6, SENT + 1.6, 116, 116.8], [2, 1, 1, 0]),
    chip: t => (t >= 117.8 ? { text: 'Treated here', tone: 'ok' } : t >= 116.6 ? { text: 'In consultation', tone: 'action' } : { text: 'Waiting long', tone: 'plain' }),
  },
  {
    id: 'R', name: 'Ravi Das', who: '44 y, male', note: 'Routine blood pressure check', gone: 121.0, leaveFrom: 120.2,
    tier: () => 4, slot: t => track(t, [SENT + 0.6, SENT + 1.6, 116, 116.8, 119, 119.8], [3, 2, 2, 1, 1, 0]),
    chip: t => (t >= 119.8 ? { text: 'Treated here', tone: 'ok' } : t >= 118.8 ? { text: 'In consultation', tone: 'action' } : null),
  },
];

export const QueuePane = ({ t, hover, selected }: { t: number; hover: number; selected: boolean }) => {
  const waiting = PATIENTS.filter(x => t < x.gone).length;
  const inReview = PATIENTS.filter(x => x.chip(t)?.text === 'In consultation').length;
  const notAssessed = t < AS && PATIENTS[1]!.gone > t ? 1 : 0;
  return (
    <div style={abs({ left: 0, top: TOPBAR, width: QUEUE_W, height: H - TOPBAR, background: COLOR.panel, borderRight: `1.5px solid ${COLOR.rule}` })}>
      <div style={abs({ left: 24, top: 18, fontSize: 24, fontWeight: 700 })}>Queue <span style={{ fontSize: 16, fontWeight: 400, color: COLOR.muted }}>{waiting} waiting</span></div>
      <span style={abs({ right: 14, top: 14, display: 'flex', gap: 8 })}>
        <WBtn label="Refresh" h={36} style={{ fontSize: 15, padding: '0 12px' }} />
        <WBtn label="New intake" primary h={36} style={{ fontSize: 15, padding: '0 12px' }} />
      </span>
      <div style={abs({ left: 24, top: 74, fontSize: 16 })}><strong>{waiting} waiting</strong> · {notAssessed} not assessed</div>
      <div style={abs({ left: 24, top: 100, fontSize: 15, color: COLOR.muted })}>{inReview} in review · <u>Done today</u></div>
      {PATIENTS.map((x, idx) => {
        const slot = x.slot(t);
        const out = p(t, x.leaveFrom, x.gone);
        const tier = x.tier(t);
        const chip = x.chip(t);
        const isSel = x.id === 'A' && selected;
        const hov = x.id === 'A' && hover === 1;
        return (
          <div key={x.id} style={abs({ left: 0, top: ROW_Y(slot) - TOPBAR + 0, width: QUEUE_W, height: ROW_H, padding: '12px 24px', borderBottom: `1.5px solid ${COLOR.ruleSoft}`, background: isSel ? COLOR.actionTint : hov ? '#f5f8f9' : COLOR.panel, boxShadow: isSel ? `inset 5px 0 0 ${COLOR.action}` : 'none', translate: `${-out * 440}px 0px`, opacity: 1 - out, display: idx >= 0 && t >= x.gone ? 'none' : 'block' })}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <span style={{ fontSize: 19, fontWeight: 700 }}>{x.name} <span style={{ fontSize: 15, fontWeight: 400, color: COLOR.muted }}>{x.who}</span></span>
              {tier ? <WPlate tier={tier} size={15} /> : <WNotAssessed size={15} />}
            </div>
            <div style={{ fontSize: 15, color: COLOR.muted, marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.note}</div>
            {chip && <div style={{ marginTop: 8 }}><WChip tone={chip.tone}>{chip.text}</WChip></div>}
          </div>
        );
      })}
      {t >= 121.2 && <div style={abs({ left: 24, top: 220, opacity: p(t, 121.2, 122), fontSize: 20, color: COLOR.muted })}>Nobody is waiting.</div>}
    </div>
  );
};

export const ContextPane = ({ t, children }: { t: number; children?: ReactNode }) => (
  <div style={abs({ left: CONTEXT_X, top: TOPBAR, width: W - CONTEXT_X, height: H - TOPBAR, background: COLOR.panel, borderLeft: `1.5px solid ${COLOR.rule}` })}>
    <div style={{ padding: '18px 24px', fontSize: 22, fontWeight: 700, borderBottom: `1.5px solid ${COLOR.ruleSoft}` }}>Context</div>
    <div style={{ padding: 24, fontSize: 16, color: COLOR.muted, lineHeight: 1.45 }}>Intake adds a patient to the queue. Consent is checked on the server before anything is saved.</div>
    {children}
    <span style={{ display: 'none' }}>{t}</span>
  </div>
);

export const paperStyle: CSSProperties = { position: 'absolute', left: 0, top: 0, width: W, height: H, background: COLOR.paper, fontFamily: FONT.sans, color: COLOR.ink };
export const MARKS = { AS, UP, SIGNED, CALLED, SENT };
