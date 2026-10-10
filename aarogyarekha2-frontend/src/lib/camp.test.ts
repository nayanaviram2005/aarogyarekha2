import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { blankRow, isBlank, processRow, rowProblem, type CampRow } from './camp';
import type { Api } from './types';

const row = (over: Partial<CampRow> = {}): CampRow => ({ ...blankRow('k'), name: 'Meera Das', sex: 'female', age: '28', language: 'or', complaint: 'bukhar', temperature: '38.6', consented: true, ...over });
const api = (over: Record<string, unknown> = {}) => ({
  registerPatient: vi.fn().mockResolvedValue({ id: 'p1', publicRef: 'AR-1' }), recordConsent: vi.fn().mockResolvedValue({ id: 'c1' }), createEncounter: vi.fn().mockResolvedValue({ id: 'e1', status: 'draft' }),
  addVital: vi.fn().mockResolvedValue({ id: 'v' }), submit: vi.fn().mockResolvedValue({}), assess: vi.fn().mockResolvedValue({}), ...over,
}) as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;

describe('rowProblem', () => {
  it('a complete row has no problem', () => { expect(rowProblem(row(), 'A. Witness')).toBeNull(); });
  it.each([
    ['no name', { name: '' }, /name/], ['no age', { age: '' }, /age/], ['no complaint', { complaint: ' ' }, /complaint/], ['odd temperature', { temperature: '380' }, /Temperature/], ['text temperature', { temperature: 'hot' }, /Temperature/], ['no consent', { consented: false }, /Consent has not been recorded/],
  ])('%s', (_n, over, msg) => { expect(rowProblem(row(over), 'W')).toMatch(msg); });
  it('needs the witness name', () => { expect(rowProblem(row(), '  ')).toMatch(/witness/); });
  it('temperature is optional', () => { expect(rowProblem(row({ temperature: '' }), 'W')).toBeNull(); });
});

describe('isBlank', () => { it('a row with nothing typed is blank', () => { expect(isBlank(blankRow('x'))).toBe(true); expect(isBlank(row())).toBe(false); }); });

describe('processRow', () => {
  it('does every step in order for a complete row, as a witnessed spoken consent for triage', async () => {
    const a = api(); const order: string[] = [];
    for (const k of ['registerPatient', 'recordConsent', 'createEncounter', 'addVital', 'submit', 'assess']) a[k]!.mockImplementation(async () => { order.push(k); return { id: 'x' }; });
    const r = await processRow(a, row(), 'A. Witness');
    expect(order).toEqual(['registerPatient', 'recordConsent', 'createEncounter', 'addVital', 'submit', 'assess']);
    expect(r).toMatchObject({ status: 'done', message: 'In the queue and assessed.' });
    expect(a.recordConsent).toHaveBeenCalledWith('x', expect.objectContaining({ purpose: 'care_triage', method: 'verbal_witnessed', givenBy: 'self', witnessName: 'A. Witness' }));
    expect(a.createEncounter).toHaveBeenCalledWith(expect.objectContaining({ patientId: 'x' }));
  });
  it('uses the health camp visit type, and records temperature only when typed', async () => {
    const a = api(); await processRow(a, row({ temperature: '' }), 'W');
    expect(a.createEncounter).toHaveBeenCalledWith(expect.objectContaining({ scenario: 'health_camp', language: 'or', chiefComplaint: 'bukhar' })); expect(a.addVital).not.toHaveBeenCalled();
  });
  it('a row with a problem sends NOTHING', async () => {
    const a = api(); const r = await processRow(a, row({ consented: false }), 'W');
    expect(r.status).toBe('fail'); expect(a.registerPatient).not.toHaveBeenCalled();
  });
  it('no encounter is made when consent could not be recorded, and a retry does not register the person again', async () => {
    const a = api({ recordConsent: vi.fn().mockRejectedValueOnce(new ApiError(502, 'The change could not be saved. Try again.')).mockResolvedValue({ id: 'c' }) });
    const first = await processRow(a, row(), 'W');
    expect(first.status).toBe('fail'); expect(first.message).toMatch(/Try again to continue/); expect(a.createEncounter).not.toHaveBeenCalled(); expect(first.progress.patientId).toBe('p1');
    const second = await processRow(a, first, 'W');
    expect(second.status).toBe('done'); expect(a.registerPatient).toHaveBeenCalledTimes(1); expect(a.recordConsent).toHaveBeenCalledTimes(2);
  });
  it('a retry after the encounter exists does not create a second one or repeat the temperature', async () => {
    const a = api({ submit: vi.fn().mockRejectedValueOnce(new ApiError(502, 'x')).mockResolvedValue({}) });
    const first = await processRow(a, row(), 'W'); expect(first.status).toBe('fail');
    const second = await processRow(a, first, 'W');
    expect(second.status).toBe('done'); expect(a.createEncounter).toHaveBeenCalledTimes(1); expect(a.addVital).toHaveBeenCalledTimes(1); expect(a.submit).toHaveBeenCalledTimes(2);
  });
  it('records a separate training consent only when the person agreed to it, and only once on a retry', async () => {
    const none = api(); await processRow(none, row(), 'W');
    expect(none.recordConsent).toHaveBeenCalledTimes(1);
    const a = api({ submit: vi.fn().mockRejectedValueOnce(new ApiError(502, 'x')).mockResolvedValue({}) });
    const first = await processRow(a, row({ training: true }), 'A. Witness'); expect(first.status).toBe('fail');
    const second = await processRow(a, first, 'A. Witness'); expect(second.status).toBe('done');
    expect(a.recordConsent).toHaveBeenCalledTimes(2);
    expect(a.recordConsent).toHaveBeenNthCalledWith(2, 'p1', expect.objectContaining({ purpose: 'research_deidentified', witnessName: 'A. Witness', givenBy: 'self' }));
  });
  it('a probable duplicate stops the row and shows who; ticking "different person" sends the confirmation', async () => {
    const dup = new ApiError(409, 'Someone ... already registered', [{ id: 'old', publicRef: 'AR-0001', fullName: 'Meera Das', sex: 'female', birthDate: null, ageYears: 28 }]);
    const a = api({ registerPatient: vi.fn().mockRejectedValueOnce(dup).mockResolvedValue({ id: 'p2', publicRef: 'AR-2' }) });
    const first = await processRow(a, row(), 'W');
    expect(first).toMatchObject({ status: 'duplicate', duplicates: [{ id: 'old' }] }); expect(a.recordConsent).not.toHaveBeenCalled();
    const second = await processRow(a, { ...first, notDuplicate: true }, 'W');
    expect(second.status).toBe('done'); expect((a.registerPatient as unknown as ReturnType<typeof vi.fn>).mock.calls[1]![0]).toMatchObject({ confirmNotDuplicate: true });
  });
  it('rules not approved: the person is queued and the row says it was not assessed', async () => {
    const r = await processRow(api({ assess: vi.fn().mockRejectedValue(new ApiError(503, 'Triage rules are not approved yet, so no assessment was stored.')) }), row(), 'W');
    expect(r).toMatchObject({ status: 'done' }); expect(r.message).toMatch(/Not assessed/);
  });
  it('another assess failure still counts as queued, with an instruction', async () => {
    const r = await processRow(api({ assess: vi.fn().mockRejectedValue(new ApiError(502, 'x')) }), row(), 'W');
    expect(r.status).toBe('done'); expect(r.message).toMatch(/Open the record and assess/);
  });
});
