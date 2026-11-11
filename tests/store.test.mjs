import {EventEmitter} from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore,taskId} from '../src/store.mjs';
import {createServer} from '../src/server.mjs';
const task={source:'Gmail',externalId:'thread-1',actionKey:'main',title:'Review draft',context:'Project',due:'2026-11-04',time:'',estimate:30,reason:'Requested review before the deadline.',excerpt:'Please review the draft by November 4.',from:'Project team',url:'https://mail.google.com/mail/u/0/#all/thread-1',observedAt:'2026-11-02T22:00:00Z'};
const batch=(store,tasks=[task],order=tasks.filter(t=>t.sourceStatus!=='completed').map(t=>({source:t.source,externalId:t.externalId,actionKey:t.actionKey})))=>({baseRevision:store.snapshot().revision,tasks,sources:[{source:'Gmail',status:'partial',checkedAt:'2026-11-02T22:00:00Z',note:'Scoped search'}],ranking:{order,reviewer:'Test assistant',summary:'Reviewed evidence and history.'}});

test('HTTP stale completion, time edit and restore cannot overwrite newer history',async()=>{
  const s=openStore(':memory:',{seed:false});s.importBatch(batch(s));
  const server=createServer(s);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url='http://127.0.0.1:'+server.address().port+'/api/tasks/'+taskId('Gmail','thread-1');
  const post=payload=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  try{
    const revision=s.snapshot().revision;
    assert.equal((await post({action:'complete',actual:30})).status,400);
    assert.equal((await post({action:'complete',actual:30,baseRevision:revision})).status,200);
    const before=s.snapshot(),events=s.db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
    for(const action of ['complete','restore']){
      const response=await post({action,actual:null,baseRevision:revision});
      assert.equal(response.status,409);assert.match((await response.json()).error,/Workspace changed/);
    }
    assert.equal(s.snapshot().tasks[0].actual,30);
    assert.equal(s.snapshot().tasks[0].completedAt,before.tasks[0].completedAt);
    assert.equal(s.snapshot().revision,before.revision);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM events').get().n,events);
    assert.equal((await post({action:'complete',actual:45,baseRevision:before.revision})).status,200);
    assert.equal(s.snapshot().tasks[0].actual,45);
    assert.equal((await post({action:'restore',baseRevision:s.snapshot().revision})).status,200);
    assert.equal(s.snapshot().tasks[0].completedAt,null);
    assert.equal(s.snapshot().tasks[0].actual,45);
  }finally{await new Promise(r=>server.close(r));s.close();}
});
test('imports deduplicate without reopening completed tasks or overwriting actual duration',()=>{const s=openStore(':memory:',{seed:false});s.importBatch(batch(s));const id=taskId('Gmail','thread-1');s.updateTask(id,'complete',120);s.importBatch(batch(s,[{...task,title:'Updated draft title'}],[]));assert.equal(s.snapshot().tasks.length,1);assert.equal(s.snapshot().tasks[0].actual,120);assert.ok(s.snapshot().tasks[0].completedAt);s.updateTask(id,'restore');assert.equal(s.snapshot().tasks[0].completedAt,null);assert.equal(s.snapshot().tasks[0].actual,120);s.close();});
test('invalid and stale imports roll back atomically',()=>{const s=openStore(':memory:',{seed:false});const stale=batch(s);s.importBatch(batch(s));assert.throws(()=>s.importBatch(stale),/Workspace changed/);const wrong=batch(s,[{...task,externalId:'thread-2'}],[]);assert.throws(()=>s.importBatch(wrong),/Rank every/);assert.equal(s.snapshot().tasks.length,1);assert.throws(()=>s.importBatch(batch(s,[{...task,url:'javascript:alert(1)'}])),/Invalid source URL/);assert.throws(()=>s.importBatch(batch(s,[{...task,due:'2026-02-30'}])),/Invalid due date/);assert.throws(()=>s.importBatch(batch(s,[task,task])),/Duplicate/);s.close();});
test('completion and actual time survive process/store restart',()=>{const dir=mkdtempSync(join(tmpdir(),'work-optimizer-'));try{let s=openStore(join(dir,'test.sqlite'),{seed:false});s.importBatch(batch(s));s.updateTask(taskId('Gmail','thread-1'),'complete',90);s.close();s=openStore(join(dir,'test.sqlite'),{seed:false});assert.equal(s.snapshot().tasks[0].actual,90);assert.ok(s.snapshot().tasks[0].completedAt);s.close();}finally{rmSync(dir,{recursive:true,force:true});}});
test('refresh requests coalesce and are fulfilled only by committed ingestion',()=>{const s=openStore(':memory:',{seed:false});const r=s.requestRefresh();assert.equal(s.requestRefresh().id,r.id);assert.equal(s.snapshot().lastRefreshAt,null);s.importBatch({...batch(s,[{...task,mailReadStatus:'unread'}]),requestId:r.id});assert.equal(s.snapshot().refresh.status,'complete');assert.ok(s.snapshot().lastRefreshAt);const next=s.requestRefresh();assert.notEqual(next.id,r.id);s.failRefresh(next.id,'No source access');assert.equal(s.snapshot().refresh.status,'failed');s.close();});
test('legacy prototype history is retained separately from real tasks',()=>{const s=openStore(':memory:');s.migrateLegacy([{id:1,actual:120,completedAt:'2026-11-02T22:00:00Z'}]);s.importBatch(batch(s));assert.equal(s.snapshot().legacyHistory[0].actual,120);assert.equal(s.snapshot().tasks.length,1);s.close();});
test('AI priority is retained independently of duration and invalid tiers are rejected',()=>{
  const s=openStore(':memory:',{seed:false});
  try{
    s.importBatch(batch(s,[{...task,estimate:240,priority:4}]));
    assert.equal(s.snapshot().tasks[0].priority,4);
    for(const priority of [0,6,2.5,'4'])assert.throws(()=>s.importBatch(batch(s,[{...task,priority}])),/Invalid priority/);
    assert.equal(s.snapshot().tasks[0].priority,4);
    s.importBatch(batch(s,[{...task,estimate:5,priority:5}]));
    assert.equal(s.snapshot().tasks[0].priority,5);
  }finally{s.close();}
});
test('AI imports rank by action criticality and keep AI tie order',()=>{
  const s=openStore(':memory:',{seed:false});
  try{
    const tasks=[{...task,externalId:'small-urgent',estimate:5,priority:5},{...task,externalId:'major-project',estimate:240,priority:4},{...task,externalId:'high-second',estimate:60,priority:4},{...task,externalId:'can-wait',estimate:30,priority:2}];
    const proposed=[tasks[3],tasks[2],tasks[0],tasks[1]].map(t=>({source:t.source,externalId:t.externalId,actionKey:t.actionKey}));
    s.importBatch(batch(s,tasks,proposed));
    assert.deepEqual(s.snapshot().tasks.map(t=>t.externalId),['small-urgent','high-second','major-project','can-wait']);
    assert.deepEqual(s.snapshot().tasks.map(t=>t.priority),[5,4,4,2]);
    const state=s.snapshot(),manual=state.tasks.map(t=>t.id).reverse();
    assert.deepEqual(s.reorderTasks(manual,state.revision).tasks.map(t=>t.id),manual);
  }finally{s.close();}
});
test('source ranking cannot reopen user-completed work or displace active work',()=>{
  const s=openStore(':memory:',{seed:false});
  try{
    const tasks=[task,{...task,externalId:'still-active'}];
    s.importBatch(batch(s,tasks));
    const completedId=taskId(task.source,task.externalId);
    s.updateTask(completedId,'complete',20);
    s.importBatch(batch(s,tasks));
    assert.equal(s.snapshot().tasks.find(t=>t.id===completedId).actual,20);
    assert.ok(s.snapshot().tasks.find(t=>t.id===completedId).completedAt);
    assert.deepEqual(s.snapshot().tasks.filter(t=>!t.completedAt).map(t=>t.externalId),['still-active']);
    assert.throws(()=>s.importBatch(batch(s,tasks,[])),/Rank every active/);
  }finally{s.close();}
});
test('manual reorder validates all active IDs and revision while preserving completed history',()=>{
  const s=openStore(':memory:',{seed:false});
  try{
    const tasks=[task,{...task,externalId:'thread-2'},{...task,externalId:'thread-3'}];
    s.importBatch(batch(s,tasks));
    const ids=tasks.map(t=>taskId(t.source,t.externalId));
    s.updateTask(ids[2],'complete',45);
    const revision=s.snapshot().revision;
    for(const order of [[ids[0]],[ids[0],ids[0]],[ids[0],'unknown'],ids])assert.throws(()=>s.reorderTasks(order,revision),/every active task/);
    assert.throws(()=>s.reorderTasks(ids.slice(0,2),revision-1),/Workspace changed/);
    const result=s.reorderTasks([ids[1],ids[0]],revision);
    assert.deepEqual(result.tasks.filter(t=>!t.completedAt).map(t=>t.id),[ids[1],ids[0]]);
    assert.equal(result.tasks.find(t=>t.id===ids[2]).actual,45);
    assert.equal(result.ranking.reviewer,'Manual order');
    assert.equal(result.revision,revision+1);
  }finally{s.close();}
});
test('reorder API persists full task order and rejects stale revisions',async()=>{
  const s=openStore(':memory:');
  const server=createServer(s);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url='http://127.0.0.1:'+server.address().port;
  try{
    const before=s.snapshot(),order=before.tasks.filter(t=>!t.completedAt).map(t=>t.id).reverse();
    const post=()=>fetch(url+'/api/reorder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({order,baseRevision:before.revision})});
    const response=await post();
    assert.equal(response.status,200);
    assert.deepEqual((await response.json()).tasks.filter(t=>!t.completedAt).map(t=>t.id),order);
    assert.equal((await post()).status,409);
  }finally{await new Promise(r=>server.close(r));s.close();}
});
test('HTTP state, completion, refresh and cross-origin protection',async()=>{const s=openStore(':memory:',{seed:false});s.importBatch(batch(s));let launched=0;const server=createServer(s,{launch:()=>launched++});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;try{assert.equal((await fetch(url+'/api/state')).status,200);const post=(path,data,origin=url)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(data)});assert.equal((await post('/api/refresh',{},'https://foreign.example')).status,403);assert.equal((await post('/api/refresh',{})).status,202);assert.equal(launched,1);assert.equal((await post('/api/tasks/'+taskId('Gmail','thread-1'),{action:'complete',actual:0,baseRevision:s.snapshot().revision})).status,400);const result=await(await post('/api/tasks/'+taskId('Gmail','thread-1'),{action:'complete',actual:120,baseRevision:s.snapshot().revision})).json();assert.equal(result.tasks[0].actual,120);assert.equal((await fetch(url+'/data/work.sqlite')).status,404);}finally{await new Promise(r=>server.close(r));s.close();}});

