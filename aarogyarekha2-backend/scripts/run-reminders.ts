import { loadConfig } from '../src/config.js';
import { makePool } from '../src/liveDeps.js';
import { MockSender, runDueReminders } from '../src/reminders/core.js';
import { makeReminderStore } from '../src/reminders/store.js';

const config = loadConfig();
const pool = makePool(config);
try {
  const sender = new MockSender();
  const r = await runDueReminders(makeReminderStore({ query: (sql, p) => pool.query(sql, p as unknown[]) }), sender);
  console.log(`sender: ${sender.name} (no real messages are sent)`);
  console.log(`claimed ${r.claimed}, sent ${r.sent}, failed ${r.failed} (of which consent withdrawn ${r.skippedNoConsent})`);
} catch (e) {
  console.log('FAILED:', (e as Error).name);
  process.exitCode = 1;
} finally { await pool.end(); }
