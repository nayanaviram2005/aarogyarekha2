import { interpolate } from 'remotion';
import { RULES, SCENES } from '../scenes';
import { COLOR, EASE_INOUT, SIZE, type Tier } from '../tokens';
import { Caption, Panel, Plate, ramp, SceneFrame, useSlow } from '../ui';

const TOP = SIZE.edgeY;
const STEPS: { tier: Tier; at: number }[] = [{ tier: 3, at: 4 }, { tier: 2, at: 66 }, { tier: 1, at: 88 }];

const Button = ({ label, pressed, strong }: { label: string; pressed: number; strong?: boolean }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 240, height: 96, fontSize: SIZE.ui + 6, fontWeight: 700, border: `2px solid ${strong ? COLOR.action : COLOR.rule}`, background: strong && pressed > 0 ? COLOR.action : COLOR.panel, color: strong && pressed > 0 ? COLOR.actionInk : COLOR.ink, borderRadius: SIZE.radius, scale: 1 - 0.04 * Math.sin(Math.PI * Math.min(pressed, 1)) }}>
    {label}
  </span>
);

/** 8 to 13 s. A danger-sign Yes lifts the priority one step at a time. It can only go up. */
export const Rules = () => {
  const frame = useSlow();
  const press = ramp(frame, 38, 50, EASE_INOUT);
  const answered = frame >= 44;
  return (
    <SceneFrame>
      <Panel style={{ position: 'absolute', left: SIZE.edgeX, top: TOP, width: 820, height: 560, padding: 40, display: 'grid', alignContent: 'start', gap: 30, opacity: ramp(frame, 0, 12), translate: `${(1 - ramp(frame, 0, 20)) * -60}px 0px` }}>
        <span style={{ fontSize: SIZE.uiSmall, fontWeight: 700, color: COLOR.muted, letterSpacing: 2, textTransform: 'uppercase' }}>Danger-sign question</span>
        <span style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>{RULES.question}</span>
        <div style={{ display: 'flex', gap: 24, marginTop: 20 }}>
          <Button label="Yes" pressed={press} strong />
          <Button label="No" pressed={0} />
        </div>
        <span style={{ fontSize: SIZE.uiSmall, color: COLOR.muted, opacity: ramp(frame, 50, 62) }}>{answered ? 'Answer submitted. Assessed again.' : ''}</span>
      </Panel>

      <div style={{ position: 'absolute', left: 1020, right: SIZE.edgeX, top: TOP, height: 560, display: 'grid', alignContent: 'center', gap: 34, opacity: ramp(frame, 10, 22) }}>
        <span style={{ fontSize: SIZE.ui, color: COLOR.muted, fontWeight: 600 }}>{RULES.patient}</span>
        <div style={{ position: 'relative', height: 150 }}>
          {STEPS.map((s, i) => {
            const next = STEPS[i + 1]?.at ?? Infinity;
            const inP = ramp(frame, s.at, s.at + 12);
            const outP = next === Infinity ? 0 : ramp(frame, next, next + 12);
            return (
              <div key={s.tier} style={{ position: 'absolute', left: 0, top: 0, opacity: inP * (1 - outP), translate: `0px ${interpolate(inP, [0, 1], [70, 0]) + interpolate(outP, [0, 1], [0, -70])}px` }}>
                <Plate tier={s.tier} scale={2} />
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: SIZE.ui + 4, fontWeight: 600, lineHeight: 1.25, borderLeft: `6px solid ${COLOR.red}`, paddingLeft: 24, opacity: ramp(frame, 104, 116), translate: `0px ${(1 - ramp(frame, 104, 118)) * 14}px` }}>{RULES.reason}</div>
      </div>
      <Caption delay={10}>{SCENES[2].caption}</Caption>
    </SceneFrame>
  );
};
