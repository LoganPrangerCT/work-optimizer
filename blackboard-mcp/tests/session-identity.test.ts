import { describe, expect, it } from 'vitest';
import { isSignedInIdentity } from '../src/blackboard/session.js';

describe('Blackboard session identity', () => {
  it('does not treat the anonymous guest as signed in', () => {
    expect(isSignedInIdentity({ id: '_1_1', userName: 'guest' })).toBe(false);
    expect(isSignedInIdentity({ id: '_1_1', userName: ' Guest ' })).toBe(false);
    expect(isSignedInIdentity({ id: '_2_1', userName: 'student' })).toBe(true);
    expect(isSignedInIdentity({ userName: 'student' })).toBe(false);
    expect(isSignedInIdentity({ id: '_1_1' })).toBe(false);
    expect(isSignedInIdentity({ id: '_1_1', userName: '  ' })).toBe(false);
  });
});
