import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {openStore} from '../src/store.mjs';
import {createWorker,refreshInput} from '../src/worker.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeTaskFiles} from '../src/task-files.mjs';

const task={mailReadStatus:'unread',source:'Gmail',externalId:'thread',actionKey:'main',title:'Review',context:'Project',due:'2026-11-04',time:'',estimate:15,priority:4,reason:'Important review needs attention.',excerpt:'Please review.',from:'Team',url:'https://mail.google.com/mail/u/0/#all/thread',observedAt:'2026-11-03T12:00:00Z'};
const batch={tasks:[task],sources:[{source:'Gmail',status:'partial',checkedAt:task.observedAt,note:'Scoped review'}],ranking:{order:[{source:task.source,externalId:task.externalId,actionKey:task.actionKey}],reviewer:'gpt-6.1-sol · medium',summary:'Reviewed.'}};

test('worker preserves committed import diagnosis and exact history through publication recovery',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'worker-publication-')),path=join(dir,'work.sqlite');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let armed=false;
  let store=openStore(path,{seed:false,publish:(...args)=>{if(armed)throw Error('Injected publication failure. Stop the server and follow docs/tasks.md recovery before retrying.');return writeTaskFiles(...args);}});
  try{
    store.importBatch({...batch,baseRevision:store.snapshot().revision});
    const id=store.snapshot().tasks[0].id;store.updateTask(id,'complete',37);
    const request=store.requestRefresh();
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
    child.stdin=new Writable({write(chunk,encoding,next){next();}});
    const worker=createWorker(store,{spawnProcess:()=>child});await worker.launch(request);
    armed=true;
    child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({...batch,ranking:{...batch.ranking,order:[]}})}}));
    child.emit('close',0);
    const refresh=store.db.prepare('SELECT * FROM refreshes WHERE id=?').get(request.id);
    assert.equal(refresh.status,'complete');assert.match(refresh.error,/Database saved; task files are not published/);
    assert.match(refresh.error,/docs\/tasks\.md recovery/);assert.doesNotMatch(refresh.error,/AI result could not be imported/);
    assert.equal(worker.running,false);
    store.close();store=openStore(path,{seed:false});
    const recovered=store.snapshot();assert.equal(recovered.tasks.length,1);assert.equal(recovered.tasks[0].id,id);
    assert.equal(recovered.tasks[0].actual,37);assert.ok(recovered.tasks[0].completedAt);
    assert.equal(store.db.prepare('SELECT count(*) n FROM events').get().n,1);
    assert.equal(recovered.refresh.error,refresh.error);
  }finally{store.close();}
});

function scenario(replies,beforeReply=()=>{},options={}){
  const store=openStore(':memory:',{seed:false}),calls=[];
  const done=Promise.withResolvers();
  const proxy={snapshot:()=>store.snapshot(),importBatch:value=>{const result=store.importBatch(value);done.resolve();return result;},failRefresh:(id,error,checks)=>{const result=store.failRefresh(id,error,checks);done.resolve();return result;}};
  const spawnProcess=(executable,args)=>{
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
    const call={args,input:''};calls.push(call);
    child.stdin=new Writable({write(chunk,encoding,next){call.input+=chunk.toString();next();}});
    child.stdin.on('finish',()=>queueMicrotask(()=>{
      beforeReply(store,calls.length);
      const reply=replies.shift();
      if(typeof reply==='function'){reply(child);return;}
      child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:typeof reply==='string'?reply:JSON.stringify(reply)}}));
      child.emit('close',0); // Deliberately omit the trailing newline from CLI output.
    }));
    return child;
  };
  return {store,calls,worker:createWorker(proxy,{spawnProcess,terminate:async()=>{},...options}),done:done.promise};
}

