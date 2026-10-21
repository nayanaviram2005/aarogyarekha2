import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startRecording } from './recorder';

let samples: number[];
let closed: number;
let stopped: number;

class FakeRecorder {
  mimeType = 'audio/webm'; ondataavailable: ((e: { data: Blob }) => void) | null = null; onstop: (() => void) | null = null;
  static isTypeSupported = () => true;
  start() {}
  stop() { this.ondataavailable?.({ data: new Blob([new Uint8Array([1])]) }); this.onstop?.(); }
}
class FakeContext {
  createAnalyser() { return { fftSize: 0, getByteTimeDomainData: (d: Uint8Array) => { for (let i = 0; i < d.length; i++) d[i] = samples[i % samples.length]!; } }; }
  createMediaStreamSource() { return { connect: () => {} }; }
  close() { closed++; return Promise.resolve(); }
}

beforeEach(() => {
  samples = [128]; closed = 0; stopped = 0;
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('AudioContext', FakeContext);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { stopped++; } }] }) } });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('recorder level', () => {
  it('reads zero for silence and rises with the loudness of the real signal', async () => {
    const r = await startRecording();
    expect(r.level!()).toBe(0);
    samples = [128 + 3, 128 - 3]; const quiet = r.level!();
    samples = [128 + 12, 128 - 12]; const speech = r.level!();
    samples = [128 + 60, 128 - 60]; const loud = r.level!();
    expect(quiet).toBeGreaterThan(0); expect(speech).toBeGreaterThan(quiet); expect(loud).toBeGreaterThan(speech); expect(loud).toBeLessThanOrEqual(1);
    r.cancel();
  });
  it('releases the microphone and the audio context on stop and on cancel', async () => {
    const a = await startRecording(); await a.stop();
    expect(stopped).toBe(1); expect(closed).toBe(1);
    const b = await startRecording(); b.cancel();
    expect(stopped).toBe(2); expect(closed).toBe(2);
  });
  it('still records when the browser has no audio analysis, with the level at zero', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const r = await startRecording();
    expect(r.level!()).toBe(0);
    expect((await r.stop()).size).toBeGreaterThan(0);
  });
});
