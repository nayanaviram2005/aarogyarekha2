import { describe, expect, it } from 'vitest';
import { MockSender, nextDue, reminderText, runDueReminders, type DueReminder, type ReminderStore } from '../src/reminders/core.js';

const due = (over: Partial<DueReminder> = {}): DueReminder => ({ id: 'r1', channel: 'sms', dueAt: '2026-10-20T04:30:00Z', facilityName: 'Seed PHC Khordha', language: 'en', phone: '+919876543210', consentActive: true, ...over });
function store(rows: DueReminder[]) {
  const s = { sent: [] as string[], failed: [] as string[], claimedWith: [] as [Date, number][] };
  const impl: ReminderStore = { claimDue: async (n, l) => { s.claimedWith.push([n, l]); return rows; }, markSent: async id => { s.sent.push(id); }, markFailed: async id => { s.failed.push(id); } };
  return { s, impl };
}

describe('reminderText', () => {
  it('is a fixed template: facility and date, nothing else', () => {
    const t = reminderText('en', 'Seed PHC Khordha', '2026-10-20T04:30:00Z');
    expect(t).toBe('Reminder from Seed PHC Khordha: your follow-up visit is due on 20 October 2026. If you cannot come, please contact the facility.');
  });
  it('is available in Hindi and Odia, in their own scripts, and falls back to English for anything else', () => {
    expect(reminderText('hi', 'PHC', '2026-10-20T04:30:00Z')).toMatch(/[ऀ-ॿ]/);
    expect(reminderText('or', 'PHC', '2026-10-20T04:30:00Z')).toMatch(/[଀-୿]/);
    expect(reminderText('or', 'PHC', '2026-10-20T04:30:00Z')).not.toMatch(/[ঀ-৿]/);     // no Bengali letters by mistake
    expect(reminderText('fr', 'PHC', '2026-10-20T04:30:00Z')).toMatch(/^Reminder from PHC/);
  });
  it('uses the date in India, not the server\'s time zone', () => {
    expect(reminderText('en', 'PHC', '2026-10-19T20:00:00Z')).toContain('20 October 2026');      // 01:30 on the 20th in IST
  });
});

describe('nextDue', () => {
  it('counts from the last due time so the rhythm does not drift', () => {
    expect(nextDue('2026-10-20T04:30:00.000Z', 28)).toBe('2026-11-17T04:30:00.000Z');
  });
  it('a one-off schedule has no next date', () => {
    expect(nextDue('2026-10-20T04:30:00Z', null)).toBeNull(); expect(nextDue('2026-10-20T04:30:00Z', 0)).toBeNull();
  });
});

describe('runDueReminders', () => {
  it('sends each due reminder once, marks it sent, and sends only the fixed text', async () => {
    const { s, impl } = store([due(), due({ id: 'r2', channel: 'in_app', phone: null, language: 'hi' })]);
    const m = new MockSender(); const now = new Date('2026-10-20T05:00:00Z');
    const r = await runDueReminders(impl, m, now);
    expect(r).toEqual({ claimed: 2, sent: 2, failed: 0, skippedNoConsent: 0 });
    expect(s.sent).toEqual(['r1', 'r2']); expect(s.failed).toEqual([]);
    expect(m.sent[0]!.text).not.toMatch(/fever|diagnos|result|pregnan/i);
    expect(s.claimedWith[0]).toEqual([now, 100]);
  });
  it('a reminder whose consent was withdrawn since scheduling is NOT sent', async () => {
    const { s, impl } = store([due({ consentActive: false })]); const m = new MockSender();
    expect(await runDueReminders(impl, m)).toEqual({ claimed: 1, sent: 0, failed: 1, skippedNoConsent: 1 });
    expect(m.sent).toHaveLength(0); expect(s.failed).toEqual(['r1']);
  });
  it('a phone channel with no phone number fails without sending', async () => {
    const { s, impl } = store([due({ phone: null })]); const m = new MockSender();
    expect((await runDueReminders(impl, m)).failed).toBe(1); expect(m.sent).toHaveLength(0); expect(s.failed).toEqual(['r1']);
  });
  it('one failing send does not stop the rest', async () => {
    const { s, impl } = store([due({ id: 'a', channel: 'whatsapp' }), due({ id: 'b', channel: 'sms' })]);
    const m = new MockSender(); m.failFor.add('whatsapp');
    expect(await runDueReminders(impl, m)).toMatchObject({ sent: 1, failed: 1 });
    expect(s.failed).toEqual(['a']); expect(s.sent).toEqual(['b']);
  });
  it('a failure while marking failed is swallowed so the batch still finishes', async () => {
    const impl: ReminderStore = { claimDue: async () => [due({ id: 'a', channel: 'whatsapp' }), due({ id: 'b' })], markSent: async () => {}, markFailed: async () => { throw new Error('db'); } };
    const m = new MockSender(); m.failFor.add('whatsapp');
    expect(await runDueReminders(impl, m)).toMatchObject({ sent: 1, failed: 1 });
  });
  it('nothing due means nothing happens', async () => {
    const { impl } = store([]); const m = new MockSender();
    expect(await runDueReminders(impl, m)).toEqual({ claimed: 0, sent: 0, failed: 0, skippedNoConsent: 0 }); expect(m.sent).toHaveLength(0);
  });
  it('in-app reminders need no phone number', async () => {
    const { impl } = store([due({ channel: 'in_app', phone: null })]); const m = new MockSender();
    expect((await runDueReminders(impl, m)).sent).toBe(1);
  });
});