test('newline-delimited output cannot bypass the total byte limit',{timeout:2000},async()=>{
  const flood=child=>{
    const line=JSON.stringify({type:'tool_event',text:'x'.repeat(10000)})+'\n';
    for(let i=0;i<210;i++)child.stdout.write(line);
    child.emit('close',0);
  };
  const {store,worker,done,calls}=scenario([flood],()=>{},{outputLimit:2000000});
  try{
    store.importBatch({...batch,baseRevision:0});
    await worker.launch(store.requestRefresh());await done;
    assert.match(store.snapshot().refresh.error,/output exceeded limit/);
    assert.equal(store.snapshot().tasks[0].title,task.title);
    assert.equal(calls.length,1);
    assert.equal(worker.running,false);
  }finally{store.close();}
});

test('timeout reports failure, preserves tasks and ignores a late successful response',{timeout:2000},async()=>{
  let processHandle;
  const {store,worker,done}=scenario([child=>{processHandle=child;}],()=>{},{timeout:10});
  try{
    store.importBatch({...batch,baseRevision:0});
    await worker.launch(store.requestRefresh());await done;
    assert.match(store.snapshot().refresh.error,/timed out/);
    processHandle.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({...batch,tasks:[{...task,title:'Late overwrite'}]})}})+'\n');
    processHandle.emit('close',0);
    assert.equal(store.snapshot().tasks[0].title,task.title);
    assert.equal(store.snapshot().refresh.status,'failed');
    assert.equal(worker.running,false);
  }finally{store.close();}
});

for(const [name,reply,pattern] of [
  ['missing CLI',child=>{child.emit('error',new Error('ENOENT'));child.emit('close',-1);},/could not start/],
  ['authentication or network failure',child=>child.emit('close',1),/login/],
  ['empty output',child=>child.emit('close',0),/could not be imported/],
])test(name+' leaves previous tasks intact',{timeout:2000},async()=>{
  const {store,worker,done}=scenario([reply,reply]);
  try{
    store.importBatch({...batch,baseRevision:0});
    await worker.launch(store.requestRefresh());await done;
    assert.equal(store.snapshot().refresh.status,'failed');
    assert.match(store.snapshot().refresh.error,pattern);
    assert.equal(store.snapshot().tasks[0].title,task.title);
    assert.equal(worker.running,false);
  }finally{store.close();}
});

test('worker accepts a final event without a newline and launches the configured smarter model',{timeout:2000},async()=>{
  const {store,calls,worker,done}=scenario([batch]);
  try{
    await worker.launch(store.requestRefresh());await done;
    assert.equal(store.snapshot().refresh.status,'complete');
    assert.equal(store.snapshot().tasks[0].priority,4);
    assert.equal(calls[0].args[calls[0].args.indexOf('-m')+1],'gpt-6.1-terra');
    assert.ok(calls[0].args.includes('model_reasoning_effort="medium"'));
    assert.equal(worker.running,false);
    assert.equal(calls[0].args[calls[0].args.indexOf('-s')+1],'read-only');
  }finally{store.close();}
});

test('invalid ranking gets one evidence-only repair with the exact active identity checklist',{timeout:2000},async()=>{
  const invalid={...batch,ranking:{...batch.ranking,order:[]}};
  const {store,calls,worker,done}=scenario([invalid,batch]);
  try{
    store.importBatch({...batch,baseRevision:0});
    const request=store.requestRefresh();
    await worker.launch(request);await worker.launch(request);await done;
    assert.equal(calls.length,2);
    assert.match(calls[1].input,/ONE REPAIR ATTEMPT/);
    assert.match(calls[1].input,/Do not re-read sources or make tool calls/);
    assert.match(calls[1].input,/activeTaskIdentities/);
    assert.equal(store.snapshot().refresh.status,'complete');
  }finally{store.close();}
});

test('malformed output retries only once and leaves existing work untouched',{timeout:2000},async()=>{
  const {store,calls,worker,done}=scenario(['{invalid','{invalid']);
  try{
    store.importBatch({...batch,baseRevision:0});
    await worker.launch(store.requestRefresh());await done;
    assert.equal(calls.length,2);
    assert.equal(store.snapshot().refresh.status,'failed');
    assert.equal(store.snapshot().tasks.length,1);
    assert.equal(worker.running,false);
  }finally{store.close();}
});

