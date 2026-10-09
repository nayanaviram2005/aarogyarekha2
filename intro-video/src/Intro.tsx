import { AbsoluteFill, Series, useVideoConfig } from 'remotion';
import './fonts';
import { SCENES } from './scenes';
import { Close } from './scenes/Close';
import { Decision } from './scenes/Decision';
import { Problem } from './scenes/Problem';
import { Queue } from './scenes/Queue';
import { Records } from './scenes/Records';
import { Rules } from './scenes/Rules';
import { COLOR } from './tokens';

/** The whole intro. The paper background sits behind every scene so a cut never flashes. Durations come from scenes.ts. */
export const Intro = () => {
  const { fps } = useVideoConfig();
  const frames = (i: number) => Math.round(SCENES[i]!.seconds * fps);
  return (
    <AbsoluteFill style={{ background: COLOR.paper }}>
      <Series>
        <Series.Sequence name="The problem" durationInFrames={frames(0)} premountFor={fps}><Problem /></Series.Sequence>
        <Series.Sequence name="Records in" durationInFrames={frames(1)} premountFor={fps}><Records /></Series.Sequence>
        <Series.Sequence name="Written rules" durationInFrames={frames(2)} premountFor={fps}><Rules /></Series.Sequence>
        <Series.Sequence name="The queue reorders" durationInFrames={frames(3)} premountFor={fps}><Queue /></Series.Sequence>
        <Series.Sequence name="A person decides" durationInFrames={frames(4)} premountFor={fps}><Decision /></Series.Sequence>
        <Series.Sequence name="Close" durationInFrames={frames(5)} premountFor={fps}><Close /></Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