test('manual creation validates, rejects stale edits and is idempotent after a lost response',()=>{
 const store=openStore(':memory:');
 try{
  assert.throws(()=>store.addTask({id:'new',title:'',baseRevision:0}),/Invalid text/);
  assert.throws(()=>store.addTask({id:'new',title:'Task',baseRevision:99}),/Workspace changed/);
  const payload={id:'new',title:'Task',estimate:25,baseRevision:0};
  const first=store.addTask(payload),retry=store.addTask(payload);
  assert.equal(first.mode,'live');assert.equal(retry.revision,first.revision);assert.equal(retry.tasks.length,1);
  assert.equal(retry.tasks[0].id,'manual:new');assert.equal(retry.tasks[0].estimate,25);
  assert.throws(()=>store.addTask({...payload,title:'Different'}),/already exists/);
 }finally{store.close();}
});


test('deleted source tasks stay removed after refresh and stale deletion is rejected',()=>{
 const s=openStore(':memory:',{seed:false});
 try{
  s.importBatch(batch(s));const original=s.snapshot();const id=original.tasks[0].id;
  assert.throws(()=>s.updateTask(id,'delete',null,original.revision-1),/Workspace changed/);
  s.updateTask(id,'delete',null,original.revision);assert.equal(s.snapshot().tasks.length,0);
  s.importBatch(batch(s));assert.equal(s.snapshot().tasks.length,0);
 }finally{s.close();}
});


