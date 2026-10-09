import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Api, FhirBundle, ReferralMeta, ReferralView } from '../lib/types';
import { Narrative } from './Narrative';
import { ReferralNote, readNote } from './ReferralNote';
import { ReferralPanel } from './ReferralPanel';

const div = (inner: string) => ({ status: 'generated', div: `<div xmlns="http://www.w3.org/1999/xhtml">${inner}</div>` });
const bundle = (over: { status?: string; reviewer?: boolean } = {}): FhirBundle => ({
  resourceType: 'Bundle', type: 'document', entry: [
    { resource: { resourceType: 'Composition', id: 'c', status: over.status ?? 'final', title: 'Referral note', custodian: { reference: 'Organization/o1' },
      ...(over.reviewer === false ? {} : { attester: [{ mode: 'professional', time: '2026-10-06T11:00:00Z', party: { reference: 'Practitioner/p', display: 'Dr Mehta' } }] }),
      section: [{ title: 'Reason for referral', text: div('<p>Needs an obstetrician.</p>') }, { title: 'Measurements', text: div('<ul><li>Pulse: 90</li><li>Temperature: 37</li></ul>') }] } },
    { resource: { resourceType: 'Patient', id: 'pt', name: [{ text: 'Test Patient' }], gender: 'female', extension: [{ url: 'https://x/ext/age-years-reported', valueInteger: 27 }], identifier: [{ system: 'https://x/identifier/public-ref', value: 'AR-0001' }], communication: [{ language: { coding: [{ code: 'hi' }] } }] } },
    { resource: { resourceType: 'ServiceRequest', id: 'sr', priority: 'asap', performer: [{ reference: 'Organization/o2' }], extension: [{ url: 'x', extension: [{ url: 'tier', valueInteger: 2 }, { url: 'changedByReviewer', valueBoolean: true }] }] } },
    { resource: { resourceType: 'Organization', id: 'o1', name: 'Seed PHC' } }, { resource: { resourceType: 'Organization', id: 'o2', name: 'Seed District Hospital' } },
  ],
});
const meta = (over: Partial<ReferralMeta> = {}): ReferralMeta => ({ id: 'r1', encounterId: 'e1', patientId: 'p1', status: 'draft', priority: 'asap', reasonText: 'Needs an obstetrician.', toFacility: { id: 'f2', name: 'Seed District Hospital' }, sentAt: null, createdAt: '2026-10-06T11:10:00Z', bundleSha256: null, ...over });
const view = (m: ReferralMeta, readiness: Partial<ReferralView['readiness']> = {}, preview = true): ReferralView =>
  ({ referral: m, preview, bundle: bundle({ status: preview ? 'preliminary' : 'final' }), readiness: { signedOff: true, sharingConsent: true, hasReceiver: true, hasReason: true, ...readiness } });

