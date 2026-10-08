import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Api, EncounterSummary } from '../lib/types';
import { ScenarioChecklist } from './ScenarioChecklist';
import { TemplateFields } from './TemplateFields';
import { TrendPanel } from './TrendPanel';

const summary = (scenario: string, notes: string[] = [], vitalKinds: string[] = []): EncounterSummary => ({ encounter: { id: 'e1', scenario, language: 'en' }, symptoms: notes.map((t, i) => ({ id: String(i), text_original: t })), vitals: vitalKinds.map(k => ({ kind: k })) } as unknown as EncounterSummary);
const api = (over: Record<string, unknown> = {}) => ({ addSymptom: vi.fn().mockResolvedValue({ id: 's' }), trends: vi.fn().mockResolvedValue([]), ...over }) as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;

describe('ScenarioChecklist', () => {
  it('shows nothing for a visit type with no template', () => { const { container } = render(<ScenarioChecklist api={api()} summary={summary('opd_queue')} editable onChanged={() => {}} />); expect(container).toBeEmptyDOMElement(); });
  it('lists recorded and not recorded items and says it does not change the priority', () => {
    render(<ScenarioChecklist api={api()} summary={summary('occupational', ['Exposure at work: dust'])} editable onChanged={() => {}} />);
    expect(screen.getByText(/3 still not recorded/)).toBeInTheDocument(); expect(screen.getByText(/does not change the priority/)).toBeInTheDocument(); expect(screen.getAllByText('Recorded')).toHaveLength(1);
  });
  it('adds a missing item as "Label: answer" in the visit language, then refreshes', async () => {
    const a = api(); const onChanged = vi.fn(); render(<ScenarioChecklist api={a} summary={summary('occupational')} editable onChanged={onChanged} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!); await userEvent.type(screen.getByLabelText('Workplace and the work done there'), ' stone crusher '); await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(a.addSymptom).toHaveBeenCalledWith('e1', { text: 'Workplace and the work done there: stone crusher', lang: 'en' })); expect(onChanged).toHaveBeenCalled();
  });
  it('a choice field offers its options', async () => {
    render(<ScenarioChecklist api={api()} summary={summary('chronic_checkin')} editable onChanged={() => {}} />);
    const addButtons = screen.getAllByRole('button', { name: 'Add' }); await userEvent.click(addButtons[1]!); expect(screen.getByRole('option', { name: 'Sometimes' })).toBeInTheDocument();
  });
  it('read-only encounters have no Add buttons; a complete checklist says so', () => {
    const { unmount } = render(<ScenarioChecklist api={api()} summary={summary('occupational')} editable={false} onChanged={() => {}} />); expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument(); unmount();
    render(<ScenarioChecklist api={api()} summary={summary('occupational', ['Workplace and the work done there: a', 'Exposure at work: b', 'Protective equipment used: Yes', 'Shift or hours worked today: 8'])} editable onChanged={() => {}} />);
    expect(screen.getByText(/Everything usually asked for this type of visit is recorded/)).toBeInTheDocument();
  });
});

describe('TemplateFields', () => {
  const Host = ({ scenario }: { scenario: string }) => { const [v, setV] = useState<Record<string, string>>({}); return <><TemplateFields scenario={scenario} values={v} onChange={setV} lang="en" /><output data-testid="v">{JSON.stringify(v)}</output></>; };
  it('renders the questions for the visit type and keeps answers', async () => {
    render(<Host scenario="campus_fever" />); await userEvent.type(screen.getByLabelText('Hostel or department'), 'Block C'); await userEvent.selectOptions(screen.getByLabelText(/Others unwell/), 'Several');
    expect(screen.getByTestId('v').textContent).toContain('Block C'); expect(screen.getByTestId('v').textContent).toContain('Several');
  });
  it('renders nothing for plain visits', () => { const { container } = render(<Host scenario="opd_queue" />); expect(container.querySelector('fieldset')).toBeNull(); });
});

describe('TrendPanel', () => {
  const pts = [{ kind: 'bp_systolic_mmhg', value: 140, unit: 'mm[Hg]', at: '2026-08-01T00:00:00Z', encounterId: 'a' }, { kind: 'bp_systolic_mmhg', value: 160, unit: 'mm[Hg]', at: '2026-09-01T00:00:00Z', encounterId: 'b' }];
  it('says it shows what changed and not what it means', async () => { render(<TrendPanel api={api()} patientId="p" />); expect(await screen.findByText(/does not say whether a value is good or bad/)).toBeInTheDocument(); });
  it('summarises latest, earlier, range and direction in plain words', async () => {
    render(<TrendPanel api={api({ trends: vi.fn().mockResolvedValue(pts) })} patientId="p" />);
    expect(await screen.findByText(/Blood pressure, top number/)).toBeInTheDocument(); expect(screen.getByText(/Lowest 140, highest 160/)).toBeInTheDocument(); expect(screen.getByText(/Higher than the average of the earlier readings/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Last 2 readings' })).toBeInTheDocument();
  });
  it('says plainly when there are no readings; shows a load error', async () => {
    const { unmount } = render(<TrendPanel api={api()} patientId="p" />); expect(await screen.findByText('No blood pressure or sugar readings recorded yet.')).toBeInTheDocument(); unmount();
    render(<TrendPanel api={api({ trends: vi.fn().mockRejectedValue(new Error('Trends are not set up.')) })} patientId="p" />); expect(await screen.findByRole('alert')).toHaveTextContent('not set up');
  });
});
