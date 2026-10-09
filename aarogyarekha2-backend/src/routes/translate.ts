// Translate what the patient said (Hindi, Odia) into English for the reviewer. The original is always kept beside it.
//  * Needs triage consent, whose notice tells the patient that redacted text goes to an outside service. Without it, nothing is sent.
//  * Text is redacted before it leaves; the patient's name and identifiers never reach the service (src/ai/translate.ts).
//  * Every call to the outside service is logged (provider, model, how many items, how many characters; never the text).
//  * Output is stored only if it passes the checks. A translation that fails stays untranslated.
import type { RouteCtx, RouteHelpers } from './intake.js';
import { AiError } from '../ai/provider.js';
import { PiiLeak } from '../ai/redact.js';
import { translateToEnglish, type SourceLanguage, type TranslateItem } from '../ai/translate.js';
import { isConsentActive } from '../intake/consent.js';

const isSource = (l: string | null | undefined): l is SourceLanguage => l === 'hi' || l === 'or';

export function registerTranslateRoutes(c: RouteCtx, h: RouteHelpers): void {
  const { app, deps, authenticate, fail } = c;

  app.post('/encounters/:id/translate', { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const ctx = await h.openEncounter(req, reply, true); if (!ctx) return;
    const { enc, w } = ctx;

    const consents = await req.reader!.getConsents(enc.patient_id).catch(() => undefined);
    if (consents === undefined) return fail(reply, 502, 'transient', 'Consent could not be checked. Try again.');
    const ai = consents.filter(x => x.purpose === 'care_triage' && isConsentActive([x]))[0];
    if (!ai?.id) return fail(reply, 403, 'forbidden', 'No active consent for triage is recorded for this patient. Record it first, or read the original text.');

    const [patient, summary] = await Promise.all([req.reader!.getPatient(enc.patient_id), req.reader!.getEncounterSummary(enc.id)]).catch(() => [undefined, undefined] as const);
    if (!patient || !summary) return fail(reply, 502, 'transient', 'The record could not be loaded. Try again.');

    // What still needs translating, grouped by language.
    const byLang: Record<SourceLanguage, TranslateItem[]> = { hi: [], or: [] };
    const complaintLang = isSource(enc.language) ? enc.language : null;
    if (complaintLang && enc.chief_complaint_original && !enc.chief_complaint_translated) byLang[complaintLang].push({ id: 'complaint', text: enc.chief_complaint_original });
    for (const s of summary.symptoms) if (isSource(s.lang) && !s.text_translated) byLang[s.lang].push({ id: s.id, text: s.text_original });
    const todo = byLang.hi.length + byLang.or.length;
    if (todo === 0) return reply.send({ translated: 0, rejected: 0, nothingToDo: true, provider: deps.translator.name, model: deps.translator.model, machineTranslation: true });

    // What actually answered (it may be a fallback model or provider) is what gets logged.
    let served: { provider: string; model: string } = { provider: deps.translator.name, model: deps.translator.model };
    const generate: typeof deps.translator.generate = async q => { const x = await deps.translator.generate(q); served = { provider: x.provider, model: x.model }; return x; };
    const known = { names: [patient.full_name], identifiers: [patient.public_ref, patient.phone] };
    let translated = 0; let rejected = 0; let status: 'ok' | 'error' | 'timeout' | 'rejected' = 'ok'; let sentItems = 0; let sentChars = 0;
    const symptomOut: { id: string; text: string }[] = []; let complaintOut: string | null = null;
    try {
      for (const lang of ['hi', 'or'] as const) {
        const items = byLang[lang]; if (items.length === 0) continue;
        const o = await translateToEnglish(generate, items, lang, known);
        sentItems += o.sentItems; sentChars += o.sentChars; rejected += o.rejected.length;
        for (const [id, text] of o.translated) { translated++; if (id === 'complaint') complaintOut = text; else symptomOut.push({ id, text }); }
      }
    } catch (err) {
      status = err instanceof AiError ? (err.kind === 'timeout' ? 'timeout' : err.kind === 'rejected' ? 'rejected' : 'error') : 'error';
      if (sentItems > 0 || err instanceof AiError) await deps.logExternalRun({ encounterId: enc.id, consentId: ai.id, provider: served.provider, model: served.model, items: sentItems, chars: sentChars, status }).catch(() => {});
      if (err instanceof PiiLeak) { req.log.error({ reqId: req.id }, 'translation blocked: personal details would have been sent'); return fail(reply, 500, 'exception', 'The text was blocked from leaving because it may contain personal details. Nothing was sent.'); }
      if (err instanceof AiError && err.kind === 'not_configured') return fail(reply, 503, 'not-supported', 'The translation service is not set up. The original text is shown.');
      req.log.error({ reqId: req.id, kind: err instanceof AiError ? err.kind : 'unknown' }, 'translation failed');
      return fail(reply, 502, 'transient', 'The translation service could not be used. The original text is shown. Try again later.');
    }

    // Log the outside call BEFORE storing anything, so a disclosure is never unrecorded.
    try { await deps.logExternalRun({ encounterId: enc.id, consentId: ai.id, provider: served.provider, model: served.model, items: sentItems, chars: sentChars, status: 'ok' }); }
    catch (err) { req.log.error({ reqId: req.id, err: (err as Error).message }, 'external run could not be logged'); return fail(reply, 503, 'transient', 'The outside service call could not be recorded, so the translation was not saved. Try again.'); }

    try {
      if (complaintOut) await w.setComplaintTranslation(enc.id, complaintOut);
      if (symptomOut.length) await deps.saveSymptomTranslations(symptomOut);
    } catch (err) { return h.dbFail(req, reply, err); }

    await h.note(req, { action: 'create', entityType: 'translation', entityId: enc.id, patientId: enc.patient_id, facilityId: enc.facility_id, outcome: 'success', details: { translated, rejected, provider: served.provider, model: served.model } });
    return reply.send({ translated, rejected, provider: served.provider, model: served.model, machineTranslation: true });
  });
}
