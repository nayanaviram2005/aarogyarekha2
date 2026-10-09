import { DECISION, SCENES } from '../scenes';
import { COLOR, EASE_INOUT, FONT, SIZE } from '../tokens';
import { Caption, Panel, Plate, ramp, SceneFrame, useSlow } from '../ui';

const TOP = 190;

/** 18 to 22 s. A person confirms the priority, under their own role and time. The patient is told in their own language. */
export const Decision = () => {
  const frame = useSlow();
  const press = ramp(frame, 36, 46, EASE_INOUT);
  const signed = ramp(frame, 48, 60);
  const scripts = [FONT.sans, FONT.devanagari, FONT.oriya];
  return (
    <SceneFrame>
      <Panel style={{ position: 'absolute', left: SIZE.edgeX, top: TOP, width: 960, height: 460, padding: 40, display: 'grid', alignContent: 'start', gap: 26, opacity: ramp(frame, 0, 12), translate: `${(1 - ramp(frame, 0, 20)) * -60}px 0px` }}>
        <span style={{ fontSize: 52, fontWeight: 700 }}>Sign-off</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: SIZE.ui }}>{DECISION.rulesSet.replace(' Immediate.', '')} <Plate tier={1} /></div>
        <div style={{ position: 'relative', height: 110 }}>
          <span style={{ position: 'absolute', left: 0, top: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 96, padding: '0 44px', fontSize: SIZE.ui + 6, fontWeight: 700, border: `2px solid ${COLOR.action}`, background: press > 0 ? COLOR.action : COLOR.action, color: COLOR.actionInk, borderRadius: SIZE.radius, scale: 1 - 0.04 * Math.sin(Math.PI * Math.min(press, 1)), opacity: 1 - signed }}>{DECISION.confirm}</span>
          <div style={{ position: 'absolute', left: 0, top: 0, display: 'flex', alignItems: 'center', gap: 22, height: 96, padding: '0 36px', border: `2px solid ${COLOR.green}`, background: COLOR.greenTint, color: COLOR.green, borderRadius: SIZE.radius, opacity: signed, translate: `0px ${(1 - signed) * 12}px` }}>
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7" /></svg>
            <span style={{ fontSize: SIZE.ui + 4, fontWeight: 700 }}>{DECISION.signed}</span>
            <span style={{ fontSize: SIZE.ui, fontWeight: 600 }}>{DECISION.by}</span>
          </div>
        </div>
        <span style={{ fontSize: SIZE.uiSmall, color: COLOR.muted }}>Recorded under their name. It cannot be removed.</span>
      </Panel>

      <div style={{ position: 'absolute', left: 1160, right: SIZE.edgeX, top: TOP, height: 460, display: 'grid', alignContent: 'center', gap: 26 }}>
        <span style={{ fontSize: SIZE.ui, color: COLOR.muted, fontWeight: 600, opacity: ramp(frame, 62, 74) }}>{DECISION.languageNote}</span>
        {DECISION.languages.map((l, i) => {
          const at = 66 + i * 10;
          return (
            <span key={l} style={{ fontFamily: scripts[i], fontSize: 52, fontWeight: 600, padding: '12px 28px', border: `2px solid ${COLOR.rule}`, background: COLOR.panel, borderRadius: SIZE.radius, width: 'fit-content', opacity: ramp(frame, at, at + 10), translate: `${(1 - ramp(frame, at, at + 14)) * 30}px 0px` }}>{l}</span>
          );
        })}
      </div>
      <Caption delay={10}>{SCENES[4].caption}</Caption>
    </SceneFrame>
  );
};