test('Blackboard sign-in opens once and prevents refresh until it finishes',async()=>{
 const s=openStore(':memory:',{seed:false});let launches=0;const child=new EventEmitter();
 const server=createServer(s,{running:false,launch(){launches++;}},{spawnLogin(){return child;}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 const post=path=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:url},body:'{}'});
 try{
  assert.equal((await post('/api/blackboard-login')).status,202);
  assert.equal((await post('/api/blackboard-login')).status,409);
  assert.equal((await post('/api/refresh')).status,409);assert.equal(launches,0);
  assert.equal((await(await fetch(url+'/api/state')).json()).blackboardLogin,'pending');
  child.emit('close',0);assert.equal((await(await fetch(url+'/api/state')).json()).blackboardLogin,'complete');
  assert.equal((await post('/api/refresh')).status,202);assert.equal(launches,1);
 }finally{await new Promise(r=>server.close(r));s.close();}
});


test('manual priority persists across refresh and rejects stale or invalid edits',()=>{
 const s=openStore(':memory:',{seed:false});try{s.importBatch(batch(s));const original=s.snapshot(),id=original.tasks[0].id;
  assert.throws(()=>s.updateTask(id,'priority',null,original.revision-1,5),/Workspace changed/);
  assert.throws(()=>s.updateTask(id,'priority',null,original.revision,6),/Priority must/);
  s.updateTask(id,'priority',null,original.revision,5);assert.equal(s.snapshot().tasks[0].priority,5);
  s.importBatch(batch(s));assert.equal(s.snapshot().tasks[0].priority,5);
 }finally{s.close();}
});


