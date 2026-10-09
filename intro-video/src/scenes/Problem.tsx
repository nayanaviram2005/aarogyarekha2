import { PATIENTS, SCENES } from '../scenes';
import { COLOR, SIZE } from '../tokens';
import { NotAssessed, Panel, ramp, SceneFrame, useSlow } from '../ui';

const ROW = 108;

/** 0 to 3 s. Four people in the order they arrived, none assessed. The question is the headline. */
export const Problem = () => {
  const frame = useSlow();
  const [first, second] = SCENES[0].caption.split('. ');
  return (
    <SceneFrame>
      <div style={{ position: 'absolute', left: SIZE.edgeX, top: SIZE.edgeY, fontSize: SIZE.headline, fontWeight: 700, lineHeight: 1.08, letterSpacing: -2 }}>
        <div style={{ opacity: ramp(frame, 0, 12), translate: `0px ${(1 - ramp(frame, 0, 14)) * 18}px` }}>{first}.</div>
        <div style={{ opacity: ramp(frame, 14, 26), translate: `0px ${(1 - ramp(frame, 14, 28)) * 18}px`, color: COLOR.action }}>{second}</div>
      </div>
      <Panel style={{ position: 'absolute', left: SIZE.edgeX, right: SIZE.edgeX, top: 420, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr 330px', padding: '14px 32px', background: COLOR.paper, borderBottom: `2px solid ${COLOR.rule}`, fontSize: SIZE.uiSmall, fontWeight: 700, color: COLOR.muted, letterSpacing: 2, textTransform: 'uppercase', opacity: ramp(frame, 22, 34) }}>
          <span>Patient</span><span>Complaint</span><span>Priority</span>
        </div>
        {PATIENTS.map((p, i) => {
          const at = 28 + i * 8;
          return (
            <div key={p.ref} style={{ display: 'grid', gridTemplateColumns: '170px 1fr 330px', alignItems: 'center', height: ROW, padding: '0 32px', borderBottom: i < PATIENTS.length - 1 ? `2px solid ${COLOR.ruleSoft}` : 'none', fontSize: SIZE.ui, opacity: ramp(frame, at, at + 12), translate: `0px ${(1 - ramp(frame, at, at + 14)) * 22}px` }}>
              <span><strong>{p.ref}</strong><br /><span style={{ color: COLOR.muted, fontSize: SIZE.uiSmall }}>{p.who}</span></span>
              <span>{p.complaint}</span>
              <NotAssessed />
            </div>
          );
        })}
      </Panel>
    </SceneFrame>
  );
};
