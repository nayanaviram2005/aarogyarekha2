import { interpolate } from 'remotion';
import { PATIENTS, SCENES } from '../scenes';
import { COLOR, EASE_INOUT, SIZE } from '../tokens';
import { Caption, Chip, Panel, Plate, ramp, SceneFrame, useSlow } from '../ui';

const ROW = 118;
const HEAD = 64;
const TOP = 150;

/** 13 to 18 s. The same four people, now each with a priority, slide into priority order. */
export const Queue = () => {
  const frame = useSlow();
  const slide = ramp(frame, 40, 90, EASE_INOUT);
  // arrival order index -> sorted order index (tier 1 first)
  const sorted = [...PATIENTS].sort((a, b) => a.tier - b.tier);
  return (
    <SceneFrame>
      <Panel style={{ position: 'absolute', left: SIZE.edgeX, right: SIZE.edgeX, top: TOP, height: HEAD + ROW * PATIENTS.length, overflow: 'hidden', opacity: ramp(frame, 0, 12) }}>
        <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr 330px', alignItems: 'center', height: HEAD, padding: '0 32px', background: COLOR.paper, borderBottom: `2px solid ${COLOR.rule}`, fontSize: SIZE.uiSmall, fontWeight: 700, color: COLOR.muted, letterSpacing: 2, textTransform: 'uppercase' }}>
          <span>Patient</span><span>Complaint</span><span>Priority</span>
        </div>
        <div style={{ position: 'relative' }}>
          {PATIENTS.map((p, i) => {
            const to = sorted.findIndex(x => x.ref === p.ref);
            const y = interpolate(slide, [0, 1], [i * ROW, to * ROW]);
            const plateIn = ramp(frame, 14 + i * 5, 26 + i * 5);
            const tag = p.ref === '0412' || p.ref === '0415' ? 'Needs sign-off' : p.ref === '0409' ? 'Could be urgent · 3 still needed' : '';
            const warn = p.ref === '0409';
            return (
              <div key={p.ref} style={{ position: 'absolute', left: 0, right: 0, top: 0, translate: `0px ${y}px`, display: 'grid', gridTemplateColumns: '170px 1fr 330px', alignItems: 'center', height: ROW, padding: '0 32px', borderBottom: `2px solid ${COLOR.ruleSoft}`, background: COLOR.panel, fontSize: SIZE.ui }}>
                <span><strong>{p.ref}</strong><br /><span style={{ color: COLOR.muted, fontSize: SIZE.uiSmall }}>{p.who}</span></span>
                <span>{p.complaint}{tag && <><br /><span style={{ opacity: ramp(frame, 96, 110), display: 'inline-block', marginTop: 6 }}><Chip tone={warn ? 'warn' : 'plain'}>{tag}</Chip></span></>}</span>
                <span style={{ opacity: plateIn, translate: `${(1 - plateIn) * 24}px 0px` }}><Plate tier={p.tier} /></span>
              </div>
            );
          })}
        </div>
      </Panel>
      <Caption delay={14}>{SCENES[3].caption}</Caption>
    </SceneFrame>
  );
};
