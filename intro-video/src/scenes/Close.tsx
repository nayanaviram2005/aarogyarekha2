import { SCENES } from '../scenes';
import { COLOR, SIZE } from '../tokens';
import { ramp, SceneFrame, useSlow } from '../ui';

/** 22 to 24 s. The question, stated plainly, and what the app is not yet. */
export const Close = () => {
  const frame = useSlow();
  const s = SCENES[5];
  const [name, rest] = s.caption.split(': ');
  return (
    <SceneFrame>
      <div style={{ position: 'absolute', left: SIZE.edgeX, right: SIZE.edgeX, top: 0, bottom: 0, display: 'grid', alignContent: 'center', gap: 36 }}>
        <div style={{ fontSize: 92, fontWeight: 700, lineHeight: 1.12, letterSpacing: -2, opacity: ramp(frame, 0, 14), translate: `0px ${(1 - ramp(frame, 0, 16)) * 20}px` }}>
          <div style={{ color: COLOR.action }}>{name}:</div>
          <div>{rest}</div>
        </div>
        <div style={{ height: 6, width: 220 * ramp(frame, 8, 26), background: COLOR.ink }} />
        <div style={{ fontSize: SIZE.caption - 10, fontWeight: 600, color: COLOR.muted, opacity: ramp(frame, 18, 32) }}>{s.note}</div>
      </div>
    </SceneFrame>
  );
};
