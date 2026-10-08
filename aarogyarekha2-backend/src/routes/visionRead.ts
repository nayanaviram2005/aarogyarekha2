// The AI second read of a report image. Never throws: any problem becomes a status, and the local OCR result stands alone.
// Needs the patient's separate consent to outside AI processing (an image cannot be redacted), and every call is logged before the
// rows are used. The image itself is never stored by us.
import type { FastifyRequest } from 'fastify';
import type { Deps, DocumentRow } from '../deps.js';
import { AiError } from '../ai/provider.js';
import { MAX_VISION_BYTES, type VisionMime, type VisionRow } from '../ai/vision.js';
import { isConsentActive } from '../intake/consent.js';

export type SecondReadStatus = 'ok' | 'not_set_up' | 'no_consent' | 'unsupported_type' | 'too_large' | 'unavailable';
export interface SecondRead { status: SecondReadStatus; rows: VisionRow[]; provider: string | null; model: string | null }
const none = (status: SecondReadStatus): SecondRead => ({ status, rows: [], provider: null, model: null });

export async function secondRead(deps: Deps, req: FastifyRequest, d: DocumentRow, bytes: Buffer): Promise<SecondRead> {
  const v = deps.vision;
  if (!v || !v.supported || v.name === 'mock') return none('not_set_up');
  if (!v.accepts(d.mime_type)) return none('unsupported_type');
  if (bytes.length > MAX_VISION_BYTES) return none('too_large');
  if (!d.encounter_id) return none('not_set_up');
  try {
    const consents = await req.reader!.getConsents(d.patient_id);
    const ai = consents.filter(x => x.purpose === 'external_ai_processing' && isConsentActive([x]))[0];
    if (!ai?.id) return none('no_consent');
    const log = (status: 'ok' | 'error' | 'timeout' | 'rejected') => deps.logExternalRun({ encounterId: d.encounter_id!, consentId: ai.id!, provider: v.name, model: v.model, items: 1, chars: bytes.length, status, purpose: 'vision_extraction' });
    let read;
    try { read = await v.read({ bytes, mime: d.mime_type as VisionMime }); }
    catch (err) {
      const status = err instanceof AiError ? (err.kind === 'timeout' ? 'timeout' : err.kind === 'rejected' ? 'rejected' : 'error') : 'error';
      if (err instanceof AiError && err.kind !== 'not_configured') await log(status).catch(() => {});
      req.log.warn({ reqId: req.id, kind: err instanceof AiError ? err.kind : 'unknown' }, 'AI second read unavailable');
      return none(err instanceof AiError && err.kind === 'not_configured' ? 'not_set_up' : 'unavailable');
    }
    try { await deps.logExternalRun({ encounterId: d.encounter_id!, consentId: ai.id!, provider: read.provider, model: read.model, items: 1, chars: bytes.length, status: 'ok', purpose: 'vision_extraction' }); } catch { req.log.error({ reqId: req.id }, 'external run could not be logged; AI second read not used'); return none('unavailable'); }
    return { status: 'ok', rows: read.rows, provider: read.provider, model: read.model };
  } catch (err) {
    req.log.warn({ reqId: req.id, err: (err as Error).message }, 'AI second read could not run');
    return none('unavailable');
  }
}
