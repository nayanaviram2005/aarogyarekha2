import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi, messageFromBody } from './api';
import { ageSex, formatAge, formatWait, isTier, latestVitals, roleLabel, TIER_WORD } from './format';

const NOW = new Date('2026-10-06T12:00:00Z');

describe('formatAge', () => {
  it('shows days for a newborn, months for an infant, years otherwise', () => {
    expect(formatAge({ birth_date: '2026-10-01', age_years_reported: null }, NOW)).toBe('5 d');
    expect(formatAge({ birth_date: '2026-04-06', age_years_reported: null }, NOW)).toBe('6 mo');
    expect(formatAge({ birth_date: '2018-10-05', age_years_reported: null }, NOW)).toBe('8 y');
  });
  it('uses the age reported at a camp when there is no birth date', () => {
    expect(formatAge({ birth_date: null, age_years_reported: 34 }, NOW)).toBe('34 y');
  });
  it('never invents an age', () => {
    expect(formatAge({ birth_date: null, age_years_reported: null }, NOW)).toBe('age unknown');
    expect(formatAge({ birth_date: 'garbage', age_years_reported: null }, NOW)).toBe('age unknown');
  });
  it('a birth date in the future is zero days, not negative', () => {
    expect(formatAge({ birth_date: '2030-01-01', age_years_reported: null }, NOW)).toBe('0 d');
  });
  it('combines age and sex', () => {
    expect(ageSex({ id: '1', public_ref: 'x', full_name: 'n', sex: 'female', birth_date: '2018-10-05', age_years_reported: null, preferred_language: 'en' }, NOW)).toBe('8 y, female');
  });
});

describe('formatWait', () => {
  it('formats minutes, hours and days, and shows nothing for an unknown time', () => {
    expect(formatWait('2026-10-06T11:58:00Z', NOW)).toBe('2 min');
    expect(formatWait('2026-10-06T10:55:00Z', NOW)).toBe('1 h 05 min');
    expect(formatWait('2026-10-04T12:00:00Z', NOW)).toBe('2 d');
    expect(formatWait('2026-10-06T11:59:50Z', NOW)).toBe('just now');
    expect(formatWait(null, NOW)).toBe('');
    expect(formatWait('nonsense', NOW)).toBe('');
  });
  it('a future time is "just now", not a negative wait', () => {
    expect(formatWait('2026-10-06T13:00:00Z', NOW)).toBe('just now');
  });
});

describe('small helpers', () => {
  it('latestVitals keeps the newest reading per kind', () => {
    const r = latestVitals([{ kind: 'pulse_bpm', measured_at: '2026-10-06T09:00:00Z', v: 1 }, { kind: 'pulse_bpm', measured_at: '2026-10-06T10:00:00Z', v: 2 }, { kind: 'temperature_c', measured_at: '2026-10-06T08:00:00Z', v: 3 }]);
    expect(r.map(x => x.v).sort()).toEqual([2, 3]);
  });
  it('isTier accepts only 1 to 4', () => {
    expect([1, 2, 3, 4].every(isTier)).toBe(true);
    expect([0, 5, null, undefined, '1', 2.5].some(isTier)).toBe(false);
  });
  it('every tier has a plain word', () => { expect(Object.values(TIER_WORD)).toEqual(['Immediate', 'Very urgent', 'Urgent', 'Routine']); });
  it('role labels are readable and an unknown role is shown as given', () => {
    expect(roleLabel('medical_officer')).toBe('Medical officer');
    expect(roleLabel('astronaut')).toBe('astronaut');
  });
});

describe('API error messages', () => {
  it('takes the plain message from an OperationOutcome', () => {
    expect(messageFromBody(403, { issue: [{ details: { text: 'No active consent for triage is recorded for this patient. Record consent first.' } }] })).toMatch(/consent/);
  });
  it('falls back to a safe message and never shows a raw body or stack trace', () => {
    expect(messageFromBody(500, { stack: 'at secret/file.js:1', message: 'boom' })).toBe('Something went wrong on the server. Try again.');
    expect(messageFromBody(404, 'html')).toMatch(/not found/i);
    expect(messageFromBody(418, null)).toBe('The request could not be completed.');
  });
});

describe('createApi', () => {
  const ok = (json: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } }));

  it('sends the bearer token and JSON body, and parses the response', async () => {
    const f = vi.fn().mockReturnValue(ok({ id: 'e1', status: 'draft' }, 201));
    const api = createApi('http://api', async () => 'tok', f as never);
    expect(await api.createEncounter({ patientId: 'p', scenario: 'opd_queue', language: 'en' })).toEqual({ id: 'e1', status: 'draft' });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('http://api/encounters');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toMatchObject({ patientId: 'p' });
  });
  it('sends no content-type header when there is no body (submit, assess)', async () => {
    const f = vi.fn().mockReturnValue(ok({ ok: true }));
    await createApi('http://api', async () => 'tok', f as never).submit('e1');
    expect(f.mock.calls[0]![1].headers['content-type']).toBeUndefined();
    expect(f.mock.calls[0]![1].body).toBeUndefined();
  });
  it('refuses to call the server without a token', async () => {
    const f = vi.fn();
    await expect(createApi('http://api', async () => null, f as never).queue()).rejects.toMatchObject({ status: 401 });
    expect(f).not.toHaveBeenCalled();
  });
  it('turns a network failure into a plain message', async () => {
    const api = createApi('http://api', async () => 't', (() => Promise.reject(new TypeError('Failed to fetch'))) as never);
    const e = (await api.queue().catch(x => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(0);
    expect(e.message).toMatch(/Cannot reach the server/);
  });
  it('recognises a consent refusal and a rules-not-approved refusal', async () => {
    const consent = createApi('http://api', async () => 't', (() => ok({ issue: [{ details: { text: 'No active consent for triage is recorded for this patient. Record consent first.' } }] }, 403)) as never);
    expect(await consent.createEncounter({ patientId: 'p', scenario: 'x', language: 'en' }).catch(x => x)).toMatchObject({ isConsent: true });
    const rules = createApi('http://api', async () => 't', (() => ok({ issue: [{ details: { text: 'Triage rules are not approved yet, so no assessment was stored.' } }] }, 503)) as never);
    expect(await rules.assess('e').catch(x => x)).toMatchObject({ isRulesNotApproved: true });
  });
  it('encodes the patient search and ids in the URL', async () => {
    const f = vi.fn().mockReturnValue(ok({ patients: [] }));
    const api = createApi('http://api', async () => 't', f as never);
    await api.patients('a b&c');
    expect(f.mock.calls[0]![0]).toBe('http://api/patients?q=a%20b%26c');
    f.mockReturnValue(ok({}));
    await api.summary('x/../y');
    expect(f.mock.calls[1]![0]).toBe('http://api/encounters/x%2F..%2Fy/summary');
  });
});