test('duplicate source diagnostics are rejected without changing stored work',()=>{
 const s=openStore(':memory:',{seed:false});try{s.importBatch(batch(s));const before=s.snapshot(),next=batch(s);next.sources=[{source:'Gmail',status:'reviewed',checkedAt:new Date().toISOString(),note:'Checked'},{source:'Gmail',status:'blocked',checkedAt:new Date().toISOString(),note:'Expired'}];assert.throws(()=>s.importBatch(next),/Duplicate source status/);assert.equal(s.snapshot().revision,before.revision);assert.deepEqual(s.snapshot().tasks,before.tasks);}finally{s.close();}
});

test('deleting active work preserves compact feedback for future refreshes across restart',t=>{
 const dir=mkdtempSync(join(tmpdir(),'deleted-feedback-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'work.sqlite');let s=openStore(path,{seed:false});
 try{
  s.importBatch({...batch(s),tasks:[{...task,from:'Example <sender@example.com>'}]});
  const before=s.snapshot();s.updateTask(before.tasks[0].id,'delete',null,before.revision);
  const saved=s.snapshot().deletedTaskHistory;assert.equal(saved.length,1);
  assert.equal(saved[0].from,'Example <sender@example.com>');assert.equal(saved[0].title,task.title);
  assert.equal(saved[0].excerpt,undefined);assert.equal(saved[0].source,'Gmail');
  s.close();s=openStore(path,{seed:false});assert.deepEqual(s.snapshot().deletedTaskHistory,saved);
 }finally{s.close();}
});

test('confirmed unsubmitted Blackboard work returns to the queue and preserves logged time and events',()=>{
 const s=openStore(':memory:',{seed:false});
 const bb={...task,source:'Blackboard',externalId:'course:assignment',url:'https://learn.blackboard.com/item',sourceStatus:'active'};
 try{
  s.importBatch(batch(s,[bb]));const id=taskId('Blackboard',bb.externalId);
  s.updateTask(id,'complete',37);
  s.importBatch(batch(s,[{...bb,submissionStatus:'unknown'}],[]));
  assert.ok(s.snapshot().tasks[0].completedAt);
  s.importBatch(batch(s,[{...bb,submissionStatus:'not_submitted'}]));
  const restored=s.snapshot().tasks[0];assert.equal(restored.completedAt,null);assert.equal(restored.actual,37);
  assert.deepEqual(s.db.prepare('SELECT kind FROM events ORDER BY rowid').all().map(e=>e.kind),['complete','restore']);
  s.updateTask(id,'complete',37);
  s.importBatch(batch(s,[{...bb,submissionStatus:'in_progress'}]));
  assert.equal(s.snapshot().tasks[0].completedAt,null);
 }finally{s.close();}
});

test('deleted Blackboard work stays deleted and unsupported evidence is rejected',()=>{
 const s=openStore(':memory:',{seed:false});
 const bb={...task,source:'Blackboard',externalId:'course:deleted',url:'https://learn.blackboard.com/item',sourceStatus:'active'};
 try{
  s.importBatch(batch(s,[bb]));s.updateTask(taskId('Blackboard',bb.externalId),'delete');
  s.importBatch(batch(s,[{...bb,submissionStatus:'not_submitted'}]));
  assert.equal(s.snapshot().tasks.length,0);assert.equal(s.snapshot().deletedTaskHistory.length,1);
  assert.throws(()=>s.importBatch(batch(s,[{...task,submissionStatus:'not_submitted'}])),/only supported for Blackboard/);
  assert.throws(()=>s.importBatch(batch(s,[{...bb,due:null,submissionStatus:'not_submitted'}])),/must be active and have a due date/);
 }finally{s.close();}
});


test('confirmed read mail completes existing tasks and unknown mail cannot create tasks',()=>{
  const s=openStore(':memory:',{seed:false});
  try{
    s.importBatch(batch(s,[{...task,mailReadStatus:'unread'}]));
    s.importBatch(batch(s,[{...task,mailReadStatus:'unknown'}]));
    assert.equal(s.snapshot().tasks[0].completedAt,null);
    assert.throws(()=>s.importBatch(batch(s,[{...task,externalId:'unknown',mailReadStatus:'unknown'}],[{source:'Gmail',externalId:'thread-1',actionKey:'main'},{source:'Gmail',externalId:'unknown',actionKey:'main'}])),/confirmed unread/);
    s.importBatch(batch(s,[{...task,mailReadStatus:'read'}],[]));
    assert.ok(s.snapshot().tasks[0].completedAt);
  }finally{s.close();}
});



test('changed action keys and similar titles do not recreate deleted or completed work',()=>{
 const s=openStore(':memory:',{seed:false});
 try{
  s.importBatch(batch(s));s.updateTask(taskId('Gmail','thread-1'),'delete');
  const renamed={...task,actionKey:'review',title:'Review the draft'};
  s.importBatch(batch(s,[renamed]));assert.equal(s.snapshot().tasks.length,0);
  const unrelated={...renamed,externalId:'another-thread'};
  s.importBatch(batch(s,[unrelated]));assert.equal(s.snapshot().tasks.length,1);
  s.updateTask(taskId('Gmail','another-thread','review'),'complete');
  s.importBatch(batch(s,[{...unrelated,actionKey:'main'}]));assert.equal(s.snapshot().tasks.filter(t=>!t.completedAt).length,0);
 }finally{s.close();}
});
