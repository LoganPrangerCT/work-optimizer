import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore,taskId} from '../src/store.mjs';
import {writeTaskFiles} from '../src/task-files.mjs';
import {readBackups,extractBackup} from '../scripts/backup-tasks.mjs';

test('backup log preserves exact prior bytes and extracts without overwriting',t=>{
  const dir=mkdtempSync(join(tmpdir(),'work-backups-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'active-tasks.json'),log=join(dir,'backups','backups.jsonl'),out=join(dir,'restore.json');
  const original=Buffer.from([0xef,0xbb,0xbf,0x5b,0x5d,0x0d,0x0a]);
  writeFileSync(path,original);
  writeTaskFiles([path],['[1]\n']);writeTaskFiles([path],['[2]\n']);
  const entries=readBackups(log);
  assert.equal(entries.length,2);assert.equal(entries[0].file,'active-tasks.json');
  extractBackup(entries,1,out);assert.deepEqual(readFileSync(out),original);
  assert.throws(()=>extractBackup(entries,2,out),/EEXIST/);
  assert.throws(()=>extractBackup(entries,3,join(dir,'missing')),/valid backup number/);
});

function workspace(t,entries=[]){
  const dir=mkdtempSync(join(tmpdir(),'work-task-files-'));
  const current=join(dir,'active-tasks.json'),old=join(dir,'completed-tasks.json');
  const write=(path,value)=>writeFileSync(path,JSON.stringify(value));
  write(current,entries);write(old,[]);
  const s=openStore(join(dir,'work.sqlite'),{seed:false});
  t.after(()=>{s.close();rmSync(dir,{recursive:true,force:true});});
  return {dir,current,old,s,write,read:path=>JSON.parse(readFileSync(path,'utf8'))};
}

test('two-field tasks load, ranks order the queue, and file changes invalidate stale AI work',t=>{
  const {s,current,write,read}=workspace(t,[{id:'later',title:'Later',priority:5,rank:2},{id:'first',title:'First',priority:3,rank:1}]);
  assert.deepEqual(s.snapshot().tasks.map(t=>t.title),['First','Later']);
  const revision=s.snapshot().revision;
  assert.equal(s.snapshot().revision,revision);
  write(current,[...read(current),{id:'new',title:'New task'}]);
  const stale={baseRevision:revision,tasks:[],sources:[],ranking:{order:[],reviewer:'Test',summary:'Stale'}};
  assert.throws(()=>s.importBatch(stale),/Workspace changed/);
  assert.equal(s.snapshot().tasks.find(t=>t.externalId==='new').priority,3);
  assert.equal(s.snapshot().tasks.length,3);
});

test('completion, actual time, restore and manual tasks survive refresh and restart',t=>{
  const {s,current,old,read,dir}=workspace(t,[{id:'proposal',title:'Write proposal',priority:4,estimate:120}]);
  s.updateTask('manual:proposal','complete',75);
  assert.equal(read(current).length,0);
  assert.equal(read(old)[0].actual,75);
  assert.ok(read(old)[0].completedAt);
  s.updateTask('manual:proposal','restore');
  assert.equal(read(old).length,0);
  assert.equal(read(current)[0].id,'proposal');
  const revision=s.snapshot().revision;
  s.importBatch({baseRevision:revision,tasks:[],sources:[],ranking:{order:[{source:'Manual',externalId:'proposal',actionKey:'main'}],reviewer:'Test',summary:'Retained manual work'}});
  assert.equal(s.snapshot().tasks[0].priority,4);
  assert.equal(s.snapshot().revision,revision+1);
  s.close();
  const reopened=openStore(join(dir,'work.sqlite'),{seed:false});
  try{assert.equal(reopened.snapshot().tasks[0].actual,75);}finally{reopened.close();}
});

test('invalid edits and duplicate IDs report file and entry without overwriting files or cached tasks',t=>{
  const {s,current,old,write,read}=workspace(t,[{id:'one',title:'Original'}]);
  const valid=read(current);
  const invalids=[{id:'one',title:'Bad',priority:6},{id:'one',title:'Bad',rank:0},{id:'one',title:'Bad',due:'2026-02-30'},{id:'one',title:'Bad',url:'javascript:alert(1)'},{id:'one',title:'Bad',priorty:5}];
  for(const entry of invalids){
    write(current,[entry]);
    assert.throws(()=>s.snapshot(),/active-tasks.json, task 1:/);
    assert.deepEqual(read(current),[entry]);
  }
  write(current,valid);write(old,[{id:'one',title:'Duplicate',completedAt:'2026-11-04T12:00:00Z'}]);
  assert.throws(()=>s.snapshot(),/Duplicate task ID/);
  write(old,[]);writeFileSync(current,'[broken');
  assert.throws(()=>s.snapshot(),/active-tasks.json:/);
  assert.equal(readFileSync(current,'utf8'),'[broken');
  write(current,valid);
  assert.equal(s.snapshot().tasks[0].title,'Original');
  rmSync(old);
  assert.throws(()=>s.snapshot(),/Both active-tasks.json and completed-tasks.json/);
  assert.equal(existsSync(old),false);
});

test('existing SQLite tasks migrate to both files without losing source identity or history',t=>{
  const {s,current,old,read,dir}=workspace(t);
  const task={source:'Gmail',externalId:'thread',title:'Imported',reason:'Due soon',excerpt:'Review please',url:'https://mail.google.com/mail/u/0/#all/thread',observedAt:'2026-11-04T12:00:00Z',priority:4};
  s.importBatch({baseRevision:s.snapshot().revision,tasks:[task],sources:[],ranking:{order:[taskId('Gmail','thread')],reviewer:'Test',summary:'Source task'}});
  s.updateTask(taskId('Gmail','thread'),'complete',42);
  // Copy just the database to simulate an existing installation with no JSON files yet.
  s.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const migrated=join(dir,'migration');
  // A sibling filename keeps this fixture in the same temporary directory.
  copyFileSync(join(dir,'work.sqlite'),migrated+'.sqlite');
  s.close();
  rmSync(current);rmSync(old);
  const restored=openStore(migrated+'.sqlite',{seed:false});
  try{
    assert.equal(read(current).length,0);
    assert.equal(read(old)[0].id,taskId('Gmail','thread'));
    assert.equal(restored.snapshot().tasks[0].actual,42);
    restored.updateTask(taskId('Gmail','thread'),'restore');
    assert.equal(restored.snapshot().tasks[0].completedAt,null);
  }finally{restored.close();}
});

test('interrupted file publication is recovered from the committed SQLite outbox',t=>{
  const {s,current,old,dir,read}=workspace(t,[{id:'one',title:'Task'}]);
  s.updateTask('manual:one','complete',10);
  const pending=[readFileSync(current,'utf8'),readFileSync(old,'utf8')];
  s.db.prepare('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('taskFilesPending',JSON.stringify({contents:pending,expected:['[]','[]']}));
  writeFileSync(current,'[]');writeFileSync(old,'[]');
  s.close();
  const recovered=openStore(join(dir,'work.sqlite'),{seed:false});
  try{assert.equal(read(old)[0].actual,10);assert.ok(recovered.snapshot().tasks[0].completedAt);}finally{recovered.close();}
});

test('documented examples validate and hidden unfinished demos stay out of live task files',t=>{
  const guide=readFileSync(new URL('../docs/tasks.md',import.meta.url),'utf8');
  const examples=[...guide.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)].map(match=>JSON.parse(match[1]));
  const {s,current,write,read}=workspace(t,examples[1]);
  assert.equal(s.snapshot().tasks[0].priority,4);
  write(current,[examples[0]]);
  assert.equal(s.snapshot().tasks[0].priority,3);
  const sample={id:'demo:1',source:'Blackboard',sample:true,title:'Example',due:null,reason:'Example',excerpt:'Example'};
  write(current,[...read(current),sample]);
  assert.equal(s.snapshot().tasks.length,1);
  s.updateTask('manual:write-proposal','complete');
  assert.equal(read(current).length,0);
});


test('restoring a deleted source task in the task file permits later refresh',t=>{
 const {s,current,read,write}=workspace(t);const task={source:'Gmail',externalId:'restore-me',title:'Imported',reason:'Needs review',excerpt:'Review please',url:'https://mail.google.com/mail/u/0/#all/thread',observedAt:'2026-11-04T12:00:00Z',priority:4};
 const makeBatch=()=>({baseRevision:s.snapshot().revision,tasks:[task],sources:[],ranking:{order:[taskId('Gmail','restore-me')],reviewer:'Test',summary:'Reviewed'}});
 s.importBatch(makeBatch());const saved=read(current);s.updateTask(taskId('Gmail','restore-me'),'delete',null,s.snapshot().revision);assert.equal(read(current).length,0);
 write(current,saved);assert.equal(s.snapshot().tasks.length,1);s.importBatch(makeBatch());assert.equal(s.snapshot().tasks.length,1);
});


test('task-file priority edits override an earlier UI choice for later refresh',t=>{
 const {s,current,read,write}=workspace(t);const task={source:'Gmail',externalId:'priority-file',title:'Imported',reason:'Review',excerpt:'Review',url:'https://mail.google.com/mail/u/0/#all/thread',observedAt:'2026-11-04T12:00:00Z',priority:2};
 const batch=()=>({baseRevision:s.snapshot().revision,tasks:[task],sources:[],ranking:{order:[taskId('Gmail','priority-file')],reviewer:'Test',summary:'Review'}});
 s.importBatch(batch());s.updateTask(taskId('Gmail','priority-file'),'priority',null,s.snapshot().revision,5);const edited=read(current);edited[0].priority=3;write(current,edited);assert.equal(s.snapshot().tasks[0].priority,3);s.importBatch(batch());assert.equal(s.snapshot().tasks[0].priority,3);
});


test('restored task-file priority replaces an earlier manual override',t=>{
 const {s,current,read,write}=workspace(t);const task={source:'Gmail',externalId:'priority-restore',title:'Imported',reason:'Review',excerpt:'Review',url:'https://mail.google.com/mail/u/0/#all/thread',observedAt:'2026-11-04T12:00:00Z',priority:2};
 const batch=()=>({baseRevision:s.snapshot().revision,tasks:[task],sources:[],ranking:{order:[taskId('Gmail','priority-restore')],reviewer:'Test',summary:'Review'}});
 s.importBatch(batch());s.updateTask(taskId('Gmail','priority-restore'),'priority',null,s.snapshot().revision,5);const saved=read(current);write(current,[]);s.snapshot();saved[0].priority=3;write(current,saved);s.snapshot();s.importBatch(batch());assert.equal(s.snapshot().tasks[0].priority,3);
});


test('refresh failure is recorded even when task files become invalid',t=>{
 const {s,current,read,write}=workspace(t,[{id:'keep',title:'Keep'}]);const saved=read(current);const request=s.requestRefresh();writeFileSync(current,'[invalid');
 assert.throws(()=>s.failRefresh(request.id,'Refresh could not start.'),/active-tasks.json/);
 assert.equal(s.db.prepare('SELECT status FROM refreshes WHERE id=?').get(request.id).status,'failed');
 assert.equal(readFileSync(current,'utf8'),'[invalid');write(current,saved);assert.equal(s.snapshot().refresh.error,'Refresh could not start.');assert.equal(s.snapshot().tasks[0].title,'Keep');
});


test('hidden and deleted task records survive files and restart',t=>{
 const {s,current,old,read,dir}=workspace(t,[{id:'keep',title:'Keep',due:'2030-01-01'},{id:'remove',title:'Remove'}]);
 s.updateTask('manual:keep','hide');assert.equal(read(current).find(t=>t.id==='keep').hidden,true);
 s.updateTask('manual:remove','delete');assert.ok(read(old).find(t=>t.id==='manual:remove').deletedAt);
 s.close();const reopened=openStore(join(dir,'work.sqlite'),{seed:false});
 try{assert.equal(reopened.snapshot().tasks[0].hidden,true);assert.equal(reopened.snapshot().deletedTaskHistory[0].id,'manual:remove');}finally{reopened.close();}
});

test('a hidden imported task does not change the revision on every read',t=>{
 const task={source:'Gmail',externalId:'hidden',title:'Hidden',reason:'Review',excerpt:'Review',url:'https://mail.google.com/mail/u/0/#all/thread',observedAt:'2026-11-04T12:00:00Z',hidden:true};
 const {s}=workspace(t,[task,{id:'other',title:'Other'}]);
 const revision=s.snapshot().revision;
 assert.equal(s.snapshot().revision,revision);
 s.updateTask('manual:other','complete',null,revision);
 assert.ok(s.snapshot().tasks.find(t=>t.id==='manual:other').completedAt);
});

test('existing deletion history migrates to the history file',t=>{
 const {s,current,old,read,dir}=workspace(t,[{id:'legacy',title:'Legacy'}]);
 s.updateTask('manual:legacy','delete');
 const oldEntries=read(old);assert.equal(oldEntries.length,1);
 s.db.prepare("DELETE FROM metadata WHERE key='deletedFilesMigrated'").run();
 s.db.prepare("UPDATE metadata SET value=? WHERE key='taskFilesLoaded'").run(JSON.stringify([JSON.stringify(read(current),null,2)+'\n','[]\n']));
 writeFileSync(old,'[]\n');s.close();
 const reopened=openStore(join(dir,'work.sqlite'),{seed:false});
 try{assert.equal(read(old)[0].id,'manual:legacy');assert.ok(read(old)[0].deletedAt);}finally{reopened.close();}
});

test('legacy deleted records without source identifiers survive restart',t=>{
 const {s,old,write,dir}=workspace(t);
 const legacy={id:'legacy-id',source:'Gmail',title:'Deleted task',deletedAt:'2026-11-06T06:07:27.079Z'};
 write(old,[legacy]);assert.deepEqual(s.snapshot().deletedTaskHistory,[legacy]);
 s.close();const reopened=openStore(join(dir,'work.sqlite'),{seed:false});
 try{assert.deepEqual(reopened.snapshot().deletedTaskHistory,[legacy]);}finally{reopened.close();}
});


test('deleted file records block refresh in a rebuilt database',t=>{
 const {s,dir,old,read}=workspace(t);
 const task={source:'Gmail',externalId:'thread',actionKey:'main',title:'Review draft',reason:'Review',excerpt:'Please review',url:'https://mail.google.com/mail/u/0/#all/thread',observedAt:'2026-11-04T12:00:00Z'};
 const batch=store=>({baseRevision:store.snapshot().revision,tasks:[task],sources:[],ranking:{order:[taskId('Gmail','thread')],reviewer:'Test',summary:'Review'}});
 s.importBatch(batch(s));s.updateTask(taskId('Gmail','thread'),'delete');assert.ok(read(old)[0].deletedAt);s.close();
 const rebuilt=openStore(join(dir,'rebuilt.sqlite'),{seed:false});
 try{rebuilt.importBatch(batch(rebuilt));assert.equal(rebuilt.snapshot().tasks.length,0);}finally{rebuilt.close();}
});
