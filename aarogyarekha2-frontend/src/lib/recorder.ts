// Microphone recording in the browser. Audio stays in memory; it is never written to disk or local storage.
export interface Recording { stop(): Promise<Blob>; cancel(): void }

export const canRecord = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

const PREFERRED = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

/** Starts recording. Rejects with a plain-language Error if the microphone is blocked or missing. */
export async function startRecording(): Promise<Recording> {
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { throw new Error('The microphone could not be used. Allow microphone access for this site, or type instead.'); }
  const mimeType = PREFERRED.find(t => MediaRecorder.isTypeSupported?.(t));
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const release = () => stream.getTracks().forEach(t => t.stop());
  rec.start();
  return {
    stop: () => new Promise<Blob>(resolve => { rec.onstop = () => { release(); resolve(new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' })); }; rec.stop(); }),
    cancel: () => { rec.onstop = null; try { rec.stop(); } catch { /* already stopped */ } release(); },
  };
}