test('a user completion during refresh is preserved and does not trigger a repair that overwrites it',{timeout:2000},async()=>{
  const {store,calls,worker,done}=scenario([batch],s=>s.updateTask(s.snapshot().tasks[0].id,'complete',25));
  try{
    store.importBatch({...batch,baseRevision:0});
    await worker.launch(store.requestRefresh());await done;
    assert.equal(calls.length,1);
    assert.equal(store.snapshot().refresh.status,'failed');
    assert.match(store.snapshot().refresh.error,/Workspace changed/);
    assert.equal(store.snapshot().tasks[0].actual,25);
    assert.ok(store.snapshot().tasks[0].completedAt);
  }finally{store.close();}
});

test('worker input excludes samples and trims completed evidence while preserving actual history and identities',()=>{
  const input=refreshInput({revision:2,tasks:[{...task,id:'active'},{...task,id:'done',completedAt:'2026-11-02',actual:20},{...task,id:'sample',sample:true}],legacyHistory:[{sample:true}]});
  assert.equal(input.tasks.length,2);
  assert.equal(input.tasks[1].actual,20);
  assert.equal(input.tasks[1].excerpt,undefined);
  assert.deepEqual(input.activeTaskIdentities,batch.ranking.order);
  assert.equal(input.legacyHistory,undefined);
});

test('process close cannot allow another refresh before cleanup records its result',{timeout:2000},async()=>{
  const cleanup=Promise.withResolvers();let handle;
  const {store,worker,done,calls}=scenario([child=>{handle=child;}],()=>{},{outputLimit:1,terminate:()=>cleanup.promise});
  try{
    await worker.launch(store.requestRefresh());await delay(0);
    handle.stdout.write('overflow');handle.emit('close',1);
    assert.equal(worker.running,true);
    await worker.launch(store.requestRefresh());assert.equal(calls.length,1);
    cleanup.resolve();await done;
    assert.equal(worker.running,false);
    assert.equal(store.snapshot().refresh.status,'failed');
    assert.match(store.snapshot().refresh.error,/output exceeded/);
  }finally{cleanup.resolve();await delay(0);store.close();}
});

test('failed cleanup is bounded, blocks overlap, and explicit cleanup permits another refresh',{timeout:3000},async()=>{
  let fail=true;
  const {store,worker,done}=scenario([()=>{},batch],()=>{},{timeout:10,terminate:async()=>{if(fail)throw Error('Denied');}});
  try{
    await worker.launch(store.requestRefresh());await done;
    assert.match(store.snapshot().refresh.error,/Process cleanup failed/);assert.equal(worker.running,true);
    await assert.rejects(worker.stop(),/Denied/);
    fail=false;await worker.stop();assert.equal(worker.running,false);
    await worker.launch(store.requestRefresh());
    for(let i=0;i<100&&worker.running;i++)await delay(5);
    assert.equal(store.snapshot().refresh.status,'complete');
  }finally{store.close();}
});

