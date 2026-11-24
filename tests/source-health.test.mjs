import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceReport,sourceView} from '../src/source-health.mjs';

test('source health codes produce useful, honest statuses and messages', () => {
  const checkedAt='2026-11-06T05:00:00Z';
  assert.deepEqual(sourceReport('Gmail',['reviewed'],checkedAt),{source:'Gmail',status:'reviewed',checkedAt,note:'The requested source review completed.'});
  const limited=sourceReport('Blackboard',['reviewed','pagination_incomplete','attachments_unread'],checkedAt);
  assert.equal(limited.status,'partial');
  assert.match(limited.note,/Additional results/);
  assert.match(limited.note,/attachments/);
  assert.doesNotMatch(limited.note,/completed/);
  assert.equal(sourceReport('Blackboard',['login_required'],checkedAt).status,'blocked');
  assert.equal(sourceReport('Outlook',['not_checked'],checkedAt).status,'error');
  const missing=sourceReport('Outlook',['tool_unavailable'],checkedAt);
  assert.equal(missing.status,'error');assert.match(missing.note,/does not establish/);
  assert.throws(()=>sourceReport('Gmail',['invented']),/Invalid source health codes/);
});


test('indicators distinguish connection evidence from review coverage',()=>{
 const review={source:'Blackboard',status:'blocked',checkedAt:'2026-11-01T00:00:00Z',note:'Old sign-in required'};
 const connected={status:'connected',checkedAt:'2026-11-02T00:00:00Z'};
 const result=sourceView(review,connected);
 assert.equal(result.indicator,'connected');assert.equal(result.note,review.note);assert.deepEqual(result.connection,connected);
 assert.equal(sourceView({...review,checkedAt:'2026-11-03T00:00:00Z'},connected).indicator,'blocked');
 assert.equal(sourceView({...review,status:'reviewed'}, {status:'signed_out',checkedAt:'2026-11-02T00:00:00Z'}).indicator,'blocked');
 assert.equal(sourceView({...review,source:'Outlook',status:'error'}).indicator,'attention');
 assert.equal(sourceReport('Outlook',['profile_busy']).status,'error');
});
