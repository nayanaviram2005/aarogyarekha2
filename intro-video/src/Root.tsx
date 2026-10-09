import { Composition } from 'remotion';
import { Intro } from './Intro';
import { TOTAL_SECONDS } from './scenes';
import { Walkthrough, WALK_SECONDS } from './Walkthrough';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Intro" component={Intro} durationInFrames={TOTAL_SECONDS * 30} fps={30} width={1920} height={1080} />
    <Composition id="Walkthrough" component={Walkthrough} durationInFrames={WALK_SECONDS * 30} fps={30} width={1920} height={1080} />
  </>
);
