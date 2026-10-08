import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Api } from '../lib/types';
import { buildRegistration, RegisterPatientForm } from './RegisterPatientForm';

const base = { fullName: 'Meera Das', sex: 'female' as const, age: '28', birthDate: '', language: 'or' };
const api = (registerPatient: unknown) => ({ registerPatient }) as unknown as Api & { registerPatient: ReturnType<typeof vi.fn> };
const dupErr = new ApiError(409, 'Someone with the same name and age is already registered. Check the list, or confirm this is a different person.', [{ id: 'old', publicRef: 'AR-0001', fullName: 'Meera Das', sex: 'female', birthDate: null, ageYears: 28 }]);

describe('buildRegistration', () => {
  it('builds a request from an age', () => {
    expect(buildRegistration(base)).toEqual({ fullName: 'Meera Das', sex: 'female', preferredLanguage: 'or', ageYears: 28 });
  });
  it('a birth date wins over an age, and optional fields are included only when typed', () => {
    expect(buildRegistration({ ...base, birthDate: '1998-02-03', phone: '98765 43210', village: ' Jatni ' })).toEqual({ fullName: 'Meera Das', sex: 'female', preferredLanguage: 'or', birthDate: '1998-02-03', phone: '98765 43210', villageTown: 'Jatni' });
  });
  it.each([['empty name', { fullName: ' ' }, /name/], ['markup name', { fullName: '<b>' }, /letters/], ['no age', { age: '' }, /age/], ['age text', { age: 'x' }, /age/], ['age 200', { age: '200' }, /age/], ['future birth date', { birthDate: '2999-01-01' }, /future/], ['bad phone', { phone: 'abc' }, /phone/]])('refuses %s in plain words', (_n, over, msg) => {
    const r = buildRegistration({ ...base, ...over });
    expect(typeof r).toBe('string'); expect(r as string).toMatch(msg);
  });
  it('accepts Hindi and Odia names', () => {
    expect(buildRegistration({ ...base, fullName: 'अनीता राव' })).toMatchObject({ fullName: 'अनीता राव' });
    expect(buildRegistration({ ...base, fullName: 'ଅନୀତା ରାଓ' })).toMatchObject({ fullName: 'ଅନୀତା ରାଓ' });
  });
});

describe('RegisterPatientForm', () => {
  const fill = async () => { await userEvent.type(screen.getByLabelText('Full name'), 'Meera Das'); await userEvent.type(screen.getByLabelText('Age in years'), '28'); };
  it('registers and hands the new patient to the screen', async () => {
    const onRegistered = vi.fn(); const a = api(vi.fn().mockResolvedValue({ id: 'p1', publicRef: 'AR-0007' }));
    render(<RegisterPatientForm api={a} onRegistered={onRegistered} />);
    await fill(); await userEvent.selectOptions(screen.getByLabelText('Sex'), 'female'); await userEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    await waitFor(() => expect(onRegistered).toHaveBeenCalledWith({ id: 'p1', public_ref: 'AR-0007', full_name: 'Meera Das', sex: 'female', birth_date: null, age_years_reported: 28, preferred_language: 'en' }));
    expect(a.registerPatient).toHaveBeenCalledWith({ fullName: 'Meera Das', sex: 'female', preferredLanguage: 'en', ageYears: 28 });
  });
  it('shows a form problem without calling the server', async () => {
    const a = api(vi.fn()); render(<RegisterPatientForm api={a} onRegistered={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/name/); expect(a.registerPatient).not.toHaveBeenCalled();
  });
  it('a typed birth date turns the age box off', async () => {
    render(<RegisterPatientForm api={api(vi.fn())} onRegistered={() => {}} />);
    await userEvent.type(screen.getByLabelText('Or date of birth'), '1998-02-03'); expect(screen.getByLabelText('Age in years')).toBeDisabled();
  });
  it('on a probable duplicate it shows who, can use them instead, and does not register', async () => {
    const onUse = vi.fn(); const onRegistered = vi.fn(); const a = api(vi.fn().mockRejectedValue(dupErr));
    render(<RegisterPatientForm api={a} onRegistered={onRegistered} onUseExisting={onUse} />);
    await fill(); await userEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    expect(await screen.findByText(/already registered/)).toBeInTheDocument(); expect(screen.getByText(/AR-0001/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use this person' }));
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ id: 'old' })); expect(onRegistered).not.toHaveBeenCalled();
  });
  it('"different person" registers again with the confirmation flag', async () => {
    const reg = vi.fn().mockRejectedValueOnce(dupErr).mockResolvedValue({ id: 'p2', publicRef: 'AR-0008' }); const onRegistered = vi.fn();
    render(<RegisterPatientForm api={api(reg)} onRegistered={onRegistered} />);
    await fill(); await userEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    await userEvent.click(await screen.findByRole('button', { name: /different person/ }));
    await waitFor(() => expect(onRegistered).toHaveBeenCalled());
    expect(reg.mock.calls[1]![0]).toMatchObject({ confirmNotDuplicate: true });
  });
  it('editing a field after a duplicate warning clears the warning (it no longer applies)', async () => {
    render(<RegisterPatientForm api={api(vi.fn().mockRejectedValue(dupErr))} onRegistered={() => {}} />);
    await fill(); await userEvent.click(screen.getByRole('button', { name: 'Register patient' })); await screen.findByText(/already registered/);
    await userEvent.type(screen.getByLabelText('Full name'), 'a'); expect(screen.queryByText(/already registered/)).not.toBeInTheDocument();
  });
  it('other server errors are shown in words', async () => {
    render(<RegisterPatientForm api={api(vi.fn().mockRejectedValue(new ApiError(403, 'You are not allowed to register patients at that facility.')))} onRegistered={() => {}} />);
    await fill(); await userEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not allowed');
  });
  it('cancel is offered only when the screen gives a way to cancel', async () => {
    const onCancel = vi.fn(); render(<RegisterPatientForm api={api(vi.fn())} onRegistered={() => {}} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(onCancel).toHaveBeenCalled();
  });
});
