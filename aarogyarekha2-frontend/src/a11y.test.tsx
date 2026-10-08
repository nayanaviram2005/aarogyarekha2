// Automated accessibility checks (axe-core) on the screens and panels. This catches missing labels, bad roles, duplicate ids,
// empty buttons, wrong heading use, and similar. It CANNOT judge colour contrast (jsdom has no layout) or whether a screen reader
// reads things in a sensible order: those still need a person. See docs/05-frontend.md.
import { render, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from './lib/types';

const h = vi.hoisted(() => ({ api: null as unknown }));
vi.mock('./auth/AuthProvider', () => ({ useAuth: () => ({ api: h.api, demo: false, signIn: async () => null, notice: null, mfa: null, signOut: async () => {} }) }));
vi.mock('./screens/queueContext', () => ({ useQueue: () => ({ entries: [], loading: false, error: null, generatedAt: null, refresh: vi.fn() }) }));
vi.mock('./screens/PaneFrame', () => ({ PaneFrame: ({ center }: { center: React.ReactNode }) => <div>{center}</div> }));

import { AnalyticsPanel } from './components/AnalyticsPanel';
import { ConsentForm } from './components/ConsentForm';
import { FollowupsPanel } from './components/FollowupsPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { MeasurementForm } from './components/MeasurementForm';
import { MfaPanel } from './components/MfaPanel';
import { NotesPanel } from './components/NotesPanel';
import { UrgencyPlate } from './components/Plate';
import { QueueFilterBar } from './components/QueueFilterBar';
import { RegisterPatientForm } from './components/RegisterPatientForm';
import { ScenarioChecklist } from './components/ScenarioChecklist';
import { SwitchPatient } from './components/SwitchPatient';
import { TemplateFields } from './components/TemplateFields';
import { TrendPanel } from './components/TrendPanel';
import { MembersPanel } from './components/MembersPanel';
import { ReportDetails } from './components/ReportDetails';
import { CaseSummary } from './components/CaseSummary';
import { VisitPanel } from './components/VisitPanel';
import { JourneyBar } from './components/JourneyBar';
import { StepPanel } from './components/StepPanel';
import { Fold } from './components/Fold';
import { journey } from './lib/journey';
import { AccountMenu } from './components/AccountMenu';
import { SettingsPage } from './screens/SettingsPage';
import { DoneToday, QueueCounts } from './components/QueueFlow';
import { AdminPage } from './screens/AdminPage';
import { BreakGlassPage } from './screens/BreakGlassPage';
import { CampBatchPage } from './screens/CampBatchPage';
import { OfflinePage } from './screens/OfflinePage';
import { ReferralsPage } from './screens/ReferralsPage';
import { ScenariosPage } from './screens/ScenariosPage';
import { SignIn } from './screens/SignIn';
import { NO_FILTER } from './lib/queueFilter';

const empty = () => vi.fn().mockResolvedValue([]);
const api = {
  history: empty(), followups: empty(), notes: empty(), trends: empty(), incomingReferrals: empty(), sentReferrals: empty(), breakGlassList: empty(), patients: empty(), memberChanges: empty(), queueDone: empty(),
  members: vi.fn().mockResolvedValue([{ userId: 'u1', facilityId: 'f', role: 'nurse', active: true, since: '2026-01-01T00:00:00Z', name: 'Ravi', email: 'r@x.in', isSelf: false, canChange: true }, { userId: 'u2', facilityId: 'f', role: 'facility_admin', active: true, since: '2026-01-01T00:00:00Z', name: 'Asha', email: 'a@x.in', isSelf: true, canChange: false }]),
  auditFlags: vi.fn().mockResolvedValue({ hours: 24, examined: 0, rulesValidated: false, flags: [] }),
  analytics: vi.fn().mockResolvedValue({ days: 30, encounters: 3, submitted: 3, assessed: 3, reviewed: 2, byScenario: [{ scenario: 'opd_queue', n: 3 }], byUrgency: [{ urgency: 'red', n: 1 }], secondsToAssessment: { n: 3, median: 1, p90: 2 }, minutesToReview: { n: 2, median: 5, p90: 9 }, review: { approved: 1, changed: 1, loweredBelowRules: 0, agreementRate: 0.5 }, feedback: { helpful: 1, notHelpful: 0 }, note: 'n' }),
  recordConsent: vi.fn(), registerPatient: vi.fn(), addVital: vi.fn(), addSymptom: vi.fn(),
} as unknown as Api;
h.api = api;

async function violations(ui: React.ReactElement, settle: () => Promise<void> | void = () => {}) {
  const { container } = render(<MemoryRouter>{ui}</MemoryRouter>);
  await settle(); await new Promise(r => setTimeout(r, 30));
  const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false }, 'landmark-one-main': { enabled: false }, 'page-has-heading-one': { enabled: false } } });
  return r.violations.map(v => `${v.id}: ${v.help} -> ${v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | ')}`);
}

