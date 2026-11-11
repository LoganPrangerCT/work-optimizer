import { describe, expect, it, vi } from 'vitest';
import { BlackboardSession } from '../src/blackboard/session.js';
import { callBB } from '../src/index.js';

describe('interactive Blackboard login', () => {
  it('keeps the request alive through login, settles, saves cookies, then retries', async () => {
    let finishLogin!: () => void;
    const loginDone = new Promise<void>((resolve) => { finishLogin = resolve; });
    let started!: () => void;
    const loginStarted = new Promise<void>((resolve) => { started = resolve; });
    const events: string[] = [];
    const initial = { probe: async () => null, isOffline: () => false, close: async () => {} };
    const visible = {
      onClose: () => {}, focusLoginWindow: async () => {}, markLoginWindow: async () => {},
      startLoginFlow: async () => {},
      waitForLogin: async () => { started(); await loginDone; events.push('authenticated'); },
      saveSnapshot: async () => { events.push('saved'); },
      close: async () => { events.push('closed'); },
    };
    const authenticated = { probe: async () => ({ id: 'student' }), onClose: () => {}, isAlive: () => true };
    const acquire = vi.spyOn(BlackboardSession, 'acquire')
      .mockResolvedValueOnce(initial as unknown as BlackboardSession)
      .mockResolvedValueOnce(visible as unknown as BlackboardSession)
      .mockResolvedValueOnce(authenticated as unknown as BlackboardSession);
    try {
      let finished = false;
      const result = callBB(async () => 'ok').then((value) => { finished = true; return value; });
      await loginStarted;
      expect(finished).toBe(false);
      finishLogin();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(events).toEqual(['authenticated']);
      expect(finished).toBe(false);
      expect(await result).toBe('ok');
      expect(events).toEqual(['authenticated', 'saved', 'closed']);
      expect(acquire).toHaveBeenCalledTimes(3);
    } finally {
      acquire.mockRestore();
    }
  }, 8000);
});
