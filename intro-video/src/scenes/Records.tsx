import { RECORD, SCENES } from '../scenes';
import { COLOR, SIZE } from '../tokens';
import { Caption, Chip, Panel, ramp, SceneFrame, useSlow } from '../ui';

const TOP = SIZE.edgeY;
const HEIGHT = 660;
const typed = (text: string, p: number) => text.slice(0, Math.round(text.length * p));

const Field = ({ label, value, p }: { label: string; value: string; p: number }) => (
  <div style={{ display: 'grid', gap: 6 }}>
    <span style={{ fontSize: SIZE.uiSmall, color: COLOR.muted, fontWeight: 600 }}>{label}</span>
    <span style={{ height: 68, display: 'flex', alignItems: 'center', padding: '0 18px', border: `2px solid ${COLOR.rule}`, background: COLOR.panel, fontSize: SIZE.ui, fontWeight: 600, borderRadius: SIZE.radius }}>{typed(value, p)}</span>
  </div>
);

/** 3 to 8 s. A report comes in. The form fills in who it is about, and the result rows appear as printed. */
export const Records = () => {
  const frame = useSlow();
  const lines = ['Haemoglobin  9.1 g/dL  12.0 - 15.5  L', 'WBC Count  11,200 /cumm  4000 - 11000  H', 'Platelet Count  2.4 lakh/cumm  1.5 - 4.5'];
  const idAt = 26;
  return (
    <SceneFrame>
      <Panel style={{ position: 'absolute', left: SIZE.edgeX, top: TOP, width: 540, height: HEIGHT, padding: 32, opacity: ramp(frame, 0, 12), translate: `${(1 - ramp(frame, 0, 22)) * -90}px 0px` }}>
        <div style={{ fontSize: SIZE.ui, fontWeight: 700 }}>{RECORD.title}</div>
        <div style={{ height: 2, background: COLOR.ink, margin: '14px 0 18px' }} />
        <div style={{ fontSize: 26, display: 'grid', gap: 10, lineHeight: 1.3 }}>
          <div style={{ padding: '4px 8px', background: ramp(frame, idAt, idAt + 6) > 0 ? COLOR.actionTint : 'transparent', margin: '0 -8px' }}>Name: {RECORD.form.name}</div>
          <div style={{ padding: '4px 8px', background: ramp(frame, idAt + 22, idAt + 28) > 0 ? COLOR.actionTint : 'transparent', margin: '0 -8px' }}>Age / Sex: {RECORD.form.age} Y / F</div>
        </div>
        <div style={{ height: 2, background: COLOR.ruleSoft, margin: '22px 0' }} />
        <div style={{ fontSize: 24, display: 'grid', gap: 14, lineHeight: 1.3 }}>
          {lines.map((l, i) => (
            <div key={l} style={{ padding: '4px 8px', margin: '0 -8px', background: ramp(frame, 72 + i * 16, 78 + i * 16) > 0 ? COLOR.actionTint : 'transparent', whiteSpace: 'nowrap' }}>{l}</div>
          ))}
        </div>
      </Panel>

      <Panel style={{ position: 'absolute', left: 720, top: TOP, width: 520, height: HEIGHT, padding: 32, display: 'grid', gap: 22, alignContent: 'start', opacity: ramp(frame, 16, 28) }}>
        <div style={{ fontSize: SIZE.ui, fontWeight: 700 }}>Register patient</div>
        <Field label="Name" value={RECORD.form.name} p={ramp(frame, idAt, idAt + 18)} />
        <Field label="Age in years" value={RECORD.form.age} p={ramp(frame, idAt + 22, idAt + 28)} />
        <Field label="Sex" value={RECORD.form.sex} p={ramp(frame, idAt + 30, idAt + 38)} />
        <div style={{ fontSize: SIZE.uiSmall, color: COLOR.muted, opacity: ramp(frame, idAt + 40, idAt + 52) }}>Read from the record. Check it is right.</div>
      </Panel>

      <Panel style={{ position: 'absolute', left: 1320, top: TOP, width: 480, height: HEIGHT, padding: 32, display: 'grid', gap: 18, alignContent: 'start', opacity: ramp(frame, 62, 74) }}>
        <div style={{ fontSize: SIZE.ui, fontWeight: 700 }}>Results read</div>
        {RECORD.rows.map((r, i) => {
          const at = 78 + i * 16;
          return (
            <div key={r.test} style={{ display: 'grid', gap: 6, paddingBottom: 14, borderBottom: i < 2 ? `2px solid ${COLOR.ruleSoft}` : 'none', opacity: ramp(frame, at, at + 10), translate: `0px ${(1 - ramp(frame, at, at + 14)) * 18}px` }}>
              <span style={{ fontSize: SIZE.ui, fontWeight: 700 }}>{r.test}</span>
              <span style={{ fontSize: SIZE.ui }}>{r.value}</span>
              <span style={{ fontSize: SIZE.uiSmall, color: COLOR.muted }}>{r.flag || 'no flag printed'}</span>
            </div>
          );
        })}
        <div style={{ opacity: ramp(frame, 130, 142), translate: `0px ${(1 - ramp(frame, 130, 144)) * 10}px` }}><Chip tone="action">{RECORD.agree}</Chip></div>
      </Panel>
      <Caption delay={10}>{SCENES[1].caption}</Caption>
    </SceneFrame>
  );
};
