import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Deps } from '../src/deps.js';

const E = '33333333-3333-4333-8333-333333333333';
const deps: Deps = {
  verifyToken: async t => (t === 'ok' ? { userId: 'u1' } : null),
  userReader: () => ({ getPatient: async () => null, getIdentifiers: async () => [], getEncounter: async () => null, getVitals: async () => [] }) as never,
  userWriter: () => { throw new Error('unused'); },
  assess: async () => { throw new Error('unused'); },
  review: async () => { throw new Error('unused'); },
  translator: { name: 'mock', model: 'mock', generate: async () => ({ text: '{}', provider: 'mock', model: 'mock' }) }, saveSymptomTranslations: async () => {}, logExternalRun: async () => {}, readText: async () => ({ engine: 'mock', engineVersion: null, text: '', confidence: 1, language: null }), finishUpload: async () => {}, failUpload: async () => {}, saveExtraction: async () => ({ extractionId: 'x' }), sendReferral: async () => { throw new Error('unused'); },
  audit: async () => {},
};
const make = () => buildApp({ allowedOrigins: ['http://localhost:5173'] }, deps);
const auth = { authorization: 'Bearer ok' };

describe('request bodies', () => {
  it('a POST with a JSON content-type and NO body is accepted as an empty request (not a 500)', async () => {
    const r = await (await make()).inject({ method: 'POST', url: `/encounters/${E}/submit`, headers: { ...auth, 'content-type': 'application/json' } });
    expect(r.statusCode).toBe(404);          // reaches the route; the encounter is simply not visible
  });
  it('malformed JSON is a plain 400, not a 500', async () => {
    const r = await (await make()).inject({ method: 'POST', url: '/encounters', headers: { ...auth, 'content-type': 'application/json' }, payload: '{"patientId": ' });
    expect(r.statusCode).toBe(400);
    expect(r.json().resourceType).toBe('OperationOutcome');
    expect(r.body).not.toMatch(/Unexpected|JSON\.parse|position/);
  });
  it('rejects prototype-poisoning keys with 400', async () => {
    const r = await (await make()).inject({ method: 'PUT', url: `/encounters/${E}/triage-inputs`, headers: { ...auth, 'content-type': 'application/json' }, payload: '{"signs":{"__proto__":{"x":true}}}' });
    expect(r.statusCode).toBe(400);
  });
  it('an oversized body is refused with a plain message', async () => {
    const r = await (await make()).inject({ method: 'POST', url: '/encounters', headers: { ...auth, 'content-type': 'application/json' }, payload: JSON.stringify({ x: 'a'.repeat(300 * 1024) }) });
    expect(r.statusCode).toBe(413);
  });
  it('an unsupported content type is refused', async () => {
    const r = await (await make()).inject({ method: 'POST', url: '/encounters', headers: { ...auth, 'content-type': 'text/plain' }, payload: 'hello' });
    expect([400, 415]).toContain(r.statusCode);
  });
});

describe('CORS for the browser frontend', () => {
  const preflight = async (origin: string, method: string) =>
    (await make()).inject({ method: 'OPTIONS', url: `/encounters/${E}/triage-inputs`, headers: { origin, 'access-control-request-method': method, 'access-control-request-headers': 'authorization,content-type' } });

  it('allows PUT from the configured frontend origin', async () => {
    const r = await preflight('http://localhost:5173', 'PUT');
    expect(r.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(String(r.headers['access-control-allow-methods'])).toContain('PUT');
  });
  it('gives nothing to any other origin', async () => {
    const r = await preflight('http://evil.example', 'PUT');
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('does not allow DELETE', async () => {
    const r = await preflight('http://localhost:5173', 'DELETE');
    expect(String(r.headers['access-control-allow-methods'] ?? '')).not.toContain('DELETE');
  });
});
