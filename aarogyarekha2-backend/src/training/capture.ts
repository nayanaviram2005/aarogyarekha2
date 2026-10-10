import type { FastifyRequest } from 'fastify';
import type { Deps } from '../deps.js';
import type { EncounterRow } from '../fhir/project.js';
import { isConsentActive } from '../intake/consent.js';
import type { ReviewResult } from '../review/record.js';
import { loadRecordContext } from '../routes/records.js';
import { buildTrainingCase } from './deidentify.js';

export type TrainingStatus = 'written' | 'no_consent' | 'not_enabled' | 'failed';

export async function captureTrainingCase(deps: Pick<Deps, 'trainingStore'>, req: FastifyRequest, a: { enc: EncounterRow; result: ReviewResult; reason: string | null }): Promise<TrainingStatus> {
  const store = deps.trainingStore;
  if (!store) return 'not_enabled';
  try {
    const reader = req.reader!;
    const consents = await reader.getConsents(a.enc.patient_id);
    if (!consents.some(x => x.purpose === 'research_deidentified' && isConsentActive([x]))) return 'no_consent';
    const [patient, identifiers, summary, me, records] = await Promise.all([
      reader.getPatient(a.enc.patient_id), reader.getIdentifiers(a.enc.patient_id), reader.getEncounterSummary(a.enc.id), reader.getMe(),
      loadRecordContext(req, a.enc.id).catch(() => []),
    ]);
    if (!patient || !summary) return 'failed';
    const membership = me.memberships.find(m => m.facilityId === a.enc.facility_id) ?? me.memberships[0];
    const c = buildTrainingCase({
      key: store.key, patient, identifiers, summary, records, facilityType: membership?.facilityType ?? null,
      review: { id: a.result.reviewId, action: a.result.action, effectiveUrgency: a.result.effectiveUrgency, rulesUrgency: a.result.rulesUrgency, reviewerId: req.user!.userId, reviewerName: me.displayName, reviewerRole: membership?.role ?? null, reason: a.reason },
    });
    await store.write(c);
    return 'written';
  } catch (err) {
    req.log.warn({ reqId: req.id, err: (err as Error).message }, 'training case could not be written');
    return 'failed';
  }
}
