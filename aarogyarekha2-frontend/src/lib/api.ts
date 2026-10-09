import type { Api, DuplicateMatch } from './types';

/** An API failure with a message that is safe and useful to show a person. */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly duplicates?: DuplicateMatch[]) { super(message); this.name = 'ApiError'; }
  get isConsent() { return this.status === 403 && /consent/i.test(this.message); }
  get isRulesNotApproved() { return this.status === 503 && /not approved/i.test(this.message); }
  /** A newer assessment exists than the one the reviewer was looking at. */
  get isStale() { return this.status === 409 && /changed while you were reviewing/i.test(this.message); }
  get needsDowngradeConfirmation() { return this.status === 409 && /explicit confirmation/i.test(this.message); }
}

const FALLBACK: Record<number, string> = {
  0: 'Cannot reach the server. Check your connection and try again.',
  401: 'Your session has ended. Sign in again.',
  403: 'You are not allowed to do this.',
  404: 'That record was not found, or you do not have access to it.',
  409: 'That cannot be changed any more.',
  422: 'A value is not valid or is outside the allowed range.',
  429: 'Too many requests. Wait a minute and try again.',
};

/** Pulls the plain message out of a FHIR OperationOutcome; never shows raw bodies or stack traces. */
export function messageFromBody(status: number, body: unknown): string {
  const text = (body as { issue?: { details?: { text?: unknown } }[] } | null)?.issue?.[0]?.details?.text;
  if (typeof text === 'string' && text.trim()) return text;
  return FALLBACK[status] ?? (status >= 500 ? 'Something went wrong on the server. Try again.' : 'The request could not be completed.');
}

export type TokenSource = () => Promise<string | null>;

