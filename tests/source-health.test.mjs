import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceReport} from '../src/source-health.mjs';

test('source health codes produce useful, honest statuses and messages', () => {
  const checkedAt='2026-11-06T05:00:00Z';
  assert.deepEqual(sourceReport('Gmail',['reviewed'],checkedAt),{source:'Gmail',status:'reviewed',checkedAt,note:'The requested source review completed.'});
  const limited=sourceReport('Blackboard',['reviewed','pagination_incomplete','attachments_unread'],checkedAt);
  assert.equal(limited.status,'reviewed');
  assert.match(limited.note,/Additional results/);
  assert.match(limited.note,/attachments/);
  assert.doesNotMatch(limited.note,/completed/);
  assert.equal(sourceReport('Blackboard',['login_required'],checkedAt).status,'blocked');
  assert.equal(sourceReport('Outlook',['not_checked'],checkedAt).status,'error');
  const missing=sourceReport('Outlook',['tool_unavailable'],checkedAt);
  assert.equal(missing.status,'error');assert.match(missing.note,/does not establish/);
  assert.throws(()=>sourceReport('Gmail',['invented']),/Invalid source health codes/);
});