for(const overflow of [false,true])test(`real Windows process tree is removed after ${overflow?'output overflow':'timeout'} and refresh can retry`,{skip:process.platform!=='win32',timeout:15000},async()=>{
  const store=openStore(':memory:',{seed:false});let handle,descendant;
  const spawnProcess=()=>{
    const code=`const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});console.log('DESCENDANT:'+c.pid);process.stdin.resume();${overflow?"setTimeout(()=>process.stdout.write('x'.repeat(2100000)),100);":''}setInterval(()=>{},1000);`;
    handle=spawn(process.execPath,['-e',code],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    handle.stdout.on('data',chunk=>{const match=chunk.toString().match(/DESCENDANT:(\d+)/);if(match)descendant=Number(match[1]);});return handle;
  };
  const worker=createWorker(store,{spawnProcess,outputLimit:2000000,timeout:overflow?7000:1000});
  try{
    store.importBatch({...batch,baseRevision:0});
    for(let run=0;run<2;run++){
      descendant=null;await worker.launch(store.requestRefresh());
      for(let i=0;i<200&&worker.running;i++)await delay(25);
      assert.equal(worker.running,false);assert.ok(descendant,'child announced descendant PID');
      assert.throws(()=>process.kill(handle.pid,0));assert.throws(()=>process.kill(descendant,0));
      assert.equal(store.snapshot().refresh.status,'failed');assert.match(store.snapshot().refresh.error,overflow?/output exceeded/:/timed out/);
      assert.equal(store.snapshot().tasks[0].title,task.title);
    }
  }finally{if(worker.running)await worker.stop();store.close();}
});


test('all blocked sources report their individual reasons without changing tasks',async()=>{
 const blocked={...batch,sources:[{source:'Blackboard',status:'blocked',checkedAt:task.observedAt,note:'Session expired'},{source:'Gmail',status:'error',checkedAt:task.observedAt,note:'Reconnect Gmail'}]};
 const {store,worker,done}=scenario([blocked]);
 try{store.importBatch({...batch,baseRevision:0});await worker.launch(store.requestRefresh());await done;
  assert.equal(store.snapshot().refresh.status,'failed');assert.match(store.snapshot().refresh.error,/Blackboard: Session expired/);assert.match(store.snapshot().refresh.error,/Gmail: Reconnect Gmail/);assert.equal(store.snapshot().tasks[0].title,task.title);assert.equal(store.snapshot().sources.find(s=>s.source==='Blackboard').note,'Session expired');
 }finally{store.close();}
});


test('ordinary multi-megabyte tool events can complete without retaining them',async()=>{
 const large=child=>{for(let i=0;i<210;i++)child.stdout.write(JSON.stringify({type:'tool_event',text:'x'.repeat(10000)})+'\n');child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(batch)}})+'\n');child.emit('close',0);};
 const {store,worker,done}=scenario([large]);try{await worker.launch(store.requestRefresh());await done;assert.equal(store.snapshot().refresh.status,'complete');}finally{store.close();}
});


test('complete oversized output line is rejected before parsing',async()=>{
 const flood=child=>{child.stdout.write(JSON.stringify({type:'tool_event',text:'x'.repeat(2000)})+'\n');child.emit('close',0);};
 const {store,worker,done}=scenario([flood],()=>{},{lineLimit:1000});try{await worker.launch(store.requestRefresh());await done;assert.match(store.snapshot().refresh.error,/line exceeded/);}finally{store.close();}
});


test('missing source coverage is marked as unchecked for the current refresh',async()=>{
 const {store,worker,done}=scenario([batch]);try{await worker.launch(store.requestRefresh());await done;const result=store.snapshot();assert.equal(result.refresh.status,'complete');assert.equal(result.sources.find(s=>s.source==='Blackboard').status,'error');assert.match(result.sources.find(s=>s.source==='Blackboard').note,/Not checked during this refresh/);assert.equal(result.sources.find(s=>s.source==='Gmail').status,'partial');}finally{store.close();}
});

test('worker turns source codes into dashboard health and supplies reviewer metadata',{timeout:2000},async()=>{
  const compact={...batch,sources:[{source:'Blackboard',codes:['reviewed','undated_work']},{source:'Gmail',codes:['reviewed']},{source:'Outlook',codes:['login_required']}],ranking:{order:batch.ranking.order}};
  const {store,worker,done}=scenario([compact]);
  try{
    await worker.launch(store.requestRefresh());await done;
    const result=store.snapshot();
    assert.equal(result.refresh.status,'complete');
    assert.equal(result.sources.find(s=>s.source==='Blackboard').status,'reviewed');
    assert.match(result.sources.find(s=>s.source==='Blackboard').note,/undated/);
    assert.equal(result.sources.find(s=>s.source==='Outlook').status,'blocked');
    assert.equal(result.ranking.reviewer,'gpt-6.1-terra · medium');
  }finally{store.close();}
});

test('refresh passes deleted task feedback to the mail collector',()=>{
 const feedback=[{id:'deleted',source:'Gmail',title:'Promotion',context:'Repeated promotion',from:'news@example.com',deletedAt:'2026-11-06T00:00:00Z'}];
 const input=refreshInput({revision:1,tasks:[],deletedTaskHistory:feedback});
 assert.deepEqual(input.deletedTaskHistory,feedback);
});
