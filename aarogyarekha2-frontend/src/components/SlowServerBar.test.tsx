import { describe, expect, it } from 'vitest';
import { SHOW_SLOW_SERVER_NOTICE, SLOW_SERVER_MESSAGE, SLOW_SERVER_SHORT } from '../config';

describe('speed warning', () => {
  it('is on, and says plainly that triage can take several seconds and why', () => {
    expect(SHOW_SLOW_SERVER_NOTICE).toBe(true);
    for (const m of [SLOW_SERVER_MESSAGE, SLOW_SERVER_SHORT]) { expect(m).toMatch(/triage/); expect(m).not.toMatch(/sign/i); } for (const m of [SLOW_SERVER_MESSAGE, SLOW_SERVER_SHORT]) expect(m).toMatch(/several seconds/); for (const m of [SLOW_SERVER_MESSAGE, SLOW_SERVER_SHORT]) expect(m).toMatch(/far from you/);
  });
});
