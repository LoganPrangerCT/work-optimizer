import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {openStore} from '../src/store.mjs';
import {writeTaskFiles} from '../src/task-files.mjs';
import {createServer} from '../src/server.mjs';
import {exportRecovery} from '../scripts/recover-tasks.mjs';

function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'work-reliability-'));
  const path=join(dir,'work.sqlite');
  writeFileSync(join(dir,'active-tasks.json'),JSON.stringify([{id:'one',title:'Original'}]));
  writeFileSync(join(dir,'completed-tasks.json'),'[]');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  return {dir,path};
}

test('a second real process cannot write the same task files; lock releases on close',t=>{
  const {path}=fixture(t),store=openStore(path,{seed:false});
  const code=`import {openStore} from ${JSON.stringify(new URL('../src/store.mjs',import.meta.url).href)};const s=openStore(${JSON.stringify(path)});s.close();`;
  try{
    const blocked=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});
    assert.equal(blocked.status,1,blocked.stderr);assert.match(blocked.stderr,/already open in another process/);
  }finally{store.close();}
  const reopened=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});
  assert.equal(reopened.status,0,reopened.stderr);
});

for(const boundary of [0,1,2])test(`real publication failure after ${boundary} replacements preserves committed history on restart`,async t=>{
  const {path}=fixture(t);let armed=false;
  const store=openStore(path,{seed:false,publish:(paths,contents,expected)=>{
    if(!armed)return writeTaskFiles(paths,contents,expected);
    for(let i=0;i<boundary;i++)writeTaskFiles([paths[i]],[contents[i]],[expected[i]]);
    throw new Error('Injected publication boundary '+boundary);
  }});
  const server=createServer(store);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    const revision=store.snapshot().revision;armed=true;
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/tasks/manual%3Aone`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'complete',actual:37,baseRevision:revision})});
    assert.equal(response.status,503);const body=await response.json();assert.equal(body.committed,true);assert.match(body.error,/Database saved/);
    assert.equal(store.db.prepare('SELECT count(*) n FROM events').get().n,1);
  }finally{await new Promise(r=>server.close(r));store.close();}
  const restored=openStore(path,{seed:false});
  try{const tasks=restored.snapshot().tasks;assert.equal(tasks.length,1);assert.equal(tasks[0].id,'manual:one');assert.equal(tasks[0].actual,37);assert.ok(tasks[0].completedAt);assert.equal(restored.db.prepare('SELECT count(*) n FROM events').get().n,1);}finally{restored.close();}
});

test('external edit after a committed interrupted save remains intact and recovery retains minutes',t=>{
  const {dir,path}=fixture(t);let armed=false;
  let store=openStore(path,{seed:false,publish:(...args)=>{if(armed)throw new Error('Interrupted');return writeTaskFiles(...args);}});
  armed=true;assert.throws(()=>store.updateTask('manual:one','complete',53),/Database saved/);store.close();
  const external=JSON.stringify([{id:'one',title:'Original'},{id:'later',title:'Later external edit'}]);
  writeFileSync(join(dir,'active-tasks.json'),external);
  assert.throws(()=>openStore(path,{seed:false}),/Database saved;.*conflict/);
  assert.equal(readFileSync(join(dir,'active-tasks.json'),'utf8'),external);
  const recovery=exportRecovery(path,join(dir,'recovery'));
  assert.equal(readFileSync(join(recovery,'disk-active-tasks.json'),'utf8'),external);
  assert.equal(JSON.parse(readFileSync(join(recovery,'committed-completed-tasks.json'),'utf8'))[0].actual,53);
  // Documented recovery: keep private copies, restore the pre-save files, replay, then merge.
  ['active-tasks.json','completed-tasks.json'].forEach(name=>writeFileSync(join(dir,name),readFileSync(join(recovery,'before-'+name))));
  store=openStore(path,{seed:false});store.close();
  writeFileSync(join(dir,'active-tasks.json'),JSON.stringify([{id:'later',title:'Later external edit'}]));
  store=openStore(path,{seed:false});
  try{const tasks=store.snapshot().tasks;assert.equal(tasks.length,2);assert.equal(tasks.filter(t=>!t.completedAt).length,1);assert.equal(tasks.find(t=>t.id==='manual:one').actual,53);assert.equal(store.db.prepare('SELECT count(*) n FROM events').get().n,1);}finally{store.close();}
});

test('external save interleaved after SQL commit is detected before replacement',t=>{
  const {dir,path}=fixture(t);let armed=false;
  const external=JSON.stringify([{id:'one',title:'Later edit'},{id:'two',title:'Added externally'}]);
  const store=openStore(path,{seed:false,publish:(...args)=>{if(armed)writeFileSync(join(dir,'active-tasks.json'),external);return writeTaskFiles(...args);}});
  try{
    armed=true;assert.throws(()=>store.updateTask('manual:one','complete',19),/Database saved;.*conflict/);
    assert.equal(readFileSync(join(dir,'active-tasks.json'),'utf8'),external);
    assert.equal(store.db.prepare('SELECT actual FROM tasks WHERE id=?').get('manual:one').actual,19);
    assert.equal(store.db.prepare('SELECT count(*) n FROM events').get().n,1);
  }finally{store.close();}
});

test('a refresh cannot overwrite an edit made just after task-file synchronization',t=>{
  const {dir,path}=fixture(t);
  const active=join(dir,'active-tasks.json');
  const later=JSON.stringify([{id:'one',title:'Later edit'}]);
  let armed=false;
  const store=openStore(path,{seed:false,publish:(...args)=>{
    writeTaskFiles(...args);
    if(armed){
      armed=false;
      writeFileSync(active,later);
    }
  }});
  try{
    writeFileSync(active,JSON.stringify([{id:'one',title:'First edit'}]));
    armed=true;
    assert.throws(()=>store.requestRefresh(),{status:409});
    assert.equal(readFileSync(active,'utf8'),later);
    const state=store.snapshot();
    assert.equal(state.tasks[0].title,'Later edit');
    assert.equal(state.refresh,null);
  }finally{store.close();}
});
