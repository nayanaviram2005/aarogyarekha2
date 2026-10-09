import type { RouteCtx, RouteHelpers } from './intake.js';
import { AiError } from '../ai/provider.js';
import { MAX_AUDIO_BYTES, sniffAudio, type SttLanguage } from '../ai/stt.js';
import { isConsentActive } from '../intake/consent.js';

const LANGS = new Set<string>(['en', 'hi', 'or']);

export function registerVoiceRoutes(c: RouteCtx, h: RouteHelpers): void {
  const { app, deps, authenticate, fail } = c;

  app.post('/encounters/:id/transcribe', { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const ctx = await h.openEncounter(req, reply, true); if (!ctx) return;
    const { enc } = ctx;
    const stt = deps.transcriber;
    if (!stt || !stt.supported) return fail(reply, 503, 'not-supported', 'Voice input is not set up. Type the complaint instead.');
    if (!req.isMultipart()) return fail(reply, 415, 'not-supported', 'Send the recording as multipart form data.');

    const consents = await req.reader!.getConsents(enc.patient_id).catch(() => undefined);
    if (consents === undefined) return fail(reply, 502, 'transient', 'Consent could not be checked. Try again.');
    const ai = consents.filter(x => x.purpose === 'external_ai_processing' && isConsentActive([x]))[0];
    if (!ai?.id) return fail(reply, 403, 'forbidden', 'The patient has not consented to an outside AI service hearing their voice. Record that consent first, or type the complaint.');

    let buf: Buffer | null = null; let truncated = false; let langRaw: string | undefined;
    try {
      for await (const part of req.parts()) {
        if (part.type === 'field') { if (part.fieldname === 'language') langRaw = String(part.value); }
        else if (!buf) { buf = await part.toBuffer(); truncated = part.file.truncated; }
        else part.file.resume();
      }
    } catch (err) {
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') truncated = true;
      else return fail(reply, 400, 'invalid', 'The recording could not be read.');
    }
    if (truncated || (buf && buf.length > MAX_AUDIO_BYTES)) return fail(reply, 413, 'too-costly', 'The recording is longer than 2 MB. Record a shorter one.');
    if (!buf || buf.length === 0) return fail(reply, 400, 'invalid', 'No recording was received.');
    if (langRaw !== undefined && !LANGS.has(langRaw)) return fail(reply, 400, 'invalid', 'Language must be en, hi or or.');
    const mime = sniffAudio(buf);
    if (!mime) return fail(reply, 400, 'invalid', 'This is not a supported audio recording.');

    let text: string; let language: string | null;
    try {
      const r = await stt.transcribe({ bytes: buf, mime, language: langRaw as SttLanguage | undefined });
      text = r.text; language = r.language;
    } catch (err) {
      const status = err instanceof AiError ? (err.kind === 'timeout' ? 'timeout' : err.kind === 'rejected' ? 'rejected' : 'error') : 'error';
      if (err instanceof AiError && err.kind !== 'not_configured') await deps.logExternalRun({ encounterId: enc.id, consentId: ai.id, provider: stt.name, model: stt.model, items: 1, chars: buf.length, status, purpose: 'transcription' }).catch(() => {});
      if (err instanceof AiError && err.kind === 'not_configured') return fail(reply, 503, 'not-supported', 'Voice input is not set up. Type the complaint instead.');
      req.log.error({ reqId: req.id, kind: err instanceof AiError ? err.kind : 'unknown' }, 'transcription failed');
      return fail(reply, 502, 'transient', 'The recording could not be turned into text. Type the complaint instead, or try again.');
    }

    try { await deps.logExternalRun({ encounterId: enc.id, consentId: ai.id, provider: stt.name, model: stt.model, items: 1, chars: buf.length, status: 'ok', purpose: 'transcription' }); }
    catch (err) { req.log.error({ reqId: req.id, err: (err as Error).message }, 'external run could not be logged'); return fail(reply, 503, 'transient', 'The outside service call could not be recorded, so the text was dropped. Try again.'); }

    await h.note(req, { action: 'create', entityType: 'transcription', entityId: enc.id, patientId: enc.patient_id, facilityId: enc.facility_id, outcome: 'success', details: { bytes: buf.length, provider: stt.name, model: stt.model } });
    return reply.send({ text, language, provider: stt.name, model: stt.model, machineTranscript: true });
  });
}
