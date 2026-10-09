import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import './fonts';
import { COLOR, FONT } from './tokens';
import { WBtn, WBox, WChip, Pointer } from './wt/atoms';
import { Center, NoteDoc, Sms } from './wt/Views';
import { ContextPane, Login, QueuePane, Topbar, paperStyle } from './wt/Chrome';
import { CENTER_X, H, W } from './wt/layout';
import { CLICKS, cursorAt } from './wt/cursor';
import { lin, p, track } from './wt/util';

const STRIP = 110;

/**
 * Video time to script time. The script (every time written in the scenes, the cursor and the camera) is left as written; between video
 * 16 s and 20 s the film runs the script at 1.5x speed, so the cursor and the pan to the patient are quicker there, and the rest follows
 * 2 s earlier. Script 16 s to 22 s is 6 s of script played in 4 s of video.
 */
const SPEED_FROM = 16;
const SPEED_VIDEO_LEN = 4;
const SPEED = 1.5;
// Script 70.6 s to 72.6 s (the answers are submitted and the queue re-sorts) is played over 5 s of video, so the camera has time to
// glide to the queue and the re-sort is seen while it happens. Everything after it is 3 s later in the video.
const SLOW_FROM = 70.6;
const SLOW_TO = 72.6;
const SLOW_VIDEO = 5.0;
const SLOW_START = SLOW_FROM - (SPEED_VIDEO_LEN * SPEED - SPEED_VIDEO_LEN);        // the video time at which the slow part begins
export const scriptTime = (v: number) =>
  v < SPEED_FROM ? v
    : v < SPEED_FROM + SPEED_VIDEO_LEN ? SPEED_FROM + (v - SPEED_FROM) * SPEED
    : v < SLOW_START ? v + (SPEED_VIDEO_LEN * SPEED - SPEED_VIDEO_LEN)
    : v < SLOW_START + SLOW_VIDEO ? SLOW_FROM + (v - SLOW_START) * ((SLOW_TO - SLOW_FROM) / SLOW_VIDEO)
    : SLOW_TO + (v - SLOW_START - SLOW_VIDEO);
export const WALK_SECONDS = 139;

/** The camera: [script seconds, centre x, centre y, zoom]. Between keys it eases. The picture is the app drawn at 1920 x 1080. */
const CAM: [number, number, number, number][] = [
  // sign-in: close on the card, then zoom out as the screen slides away
  [0, 960, 540, 1.7], [4.6, 960, 540, 1.7], [5.8, 960, 485, 1.0],
  [8.2, 960, 485, 1.0], [13.2, 960, 485, 1.0],
  // the queue, then across to the patient
  [15.4, 250, 380, 2.1], [20.6, 250, 380, 2.1],
  [22.6, 960, 330, 1.55], [25.0, 960, 330, 1.55],
  [26.4, 960, 520, 1.7], [31.2, 960, 520, 1.7],
  [32.4, 960, 520, 1.75], [34.4, 960, 560, 1.75],
  // the report starts at the bottom right of the screen, is dragged to the drop zone and read
  [35.4, 900, 720, 1.6], [46.0, 900, 720, 1.6],
  [47.0, 1000, 720, 1.6], [49.4, 1000, 720, 1.6],
  // scroll down to "Get the priority" and hold there while it is pressed
  [50.4, 760, 860, 1.7], [53.0, 760, 860, 1.7],
  [54.2, 960, 600, 1.5], [70.6, 960, 600, 1.5],
  [71.4, 250, 380, 2.1], [72.6, 250, 380, 2.1],
  [74.0, 960, 580, 1.8], [81.2, 960, 580, 1.8],
  [82.0, 1010, 590, 1.65], [89.6, 1010, 590, 1.65],
  // straight to the text message, and back before "Call in"
  [90.4, 1440, 430, 2.0], [94.6, 1440, 430, 2.0],
  [95.8, 960, 520, 1.8], [99.0, 960, 520, 1.8],
  [100.0, 960, 630, 1.55], [106.0, 960, 620, 1.5], [111.6, 960, 620, 1.5],
  // the referral is sent: straight to the queue as the patient leaves it
  [113.0, 250, 380, 2.1], [122.0, 250, 380, 2.1],
  [124.2, 960, 485, 1.0], [131.0, 960, 485, 1.0],
];

