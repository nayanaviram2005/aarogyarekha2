export type Channel = 'sms' | 'whatsapp' | 'ivr' | 'in_app';
export type Lang = 'en' | 'hi' | 'or';

export interface DueReminder { id: string; channel: Channel; dueAt: string; facilityName: string; language: string; phone: string | null; consentActive: boolean }
export interface Sender { name: string; send(to: { channel: Channel; phone: string | null }, text: string): Promise<void> }
export interface ReminderStore {
  claimDue(now: Date, limit: number): Promise<DueReminder[]>;
  markSent(id: string, at: Date): Promise<void>;
  markFailed(id: string): Promise<void>;
}

const DATE = (iso: string, lang: Lang) => new Date(iso).toLocaleDateString(lang === 'en' ? 'en-IN' : lang === 'hi' ? 'hi-IN' : 'or-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

export function reminderText(language: string, facilityName: string, dueAt: string): string {
  const lang: Lang = language === 'hi' || language === 'or' ? language : 'en';
  const d = DATE(dueAt, lang);
  if (lang === 'hi') return `${facilityName} की ओर से याद दिलाना: आपकी अगली जाँच ${d} को है। न आ सकें तो कृपया केंद्र से संपर्क करें।`;
  if (lang === 'or') return `${facilityName} ତରଫରୁ ସ୍ମରଣ: ଆପଣଙ୍କ ପରବର୍ତ୍ତୀ ପରୀକ୍ଷା ${d} ରେ ଅଛି। ଆସିପାରିବେ ନାହିଁ ଯଦି, ଦୟାକରି କେନ୍ଦ୍ରକୁ ଯୋଗାଯୋଗ କରନ୍ତୁ।`;
  return `Reminder from ${facilityName}: your follow-up visit is due on ${d}. If you cannot come, please contact the facility.`;
}

export function nextDue(lastDueAt: string, cadenceDays: number | null): string | null {
  if (!cadenceDays || cadenceDays <= 0) return null;
  const t = new Date(lastDueAt); t.setUTCDate(t.getUTCDate() + cadenceDays);
  return t.toISOString();
}

export class MockSender implements Sender {
  readonly name = 'mock';
  readonly sent: { channel: Channel; phone: string | null; text: string }[] = [];
  failFor = new Set<string>();
  async send(to: { channel: Channel; phone: string | null }, text: string): Promise<void> {
    if (this.failFor.has(to.channel)) throw new Error('mock failure');
    this.sent.push({ channel: to.channel, phone: to.phone, text });
  }
}

export interface RunResult { claimed: number; sent: number; failed: number; skippedNoConsent: number }

export async function runDueReminders(store: ReminderStore, sender: Sender, now: Date = new Date(), limit = 100): Promise<RunResult> {
  const due = await store.claimDue(now, limit);
  const r: RunResult = { claimed: due.length, sent: 0, failed: 0, skippedNoConsent: 0 };
  for (const d of due) {
    if (!d.consentActive) { await store.markFailed(d.id); r.skippedNoConsent++; r.failed++; continue; }
    if ((d.channel === 'sms' || d.channel === 'whatsapp' || d.channel === 'ivr') && !d.phone) { await store.markFailed(d.id); r.failed++; continue; }
    try { await sender.send({ channel: d.channel, phone: d.phone }, reminderText(d.language, d.facilityName, d.dueAt)); await store.markSent(d.id, now); r.sent++; }
    catch { await store.markFailed(d.id).catch(() => {}); r.failed++; }
  }
  return r;
}
