import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RouteCtx, RouteHelpers } from './intake.js';
import { AiError } from '../ai/provider.js';
import { MAX_AUDIO_BYTES, STT_LANGUAGES, sniffAudio, type SttLanguage } from '../ai/stt.js';
import { isConsentActive } from '../intake/consent.js';
import { translateTranscript } from '../ai/transcriptTranslate.js';

const uuid = z.string().uuid();
const CLINICAL = ['health_worker', 'nurse', 'doctor', 'medical_officer'];

interface Target { patientId: string; facilityId: string; encounterId: string | null }

export function registerVoiceRoutes(c: RouteCtx, h: RouteHelpers): void {
  const { app, deps, authenticate, fail } = c;

  async function transcribeFor(req: FastifyRequest, reply: FastifyReply, t: Target) {
    const stt = deps.transcriber;
    if (!stt || !stt.supported) return fail(reply, 503, 'not-supported', 'Voice input is not set up. Type the complaint instead.');
    if (!req.isMultipart()) return fail(reply, 415, 'not-supported', 'Send the recording as multipart form data.');

    const consents = await req.reader!.getConsents(t.patientId).catch(() => undefined);
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
    if (langRaw !== undefined && !STT_LANGUAGES.has(langRaw)) return fail(reply, 400, 'invalid', 'That spoken language is not available.');
    const mime = sniffAudio(buf);
    if (!mime) return fail(reply, 400, 'invalid', 'This is not a supported audio recording.');

    const consentId = ai.id;
    const ledger = (status: 'ok' | 'error' | 'timeout' | 'rejected') => t.encounterId
      ? deps.logExternalRun({ encounterId: t.encounterId, consentId, provider: stt.name, model: stt.model, items: 1, chars: buf!.length, status, purpose: 'transcription' })
      : Promise.resolve();

    let text: string; let language: string | null;
    try {
      const r = await stt.transcribe({ bytes: buf, mime, language: langRaw as SttLanguage | undefined });
      text = r.text; language = r.language;
    } catch (err) {
      const status = err instanceof AiError ? (err.kind === 'timeout' ? 'timeout' : err.kind === 'rejected' ? 'rejected' : 'error') : 'error';
      if (err instanceof AiError && err.kind !== 'not_configured') await ledger(status).catch(() => {});
      if (err instanceof AiError && err.kind === 'not_configured') return fail(reply, 503, 'not-supported', 'Voice input is not set up. Type the complaint instead.');
      req.log.error({ reqId: req.id, kind: err instanceof AiError ? err.kind : 'unknown', detail: err instanceof AiError ? err.detail : undefined }, 'transcription failed');
      return fail(reply, 502, 'transient', 'The recording could not be turned into text. Type the complaint instead, or try again.');
    }

    try { await ledger('ok'); }
    catch (err) { req.log.error({ reqId: req.id, err: (err as Error).message }, 'external run could not be logged'); return fail(reply, 503, 'transient', 'The outside service call could not be recorded, so the text was dropped. Try again.'); }

    const from = language && language !== 'other' ? language : langRaw && langRaw !== 'auto' ? langRaw : '';
    const patient = from && from !== 'en' ? await req.reader!.getPatient(t.patientId).catch(() => null) : null;
    const translation = patient ? await translateTranscript(deps, text, from, { names: [patient.full_name], identifiers: [patient.public_ref, patient.phone] }) : null;

    await h.note(req, { action: 'create', entityType: 'transcription', entityId: t.encounterId ?? t.patientId, patientId: t.patientId, facilityId: t.facilityId, outcome: 'success', details: { bytes: buf.length, provider: stt.name, model: stt.model, atIntake: !t.encounterId, translatedBy: translation ? translation.provider : null } });
    return reply.send({ text, language, provider: stt.name, model: stt.model, machineTranscript: true, translation });
  }

  app.post('/encounters/:id/transcribe', { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const ctx = await h.openEncounter(req, reply, true); if (!ctx) return;
    return transcribeFor(req, reply, { patientId: ctx.enc.patient_id, facilityId: ctx.enc.facility_id, encounterId: ctx.enc.id });
  });

  app.post('/patients/:id/transcribe', { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) return fail(reply, 400, 'invalid', 'Patient id must be a UUID.');
    const me = await req.reader!.getMe().catch(() => undefined);
    if (me === undefined) return fail(reply, 502, 'transient', 'Your profile could not be loaded. Try again.');
    if (!me.memberships.some(m => CLINICAL.includes(m.role))) return fail(reply, 403, 'forbidden', 'Only clinical staff at a facility can record a complaint by voice.');
    const patient = await req.reader!.getPatient(id.data).catch(() => undefined);
    if (patient === undefined) return fail(reply, 502, 'transient', 'The record could not be loaded. Try again.');
    if (!patient) return fail(reply, 404, 'not-found', 'No such patient, or you do not have access.');
    return transcribeFor(req, reply, { patientId: patient.id, facilityId: patient.registered_facility_id, encounterId: null });
  });
}
