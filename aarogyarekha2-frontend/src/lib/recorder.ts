export interface Recording { stop(): Promise<Blob>; cancel(): void; level?(): number }

export const canRecord = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

const PREFERRED = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

function meter(stream: MediaStream): { level: () => number; close: () => void } {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) throw new Error('no audio context');
    const ctx = new Ctx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    return {
      level: () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) { const v = (data[i]! - 128) / 128; sum += v * v; }
        return Math.min(1, Math.sqrt(sum / data.length) * 4);
      },
      close: () => { void ctx.close().catch(() => {}); },
    };
  } catch { return { level: () => 0, close: () => {} }; }
}

export async function startRecording(): Promise<Recording> {
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { throw new Error('The microphone could not be used. Allow microphone access for this site, or type instead.'); }
  const mimeType = PREFERRED.find(t => MediaRecorder.isTypeSupported?.(t));
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const m = meter(stream);
  const release = () => { m.close(); stream.getTracks().forEach(t => t.stop()); };
  rec.start();
  return {
    stop: () => new Promise<Blob>(resolve => { rec.onstop = () => { release(); resolve(new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' })); }; rec.stop(); }),
    cancel: () => { rec.onstop = null; try { rec.stop(); } catch { } release(); },
    level: m.level,
  };
}
