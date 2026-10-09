// The app as it looks on a 1920 x 1080 screen. Everything the cursor presses is placed from the rectangles below, by BOTH the screen
// drawing and the cursor path, so the pointer always lands on the middle of the thing it presses.
export const W = 1920;
export const H = 1080;
export const TOPBAR = 64;
export const QUEUE_W = 420;
export const CONTEXT_X = 1500;
export const CENTER_X = 460;          // left edge of the patient content
export const CENTER_W = 1000;

export const ROW_H = 110;
export const ROW_Y = (i: number) => 200 + i * ROW_H;

export interface Rect { x: number; y: number; w: number; h: number }
const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
export const mid = (b: Rect): [number, number] => [b.x + b.w / 2, b.y + b.h / 2];

/** Clickable things, in world pixels. */
export const BTN = {
  recordConsent: r(482, 544, 260, 56),
  agree: r(612, 630, 260, 64),
  getPriority: r(482, 930, 300, 56),
  dropZone: r(482, 670, 460, 200),
  mic: r(980, 688, 62, 62),
  submit: r(482, 720, 260, 56),
  yes: (i: number) => r(1280, 409 + i * 104, 80, 44),
  no: (i: number) => r(1360, 409 + i * 104, 80, 44),
  confirmRow: (i: number) => r(1288, 408 + i * 120, 150, 44),
  confirm: r(482, 440, 240, 56),
  change: r(742, 440, 240, 56),
  applyChange: r(502, 804, 200, 48),
  cancel: r(706, 804, 120, 48),
  callIn: r(482, 410, 200, 56),
  preview: r(482, 850, 180, 56),
  send: r(680, 850, 240, 56),
};

/** Points the cursor aims at that are not buttons. */
export const PT = {
  email: [960, 496] as [number, number],
  password: [960, 592] as [number, number],
  signIn: [960, 690] as [number, number],
  nav: { scenarios: [370, 40] as [number, number], referrals: [477, 40] as [number, number], offline: [594, 40] as [number, number], emergency: [742, 40] as [number, number] },
  row: (i: number): [number, number] => [210, ROW_Y(i) + 52],
  journey: (i: number): [number, number] => [CENTER_X + 125 + i * 250, 252],
  complaint: [700, 402] as [number, number],
  /** Where the report starts on the desktop, at the bottom right of the camera's view. */
  fileStart: [1380, 950] as [number, number],
  queue: [300, 300] as [number, number],
};