const CAPTIONS: [number, number, string][] = [
  [0.8, 6.6, 'Doctor/nurse signs in. RBAC in action.'],
  [8.4, 13.0, 'The dashboard: Organised patient queue information'],
  [14.0, 20.4, 'The queue: primary rule-based triage system.'],
  [21.2, 25.2, 'Every patient has four steps.'],
  [25.6, 31.0, 'Check-in: consent in one tap.'],
  [31.8, 35.2, 'User enters patient’s complaints and vitals'],
  [35.8, 45.6, 'Uploaded records go through OCR'],
  [46.4, 52.8, 'Patient details can be sent via voice too!'],
  [54.0, 62.8, 'Rule-based triage with transparent flags and OCR results'],
  [63.8, 70.8, 'Danger-sign questions: tap, then submit.'],
  [71.0, 73.2, 'Queue updates actively'],
  [74.2, 81.2, 'Professionals review every result'],
  [82.0, 89.8, 'Sign-off: the doctor decides, under their name.'],
  [90.0, 95.2, 'SMS Alert sent to patient'],
  [95.6, 99.2, 'Patient is called in for checkup'],
  [99.8, 111.4, 'Less resources? Patient’s ready for referral to larger facility'],
  [111.9, 121.8, 'Seen, referred, treated: the queue empties.'],
  [122.6, 130.0, 'Queue cleared for now.'],
];

const StartPage = ({ t }: { t: number }) => {
  const o = Math.min(p(t, 5.8, 8.0), 1 - p(t, 20.2, 20.8));
  if (o <= 0) return null;
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, opacity: o }}>
      <div style={{ position: 'absolute', left: CENTER_X + 120, top: 110, width: 760 }}>
        <div style={{ fontSize: 40, fontWeight: 700 }}>Triage desk</div>
        <div style={{ fontSize: 18, color: COLOR.muted, margin: '6px 0 22px' }}>Start with a new patient, or pick up the next one in the queue.</div>
        <WBtn label="New patient" primary w={240} h={64} />
        <WBox style={{ marginTop: 30, padding: 24, borderColor: COLOR.action, borderWidth: 3 }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1.5, color: COLOR.muted }}>NOT ASSESSED YET</div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', margin: '10px 0' }}><span style={{ fontSize: 28, fontWeight: 700 }}>Asha Rao</span><WChip>Not assessed</WChip></div>
          <div style={{ fontSize: 17, color: COLOR.muted }}>Fever and cough for three days</div>
          <div style={{ marginTop: 16 }}><WBtn label="Open" primary w={140} h={48} /></div>
        </WBox>
        <div style={{ display: 'grid', gap: 6, marginTop: 24, fontSize: 18 }}>
          <div><strong>4</strong> waiting</div><div><strong>1</strong> not assessed</div><div><strong>0</strong> waiting for a nurse or doctor to sign off</div>
        </div>
      </div>
    </div>
  );
};

/** After the patient is referred the desk is back to its start page, counting down to nobody waiting. */
const LateStart = ({ t }: { t: number }) => {
  const o = p(t, 114.0, 114.8);
  if (o <= 0) return null;
  const waiting = 4 - [112.6, 116.4, 119.0, 121.0].filter(g => t >= g).length;
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, opacity: o }}>
      <div style={{ position: 'absolute', left: CENTER_X + 120, top: 110, width: 760 }}>
        <div style={{ fontSize: 40, fontWeight: 700 }}>Triage desk</div>
        <div style={{ fontSize: 18, color: COLOR.muted, margin: '6px 0 22px' }}>{waiting === 0 ? 'Nobody is waiting. When someone arrives, choose New patient.' : 'Start with a new patient, or pick up the next one in the queue.'}</div>
        <WBtn label="New patient" primary w={240} h={64} />
        <div style={{ display: 'grid', gap: 6, marginTop: 30, fontSize: 18 }}>
          <div><strong>{waiting}</strong> waiting</div><div><strong>0</strong> not assessed</div><div><strong>0</strong> waiting for a nurse or doctor to sign off</div>
        </div>
      </div>
    </div>
  );
};