export function createApi(baseUrl: string, getToken: TokenSource, fetchImpl: typeof fetch = fetch, sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms))): Api {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await getToken();
    if (!token) throw new ApiError(401, FALLBACK[401]!);
    let res: Response;
    try {
      res = await fetchImpl(baseUrl + path, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, FALLBACK[0]!);
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, messageFromBody(res.status, json), (json as { possibleDuplicates?: DuplicateMatch[] } | null)?.possibleDuplicates);
    return json as T;
  }
  const enc = encodeURIComponent;

  return {
    health: async () => fetchImpl(baseUrl + '/health').then(r => r.ok).catch(() => false),
    me: () => call('GET', '/me'),
    registerPatient: body => call('POST', '/patients', body),
    queue: () => call('GET', '/queue'),
    patients: async q => (await call<{ patients: never[] }>('GET', '/patients' + (q ? `?q=${enc(q)}` : ''))).patients,
    summary: id => call('GET', `/encounters/${enc(id)}/summary`),
    recordConsent: (patientId, body) => call('POST', `/patients/${enc(patientId)}/consents`, body),
    createEncounter: body => call('POST', '/encounters', body),
    addSymptom: (id, body) => call('POST', `/encounters/${enc(id)}/symptoms`, body),
    addVital: (id, body) => call('POST', `/encounters/${enc(id)}/vitals`, body),
    saveInputs: (id, body) => call('PUT', `/encounters/${enc(id)}/triage-inputs`, body),
    submit: id => call('POST', `/encounters/${enc(id)}/submit`),
    assess: id => call('POST', `/encounters/${enc(id)}/assess`),
    review: (id, body) => call('POST', `/encounters/${enc(id)}/review`, body),
    facilities: async () => (await call<{ facilities: never[] }>('GET', '/facilities')).facilities,
    referralsFor: async id => (await call<{ referrals: never[] }>('GET', `/encounters/${enc(id)}/referrals`)).referrals,
    createReferral: (id, body) => call('POST', `/encounters/${enc(id)}/referrals`, body),
    referral: id => call('GET', `/referrals/${enc(id)}`),
    updateReferral: (id, body) => call('PUT', `/referrals/${enc(id)}`, body),
    cancelReferral: (id, reason) => call('POST', `/referrals/${enc(id)}/cancel`, reason ? { reason } : {}),
    sendReferral: id => call('POST', `/referrals/${enc(id)}/send`),
    translate: id => call('POST', `/encounters/${enc(id)}/translate`),
    transcribe: async (id, audio, language) => {
      const token = await getToken();
      if (!token) throw new ApiError(401, FALLBACK[401]!);
      const fd = new FormData(); if (language) fd.append('language', language); fd.append('audio', audio, 'recording');      // field order matters: language first
      let res: Response;
      try { res = await fetchImpl(`${baseUrl}/encounters/${enc(id)}/transcribe`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd }); }
      catch { throw new ApiError(0, FALLBACK[0]!); }
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, messageFromBody(res.status, json));
      return json as { text: string; language: string | null; provider: string; model: string; machineTranscript: true };
    },
    auditFlags: hours => call('GET', `/admin/audit/flags${hours ? `?hours=${hours}` : ''}`),
    auditChain: () => call('GET', '/admin/audit/chain'),
    callIn: id => call('POST', `/encounters/${enc(id)}/call-in`),
    completeVisit: (id, outcome) => call('POST', `/encounters/${enc(id)}/complete`, { outcome }),
    queueDone: async hours => (await call<{ done: never[] }>('GET', `/queue/done${hours ? `?hours=${hours}` : ''}`)).done,
    members: async () => (await call<{ members: never[] }>('GET', '/admin/members')).members,
    memberChanges: async () => (await call<{ changes: never[] }>('GET', '/admin/members/changes')).changes,
    addMember: body => call('POST', '/admin/members', body),
    setMemberRole: (id, role, facilityId) => call('POST', `/admin/members/${enc(id)}/role`, { role, ...(facilityId ? { facilityId } : {}) }),
    platformFacilities: async () => (await call<{ facilities: never[] }>('GET', '/platform/facilities')).facilities,
    createFacility: body => call('POST', '/platform/facilities', Object.fromEntries(Object.entries(body).filter(([, v]) => typeof v === 'string' && v.trim() !== ''))),
    setFacilityActive: (id, active) => call('POST', `/platform/facilities/${enc(id)}/active`, { active }),
    appointFacilityAdmin: (id, email) => call('POST', `/platform/facilities/${enc(id)}/admins`, { email }),
    removeFacilityAdmin: (id, userId) => call('POST', `/platform/facilities/${enc(id)}/admins/${enc(userId)}/remove`, {}),
    removeMember: (id, facilityId) => call('POST', `/admin/members/${enc(id)}/deactivate`, facilityId ? { facilityId } : {}),
    breakGlassList: async () => (await call<{ grants: never[] }>('GET', '/admin/break-glass')).grants,
    reviewBreakGlass: id => call('POST', `/admin/break-glass/${enc(id)}/review`),
    requestBreakGlass: body => call('POST', '/break-glass', body),
    patientEncounters: id => call('GET', `/patients/${enc(id)}/encounters`),
    incomingReferrals: async s => (await call<{ referrals: never[] }>('GET', '/referrals/incoming' + (s?.length ? '?status=' + s.join(',') : ''))).referrals,
    sentReferrals: async s => (await call<{ referrals: never[] }>('GET', '/referrals/sent' + (s?.length ? '?status=' + s.join(',') : ''))).referrals,
    respondToReferral: (id, action, note) => call('POST', '/referrals/' + enc(id) + '/respond', { action, ...(note ? { note } : {}) }),
    history: async pid => (await call<{ history: never[] }>('GET', `/patients/${enc(pid)}/history`)).history,
    addHistory: (pid, body) => call('POST', `/patients/${enc(pid)}/history`, body),
    confirmHistory: id => call('POST', `/history/${enc(id)}/confirm`),
    trends: async (pid, kinds) => (await call<{ points: never[] }>('GET', `/patients/${enc(pid)}/trends${kinds?.length ? '?kinds=' + kinds.join(',') : ''}`)).points,
    notes: async id => (await call<{ notes: never[] }>('GET', `/encounters/${enc(id)}/notes`)).notes,
    addNote: (id, body) => call('POST', `/encounters/${enc(id)}/notes`, body),
    analytics: days => call('GET', `/admin/analytics?days=${days}`),
    followups: async id => (await call<{ followups: never[] }>('GET', `/encounters/${enc(id)}/followups`)).followups,
    createFollowup: (id, body) => call('POST', `/encounters/${enc(id)}/followups`, body),
    scheduleReminder: (id, body) => call('POST', `/followups/${enc(id)}/reminders`, body),
    stopFollowup: id => call('POST', `/followups/${enc(id)}/stop`),
    documents: async id => (await call<{ documents: never[] }>('GET', `/encounters/${enc(id)}/documents`)).documents,
    uploadDocument: async (id, file, kind) => {
      const token = await getToken();
      if (!token) throw new ApiError(401, FALLBACK[401]!);
      const fd = new FormData(); fd.append('kind', kind); fd.append('file', file, file.name);      // field order matters: kind first
      let res: Response;
      try { res = await fetchImpl(`${baseUrl}/encounters/${enc(id)}/documents`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd }); }
      catch { throw new ApiError(0, FALLBACK[0]!); }
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, messageFromBody(res.status, json));
      return json as { id: string; metadataBytesRemoved: number; quality?: { warnings: { code: string; text: string }[] } };
    },
    readRecord: async (file, language, aiConsent) => {
      const token = await getToken();
      if (!token) throw new ApiError(401, FALLBACK[401]!);
      const fd = new FormData(); if (language) fd.append('language', language); if (aiConsent) fd.append('aiConsent', 'yes'); fd.append('file', file, file.name);
      let res: Response;
      try { res = await fetchImpl(`${baseUrl}/intake/records/read`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd }); }
      catch { throw new ApiError(0, FALLBACK[0]!); }
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, messageFromBody(res.status, json));
      return json as never;
    },
    recordContext: id => call('GET', `/encounters/${enc(id)}/record-context`),
    documentFile: async id => {
      const token = await getToken();
      if (!token) throw new ApiError(401, FALLBACK[401]!);
      let res: Response;
      try { res = await fetchImpl(`${baseUrl}/documents/${enc(id)}/file`, { headers: { authorization: `Bearer ${token}` } }); }
      catch { throw new ApiError(0, FALLBACK[0]!); }
      if (!res.ok) throw new ApiError(res.status, messageFromBody(res.status, await res.json().catch(() => null)));
      const m = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '');
      return { blob: await res.blob(), filename: m?.[1] ?? `document-${id.slice(0, 8)}` };
    },
    // Reading a photo can take a while, so it runs in the background on the server and this checks back every second.
    extractDocument: async (id, language) => {
      const token = await getToken();
      if (!token) throw new ApiError(401, FALLBACK[401]!);
      let res: Response;
      try { res = await fetchImpl(`${baseUrl}/documents/${enc(id)}/extract?async=1`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(language ? { language } : {}) }); }
      catch { throw new ApiError(0, FALLBACK[0]!); }
      const first = (await res.json().catch(() => null)) as { jobId?: string; error?: string } | null;
      if (!res.ok) throw new ApiError(res.status, first?.error ?? messageFromBody(res.status, first));
      const jobId = first?.jobId; if (!jobId) throw new ApiError(502, 'The server did not start the reading. Try again.');
      for (let i = 0; i < 180; i++) {
        await sleep(i < 3 ? 400 : 1000);
        const j = await call<{ status: 'queued' | 'running' | 'done' | 'failed'; error: string | null }>('GET', `/jobs/${enc(jobId)}`);
        if (j.status === 'failed') throw new ApiError(422, j.error ?? 'The report could not be read.');
        if (j.status === 'done') {
          if (j.error) throw new ApiError(422, j.error);
          const x = (await call<{ extraction: never | null }>('GET', `/documents/${enc(id)}/extraction`)).extraction;
          if (!x) throw new ApiError(502, 'The result could not be loaded. Try again.');
          return x;
        }
      }
      throw new ApiError(504, 'Reading is taking too long. Try again later, or upload a clearer picture.');
    },
    extraction: async id => (await call<{ extraction: never | null }>('GET', `/documents/${enc(id)}/extraction`)).extraction,
    verifyField: (docId, fieldId, body) => call('PUT', `/documents/${enc(docId)}/fields/${enc(fieldId)}`, body),
    downloadReferralPdf: async id => {
      const token = await getToken();
      if (!token) throw new ApiError(401, FALLBACK[401]!);
      let res: Response;
      try { res = await fetchImpl(`${baseUrl}/referrals/${enc(id)}/pdf`, { headers: { authorization: `Bearer ${token}` } }); }
      catch { throw new ApiError(0, FALLBACK[0]!); }
      if (!res.ok) throw new ApiError(res.status, messageFromBody(res.status, await res.json().catch(() => null)));
      const m = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '');
      return { filename: m?.[1] ?? `referral-${id.slice(0, 8)}.pdf`, blob: await res.blob() };
    },
    downloadReferral: async id => {
      const token = await getToken();
      if (!token) throw new ApiError(401, FALLBACK[401]!);
      let res: Response;
      try { res = await fetchImpl(`${baseUrl}/referrals/${enc(id)}/bundle`, { headers: { authorization: `Bearer ${token}` } }); }
      catch { throw new ApiError(0, FALLBACK[0]!); }
      if (!res.ok) throw new ApiError(res.status, messageFromBody(res.status, await res.json().catch(() => null)));
      const m = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '');
      return { filename: m?.[1] ?? `referral-${id.slice(0, 8)}.json`, text: await res.text() };
    },
  };
}