describe('Narrative: shows document text without injecting markup', () => {
  it('renders paragraphs, lists and emphasis', () => {
    render(<div data-testid="n"><Narrative xhtml={'<div><p>Hello <strong>there</strong></p><ul><li>one</li><li>two</li></ul></div>'} /></div>);
    expect(screen.getByText('there').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
  it('drops scripts, images, links and event handlers, and keeps only their harmless text', () => {
    const { container } = render(<Narrative xhtml={'<div><p onclick="alert(1)">safe</p><script>alert(1)</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">click</a><iframe src="https://evil"></iframe></div>'} />);
    expect(container.querySelector('script, img, a, iframe')).toBeNull();
    expect(container.innerHTML).not.toMatch(/onclick|onerror|javascript:|alert\(1\)/);
    expect(screen.getByText('safe')).toBeInTheDocument();
    expect(screen.getByText('click')).toBeInTheDocument();
  });
  it('treats escaped text from the server as plain text', () => {
    const { container } = render(<Narrative xhtml={'<div><p>&lt;script&gt;alert(1)&lt;/script&gt;</p></div>'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });
});

describe('readNote', () => {
  it('pulls the header facts out of the document', () => {
    const n = readNote(bundle());
    expect(n).toMatchObject({ title: 'Referral note', from: 'Seed PHC', to: 'Seed District Hospital', priority: 'asap', tier: 2, changed: true, reviewer: 'Dr Mehta', status: 'final' });
    expect(n.patient).toMatchObject({ name: 'Test Patient', ref: 'AR-0001', age: '27 y', sex: 'female', language: 'hi' });
    expect(n.sections.map(s => s.title)).toEqual(['Reason for referral', 'Measurements']);
  });
  it('does not invent anything that is missing', () => {
    const n = readNote({ resourceType: 'Bundle', type: 'document', entry: [] });
    expect(n.patient).toBeNull(); expect(n.tier).toBeUndefined(); expect(n.reviewer).toBeUndefined();
  });
});

describe('ReferralNote', () => {
  const sentMeta = meta({ status: 'requested', sentAt: '2026-10-06T12:00:00Z', bundleSha256: 'ab'.repeat(32) });
  it('a preview is clearly marked as not sent, and shows every part of the note', () => {
    render(<ReferralNote view={view(meta())} onClose={() => {}} />);
    expect(screen.getByText(/PREVIEW. This referral has not been sent/)).toBeInTheDocument();
    expect(screen.getByText('Test Patient')).toBeInTheDocument();
    expect(screen.getByText('Seed District Hospital')).toBeInTheDocument();
    expect(screen.getByText('Needs an obstetrician.')).toBeInTheDocument();
    expect(screen.getByText('Pulse: 90')).toBeInTheDocument();
    expect(screen.getByText(/signed off by/i)).toHaveTextContent('Dr Mehta');
    expect(screen.getByRole('img', { name: /Very urgent/ })).toBeInTheDocument();
    expect(screen.getByText(/A reviewer changed the priority/)).toBeInTheDocument();
  });
  it('a sent note shows when it was sent and its checksum, with no preview banner', () => {
    render(<ReferralNote view={view(sentMeta, {}, false)} onClose={() => {}} />);
    expect(screen.queryByText(/PREVIEW/)).not.toBeInTheDocument();
    expect(screen.getByText(/Document checksum/)).toHaveTextContent('abababababababab');
  });
  it('says plainly when the priority has not been signed off', () => {
    const v = { ...view(meta()), bundle: bundle({ reviewer: false }) };
    render(<ReferralNote view={v} onClose={() => {}} />);
    expect(screen.getByText('The priority has not been signed off.')).toBeInTheDocument();
  });
  it('prints, closes on the button and on Escape, and offers a download only when given one', async () => {
    const onClose = vi.fn(); const print = vi.spyOn(window, 'print').mockImplementation(() => {}); const onDownload = vi.fn();
    const { rerender } = render(<ReferralNote view={view(sentMeta, {}, false)} onClose={onClose} onDownload={onDownload} />);
    await userEvent.click(screen.getByRole('button', { name: 'Print' })); expect(print).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Download FHIR file' })); expect(onDownload).toHaveBeenCalled();
    await userEvent.keyboard('{Escape}'); expect(onClose).toHaveBeenCalled();
    rerender(<ReferralNote view={view(meta())} onClose={onClose} />);
    expect(screen.queryByRole('button', { name: 'Download FHIR file' })).not.toBeInTheDocument();
    print.mockRestore();
  });
});

const fakeApi = (over: Partial<Record<keyof Api, unknown>> = {}) => ({
  referralsFor: vi.fn().mockResolvedValue([]), facilities: vi.fn().mockResolvedValue([{ id: 'f2', name: 'Seed District Hospital', type: 'district_hospital', state: 'Odisha', district: 'Khordha', capabilities: ['obstetrics'] }]),
  createReferral: vi.fn().mockResolvedValue(meta()), referral: vi.fn(), updateReferral: vi.fn().mockResolvedValue({}), cancelReferral: vi.fn().mockResolvedValue({}),
  sendReferral: vi.fn().mockResolvedValue({}), downloadReferral: vi.fn().mockResolvedValue({ filename: 'r.json', text: '{}' }), downloadReferralPdf: vi.fn().mockResolvedValue({ filename: 'r.pdf', blob: new Blob(['%PDF-']) }), recordConsent: vi.fn().mockResolvedValue({ id: 'c' }), ...over,
}) as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
const props = { encounterId: 'e1', patientId: 'p1', effectiveUrgency: 'orange' as const, signedOff: true, canReview: true, onChanged: () => {} };

describe('ReferralPanel: before a referral exists', () => {
  it('asks for sign-off first, and offers no form', async () => {
    render(<ReferralPanel {...props} api={fakeApi()} signedOff={false} />);
    expect(await screen.findByText(/Sign off the priority above first/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Reason for referral')).not.toBeInTheDocument();
  });
  it('someone who cannot review is told who prepares referrals', async () => {
    render(<ReferralPanel {...props} api={fakeApi()} canReview={false} />);
    expect(await screen.findByText(/nurse, doctor or medical officer prepares referrals/)).toBeInTheDocument();
  });
  it('needs a facility and a written reason of at least 10 characters before it can be saved', async () => {
    const api = fakeApi();
    render(<ReferralPanel {...props} api={api} />);
    const save = await screen.findByRole('button', { name: 'Save referral draft' });
    expect(save).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('Refer to'), 'f2');
    await userEvent.type(screen.getByLabelText('Reason for referral'), 'too short');
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reason for referral'), ' and now long enough');
    expect(save).toBeEnabled();
  });
  it('suggests the request priority from the review priority and saves exactly what the person wrote', async () => {
    const api = fakeApi(); const onChanged = vi.fn();
    render(<ReferralPanel {...props} api={api} onChanged={onChanged} />);
    await screen.findByRole('button', { name: 'Save referral draft' });
    expect(screen.getByLabelText('Request priority')).toHaveValue('asap');
    await userEvent.selectOptions(screen.getByLabelText('Refer to'), 'f2');
    await userEvent.type(screen.getByLabelText('Reason for referral'), 'Needs an obstetrician.');
    await userEvent.click(screen.getByRole('button', { name: 'Save referral draft' }));
    expect(api.createReferral).toHaveBeenCalledWith('e1', { toFacilityId: 'f2', priority: 'asap', reasonText: 'Needs an obstetrician.' });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
  it('says the reason is the clinician\'s own, with no suggested diagnosis', async () => {
    render(<ReferralPanel {...props} api={fakeApi()} />);
    expect(await screen.findByText(/does not suggest a reason, a diagnosis or a treatment/i)).toBeInTheDocument();
  });
  it('shows the server\'s plain message when saving fails', async () => {
    const api = fakeApi({ createReferral: vi.fn().mockRejectedValue(new ApiError(409, 'A referral is already open for this encounter.')) });
    render(<ReferralPanel {...props} api={api} />);
    await screen.findByRole('button', { name: 'Save referral draft' });
    await userEvent.selectOptions(screen.getByLabelText('Refer to'), 'f2');
    await userEvent.type(screen.getByLabelText('Reason for referral'), 'Needs an obstetrician.');
    await userEvent.click(screen.getByRole('button', { name: 'Save referral draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A referral is already open for this encounter.');
  });
});

describe('ReferralPanel: a draft', () => {
  const draft = (readiness: Partial<ReferralView['readiness']> = {}, apiOver = {}) =>
    fakeApi({ referralsFor: vi.fn().mockResolvedValue([meta()]), referral: vi.fn().mockResolvedValue(view(meta(), readiness)), ...apiOver });

  it('shows what is ready and what is not, and will not send until everything is ready', async () => {
    render(<ReferralPanel {...props} api={draft({ sharingConsent: false })} />);
    const list = await screen.findByRole('list', { name: 'Before sending' });
    expect(within(list).getByText(/patient has consented/).parentElement).toHaveTextContent('✗');
    expect(within(list).getByText(/signed off the priority/).parentElement).toHaveTextContent('✓');
    expect(screen.getByRole('button', { name: 'Send referral' })).toBeDisabled();
    expect(screen.getByText(/Send is available when every item above is ticked/)).toBeInTheDocument();
  });
  it('without sharing consent it offers the sharing consent form, and records the right purpose', async () => {
    const api = draft({ sharingConsent: false });
    render(<ReferralPanel {...props} api={api} />);
    expect(await screen.findByText('Record consent to share this referral')).toBeInTheDocument();
    expect(screen.getByText(/does not include your phone number or street address/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Witness name'), 'A. Witness');
    await userEvent.click(screen.getByRole('button', { name: 'Record consent' }));
    expect(api.recordConsent).toHaveBeenCalledWith('p1', expect.objectContaining({ purpose: 'referral_sharing', method: 'verbal_witnessed', witnessName: 'A. Witness' }));
  });
  it('sending is a two-step action that names the receiving facility, and cancel sends nothing', async () => {
    const api = draft();
    render(<ReferralPanel {...props} api={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Send referral' }));
    expect(screen.getByText(/cannot be changed or taken back after it is sent/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Confirm sending' })).toHaveTextContent('Seed District Hospital');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.sendReferral).not.toHaveBeenCalled();
  });
  it('confirming sends that exact referral and refreshes the encounter', async () => {
    const api = draft(); const onChanged = vi.fn();
    render(<ReferralPanel {...props} api={api} onChanged={onChanged} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Send referral' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Confirm sending' })).getByRole('button', { name: 'Send referral' }));
    expect(api.sendReferral).toHaveBeenCalledWith('r1');
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
  it('a refusal from the server is shown in plain words and nothing is reported as sent', async () => {
    const api = draft({}, { sendReferral: vi.fn().mockRejectedValue(new ApiError(409, 'The assessment changed while the referral was being prepared. Review the latest assessment, then prepare the referral again.')) });
    const onChanged = vi.fn();
    render(<ReferralPanel {...props} api={api} onChanged={onChanged} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Send referral' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Confirm sending' })).getByRole('button', { name: 'Send referral' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/assessment changed/);
    expect(onChanged).not.toHaveBeenCalled();
  });
  it('previews the note, and discarding is a two-step action', async () => {
    const api = draft();
    render(<ReferralPanel {...props} api={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Preview note' }));
    expect(screen.getByRole('dialog', { name: 'Referral note' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(api.cancelReferral).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole('group', { name: 'Confirm discarding the draft' })).getByRole('button', { name: 'Discard draft' }));
    expect(api.cancelReferral).toHaveBeenCalledWith('r1');
  });
  it('a person who cannot review sees the draft but cannot send, edit or discard it', async () => {
    render(<ReferralPanel {...props} api={draft()} canReview={false} />);
    expect(await screen.findByRole('button', { name: 'Send referral' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard draft' })).not.toBeInTheDocument();
  });
});

describe('ReferralPanel: a sent referral', () => {
  const sentMeta = meta({ status: 'requested', sentAt: '2026-10-06T12:00:00Z', bundleSha256: 'cd'.repeat(32) });
  const api = () => fakeApi({ referralsFor: vi.fn().mockResolvedValue([sentMeta]), referral: vi.fn().mockResolvedValue(view(sentMeta, {}, false)) });

  it('shows it as sent, with the checksum, and no way to edit or send again', async () => {
    render(<ReferralPanel {...props} api={api()} />);
    expect(await screen.findByText('Sent', { selector: '.chip' })).toBeInTheDocument();
    expect(screen.getByText(/cdcdcdcdcdcdcdcd/)).toBeInTheDocument();
    for (const name of ['Send referral', 'Edit', 'Discard draft']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  });
  it('downloads the frozen FHIR file', async () => {
    const a = api(); const create = vi.fn(() => 'blob:x'); const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    render(<ReferralPanel {...props} api={a} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Download FHIR file' }));
    await waitFor(() => expect(a.downloadReferral).toHaveBeenCalledWith('r1'));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:x'));
  });
  it('downloads the frozen note as a PDF', async () => {
    const a = api(); const create = vi.fn(() => 'blob:p'); const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    render(<ReferralPanel {...props} api={a} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(a.downloadReferralPdf).toHaveBeenCalledWith('r1')); await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:p'));
  });
  it('a failed PDF download is shown in words', async () => {
    const a = api(); (a.downloadReferralPdf as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('The PDF could not be made. Download the FHIR file instead.'));
    render(<ReferralPanel {...props} api={a} />); await userEvent.click(await screen.findByRole('button', { name: 'Download PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be made');
  });
  it('a cancelled earlier referral does not block preparing a new one', async () => {
    const a = fakeApi({ referralsFor: vi.fn().mockResolvedValue([meta({ status: 'cancelled' })]) });
    render(<ReferralPanel {...props} api={a} />);
    expect(await screen.findByText(/Earlier referral: cancelled to Seed District Hospital/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save referral draft' })).toBeInTheDocument();
  });
});