export const Walkthrough = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = scriptTime(frame / fps);

  // camera
  const times = CAM.map(k => k[0]);
  const cx = track(t, times, CAM.map(k => k[1]));
  const cy = track(t, times, CAM.map(k => k[2]));
  const s = track(t, times, CAM.map(k => k[3]));

  // pointer
  const [mx, my] = cursorAt(t);
  const click = CLICKS.find(c => t >= c && t < c + 0.5);
  const ring = click === undefined ? 0 : lin(t, click, click + 0.5);

  // the sign-in screen zooms out, then slides up and away while the dashboard fades in slowly
  const loginUp = p(t, 5.8, 6.9);
  const dashO = p(t, 5.4, 8.0);
  const hoverRow = t >= 15.6 && t < 19.7 ? (t < 17.0 ? 0 : t < 18.4 ? 2 : 1) : -1;
  const queueHover = hoverRow === 1 ? 1 : -2;
  const hoverStep = t >= 22.0 && t < 25.0 ? Math.min(3, Math.max(0, Math.round((t - 22.2) / 0.8))) : -1;

  const caption = CAPTIONS.find(([a, b]) => t >= a && t < b);
  const capO = caption ? Math.min(p(t, caption[0], caption[0] + 0.4), 1 - p(t, caption[1] - 0.4, caption[1])) : 0;
  const end = p(t, 131.0, 132.2);

  return (
    <AbsoluteFill style={{ background: COLOR.paper, overflow: 'hidden' }}>
      <div style={{ ...paperStyle, transformOrigin: '0 0', translate: `${W / 2 - cx * s}px ${(H - STRIP) / 2 - cy * s}px`, scale: s }}>
        <div style={{ position: 'absolute', inset: 0, opacity: dashO }}>
          <StartPage t={t} />
          <Center t={t} hoverStep={hoverStep} />
          <LateStart t={t} />
          <QueuePane t={t} hover={queueHover} selected={t >= 19.7} />
          <ContextPane t={t} />
          <Topbar t={t} />
          <Sms t={t} />
          <NoteDoc t={t} />
        </div>
        {loginUp < 1 && (
          <div style={{ position: 'absolute', inset: 0, translate: `0px ${-loginUp * (H + 200)}px`, background: loginUp < 0.02 ? COLOR.paper : 'transparent' }}>
            <Login t={t} />
          </div>
        )}
        {click !== undefined && <div style={{ position: 'absolute', left: mx - 28, top: my - 28, width: 56, height: 56, borderRadius: 28, border: `3px solid ${COLOR.action}`, opacity: 1 - ring, scale: 0.5 + ring }} />}
        <div style={{ position: 'absolute', left: mx - 3, top: my - 2, opacity: p(t, 6.0, 6.6) * (1 - p(t, 131.2, 132)) }}><Pointer /></div>
      </div>

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: STRIP, background: COLOR.panel, borderTop: `3px solid ${COLOR.ink}`, opacity: p(t, 0.5, 1.0) * (1 - p(t, 131.0, 131.6)) }} />
      {caption && (
        <div style={{ position: 'absolute', left: 96, bottom: (STRIP - 64) / 2, opacity: capO, translate: `0px ${(1 - capO) * 14}px`, fontFamily: FONT.sans, fontSize: 52, lineHeight: '64px', fontWeight: 700, color: COLOR.ink, whiteSpace: 'nowrap' }}>{caption[2]}</div>
      )}

      <div style={{ position: 'absolute', inset: 0, background: COLOR.paper, opacity: end, display: 'grid', alignContent: 'center', padding: '0 120px', gap: 30, fontFamily: FONT.sans, color: COLOR.ink }}>
        <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1.14, letterSpacing: -2, opacity: p(t, 131.4, 132.4), translate: `0px ${(1 - p(t, 131.4, 132.6)) * 20}px` }}>
          <div style={{ color: COLOR.action }}>AarogyaRekha:</div>
          <div>From a crowded queue to a clear order.</div>
        </div>
        <div style={{ height: 6, width: 220 * p(t, 132.0, 133.4), background: COLOR.ink }} />
        <div style={{ fontSize: 62, fontWeight: 600, color: COLOR.muted, opacity: p(t, 133.0, 134.0) }}>Prototype. Not for use with real patients.</div>
      </div>
    </AbsoluteFill>
  );
};