const summary = { encounter: { id: 'e1', scenario: 'chronic_checkin', language: 'en' }, symptoms: [], vitals: [] } as never;
const visitSummary = (status: string, queue: string) => ({ encounter: { id: 'e1', status, scenario: 'opd_queue', language: 'en' }, symptoms: [], vitals: [], reviews: [], followUps: [], queue: { urgency_code: 'orange', status: queue, entered_at: '2026-10-08T05:00:00Z' } }) as never;
const PAGES: [string, React.ReactElement][] = [
  ['sign in', <SignIn />],
  ['consent form', <ConsentForm api={api} patientId="p" onRecorded={() => {}} />],
  ['consent form for reminders', <ConsentForm api={api} patientId="p" purpose="reminders" onRecorded={() => {}} />],
  ['register patient', <RegisterPatientForm api={api} onRegistered={() => {}} onCancel={() => {}} />],
  ['mfa code entry', <MfaPanel mfa={{ hasFactor: async () => true, enroll: async () => ({ factorId: 'f', qr: 'data:image/svg+xml;base64,AAAA', secret: 'S' }), verify: async () => null }} onVerified={() => {}} />],
  ['urgency plates', <><UrgencyPlate tier={1} /><UrgencyPlate tier={2} /><UrgencyPlate tier={3} /><UrgencyPlate tier={4} /><UrgencyPlate tier={null} assessed={false} /></>],
  ['queue filters', <QueueFilterBar entries={[]} value={NO_FILTER} onChange={() => {}} facilityNames={{}} shown={0} />],
  ['scenario template fields', <TemplateFields scenario="maternal_followup" values={{}} onChange={() => {}} lang="en" />],
  ['scenario checklist', <ScenarioChecklist api={api} summary={summary} editable onChanged={() => {}} />],
  ['measurement form', <MeasurementForm api={api} encounterId="e" onSaved={() => {}} />],
  ['history panel', <HistoryPanel api={api} patientId="p" editable canConfirm defaultLanguage="en" />],
  ['follow-up panel', <FollowupsPanel api={api} encounterId="e" patientId="p" editable />],
  ['notes panel', <NotesPanel api={api} encounterId="e" assessmentId="a" canWrite />],
  ['trend panel', <TrendPanel api={api} patientId="p" />],
  ['analytics panel', <AnalyticsPanel api={api} />],
  ['people and roles', <MembersPanel api={api} />],
  ['key details from reports', <ReportDetails api={api} encounterId="e" />],
  ['timeline summary', <CaseSummary summary={summary} />],
  ['visit panel, waiting', <VisitPanel api={api} summary={visitSummary('submitted', 'waiting')} canReview reviewedCurrent={false} onChanged={() => {}} />],
  ['visit panel, in review', <VisitPanel api={api} summary={visitSummary('in_review', 'in_review')} canReview reviewedCurrent onChanged={() => {}} />],
  ['settings', <SettingsPage />],
  ['account button', <AccountMenu me={{ userId: 'u', displayName: 'Seed Doctor A', memberships: [{ facilityId: 'f', facilityName: 'Seed PHC', facilityType: 'phc', role: 'doctor' }] } as never} lowData={false} setLowData={() => {}} needMfa={false} onVerifyMfa={() => {}} onSignOut={() => {}} />],
  ['steps and step panel (sign-off)', <><JourneyBar j={journey({ consent: true, status: 'submitted', hasAssessment: true, recorded: true, openQuestions: 0, signedOff: false, queueStatus: 'waiting', canReview: true })} selected="signoff" onSelect={() => {}} /><StepPanel j={journey({ consent: true, status: 'submitted', hasAssessment: true, recorded: true, openQuestions: 0, signedOff: false, queueStatus: 'waiting', canReview: true })} selected="signoff" onSelect={() => {}} assessing={false} editable onAssess={() => {}}><p>Content</p></StepPanel></>],
  ['step panel (finished)', <StepPanel j={journey({ consent: true, status: 'closed', hasAssessment: true, recorded: true, openQuestions: 0, signedOff: true, queueStatus: 'seen', canReview: true })} selected="visit" onSelect={() => {}} assessing={false} editable onAssess={() => {}}><p>Done</p></StepPanel>],
  ['step panel (another step)', <StepPanel j={journey({ consent: true, status: 'submitted', hasAssessment: true, recorded: true, openQuestions: 0, signedOff: false, queueStatus: 'waiting', canReview: true })} selected="checkin" onSelect={() => {}} assessing={false} editable onAssess={() => {}}><p>Change things here</p></StepPanel>],
  ['fold', <Fold title="Background" hint="History and notes" defaultOpen><p>Content</p></Fold>],
  ['queue counts', <QueueCounts entries={[]} doneCount={3} showingDone={false} onShowDone={() => {}} />],
  ['done today', <DoneToday api={api} />],
  ['switch patient', <SwitchPatient api={api} open onClose={() => {}} />],
  ['scenario boards', <ScenariosPage />],
  ['camp registration', <CampBatchPage />],
  ['offline notes', <OfflinePage />],
  ['referrals', <ReferralsPage />],
  ['admin', <AdminPage />],
  ['emergency access', <BreakGlassPage />],
];

describe('automated accessibility checks', () => {
  it.each(PAGES)('%s has no detectable violations', async (_name, ui) => {
    expect(await violations(ui, () => waitFor(() => {}))).toEqual([]);
  }, 30_000);
});
