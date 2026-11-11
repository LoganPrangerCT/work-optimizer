import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {tasks as samples} from '../public/model.js';
import {config} from './config.mjs';
import {readTaskFiles,taskFileContents,taskFileNames,writeTaskFiles,fileVersions,assertFileVersions} from './task-files.mjs';
import {sources} from './source-health.mjs';

export const databasePath=new URL('../data/work.sqlite',import.meta.url);
const now=()=>new Date().toISOString();
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const string=(value,max,required=false)=>{if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail('Invalid text field');return value.trim();};
const uncheckedSource=source=>({source,status:'not_checked',checkedAt:null,note:'Not checked'});
function normalizeSourceCheck(check,statuses){
  const {source,status,checkedAt,note}=check;
  if(!sources.includes(source)||!statuses.includes(status)||!Number.isFinite(Date.parse(checkedAt)))fail('Invalid source status');
  return {source,status,checkedAt,note:string(note??'',500)};
}
const secureUrl=value=>{try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)fail('Invalid source URL');return url;}catch{fail('Invalid source URL');}};
export function taskId(source,externalId,actionKey='main'){return source==='Manual'?'manual:'+externalId:createHash('sha256').update(JSON.stringify([source,externalId,actionKey])).digest('hex').slice(0,32);}
function taskFields(t){
  const due=t.due??null,estimate=t.estimate??null;
  if(due!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(due)||!Number.isFinite(Date.parse(due))||new Date(due+'T12:00:00Z').toISOString().slice(0,10)!==due))fail('Invalid due date');
  if(estimate!==null&&(!Number.isInteger(estimate)||estimate<1||estimate>10080))fail('Invalid estimate');
  const priority=t.priority??null;
  if(priority!==null&&(!Number.isInteger(priority)||priority<1||priority>5))fail('Invalid priority');
  return {title:string(t.title,300,true),context:string(t.context??'',300),due,time:string(t.time??'',40),estimate,priority,reason:string(t.reason,500,true),excerpt:string(t.excerpt,3000,true),from:string(t.from??'',300)};
}
function normalize(t){
  if(!t||!sources.includes(t.source))fail('Unsupported source');
  const externalId=string(t.externalId,2000,true),actionKey=string(t.actionKey??'main',100,true),fields=taskFields(t);
  const url=secureUrl(t.url);
  const isMailHost=['mail.google.com','outlook.office.com','outlook.office365.com','outlook.live.com'].includes(url.hostname);
  const isBbHost=url.hostname.endsWith('.blackboard.com')||config.allowedDomains.some(d=>url.hostname===d||url.hostname.endsWith('.'+d));
  if(!isMailHost&&!isBbHost)fail('Unsupported source URL');
  if(!Number.isFinite(Date.parse(t.observedAt)))fail('Observation timestamp required');
  return {id:taskId(t.source,externalId,actionKey),source:t.source,externalId,actionKey,...fields,url:url.href,observedAt:t.observedAt,sourceStatus:t.sourceStatus==='completed'?'completed':'active',...(t.source==='Blackboard'&&['not_submitted','in_progress'].includes(t.submissionStatus)?{submissionStatus:t.submissionStatus}:{}),sample:false};
}
export function normalizeFileTask(t){
  if(t.source&&t.source!=='Manual'&&!t.sample)return normalize(t);
  const sample=t.sample&&samples.find(s=>'demo:'+s.id===t.id&&s.source===t.source);
  if(t.sample&&!sample)fail('Unknown sample task');
  const id=string(t.id,100,true);
  if(!sample&&!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id))fail('id must use letters, numbers, hyphens or underscores');
  const fields=taskFields({...t,priority:t.priority??(sample?null:3),reason:t.reason??'Added by you.',excerpt:t.excerpt??t.title});
  let url=t.url??null;
  if(url!==null)url=secureUrl(url).href;
  return {...fields,id:sample?t.id:taskId('Manual',id),source:sample?t.source:'Manual',externalId:id,actionKey:'main',url,observedAt:null,sourceStatus:'active',sample:!!sample};
}
// Compare titles only within the same source item; unrelated messages can have similar names.
function sameTask(a,b){
  if(a.source!==b.source||a.externalId!==b.externalId)return false;
  if(a.actionKey===b.actionKey)return true;
  if(a.actionKey?.startsWith('reply-')||b.actionKey?.startsWith('reply-'))return false;
  const words=title=>new Set((title.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).filter(word=>!['a','an','the','to','for'].includes(word)));
  const left=words(a.title),right=words(b.title);
  if(!left.size||!right.size)return false;
  const common=[...left].filter(word=>right.has(word)).length;
  return common/Math.max(left.size,right.size)>=0.8;
}
export function openStore(path=databasePath,{seed=true,publish=writeTaskFiles}={}){
  const database=path instanceof URL?fileURLToPath(path):path;
  const directory=database===':memory:'?null:dirname(database);
  const filePaths=directory===null?null:taskFileNames.map(name=>join(directory,name));
  // A separate SQLite lock covers the JSON pair too, including different database filenames.
  let writer;
  if(filePaths){
    mkdirSync(directory,{recursive:true});
    writer=new DatabaseSync(join(directory,'.work-optimizer-writer.sqlite'));
    try{writer.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');}
    catch{writer.close();throw new Error('Workspace already open in another process. Stop the other server before starting this one.');}
  }
  let closed=false;
  const close=()=>{if(closed)return;closed=true;try{db.close();}finally{writer?.close();}};
  let db;
  try{
  db=new DatabaseSync(database);db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,data TEXT NOT NULL,position INTEGER NOT NULL,completed_at TEXT,actual INTEGER,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,task_id TEXT NOT NULL,kind TEXT NOT NULL,actual INTEGER,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS refreshes(id TEXT PRIMARY KEY,status TEXT NOT NULL,created_at TEXT NOT NULL,finished_at TEXT,error TEXT);
    CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,summary TEXT NOT NULL);
  `);
  const updatePosition=db.prepare('UPDATE tasks SET position=? WHERE id=?');
  const selectMeta=db.prepare('SELECT value FROM metadata WHERE key=?');
  const upsertMeta=db.prepare('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const getMeta=k=>{const row=selectMeta.get(k);return row?JSON.parse(row.value):null;};
  const setMeta=(k,v)=>upsertMeta.run(k,JSON.stringify(v));
  const updateSources=checks=>{const existing=getMeta('sources')||[];setMeta('sources',sources.map(source=>checks.find(s=>s.source===source)||existing.find(s=>s.source===source)||uncheckedSource(source)));};
  if(seed&&!getMeta('initialized')&&!filePaths?.some(existsSync)){const insert=db.prepare('INSERT OR IGNORE INTO tasks VALUES(?,?,?,NULL,NULL,?)');for(const [i,t] of samples.entries())insert.run('demo:'+t.id,JSON.stringify({...t,id:'demo:'+t.id,sample:true,url:null}),i,now());setMeta('initialized',true);setMeta('revision',0);}
  const selectTasks=db.prepare('SELECT data,completed_at,actual FROM tasks ORDER BY position,id');
  const rows=()=>selectTasks.all().map(r=>({...JSON.parse(r.data),completedAt:r.completed_at,actual:r.actual}));
  const latestRefresh=db.prepare('SELECT * FROM refreshes ORDER BY created_at DESC,rowid DESC LIMIT 1');
  const workspaceMode=()=>getMeta('live')?'live':'demo';
  const visibleTasks=(tasks,mode)=>tasks.filter(t=>t.source!=='Teams'&&(mode==='demo'||!t.sample));
  function flushFiles(){
    const pending=getMeta('taskFilesPending');
    if(pending&&filePaths){
      const contents=pending.contents||pending,expected=pending.expected||getMeta('taskFilesLoaded')||[null,null];
      try{publish(filePaths,contents,expected);}
      catch(error){throw Object.assign(new Error('Database saved; task files are not published. '+error.message),{status:503,committed:true});}
      setMeta('taskFilesLoaded',contents);setMeta('taskFilesPending',null);
    }
  }
  const commitTasks=(fn,expected)=>{
    db.exec('BEGIN IMMEDIATE');
    let result;
    try{result=fn();if(filePaths){assertFileVersions(filePaths,expected);setMeta('taskFilesPending',{contents:taskFileContents(rows(),getMeta('deletedTaskHistory')||[]),expected});}db.exec('COMMIT');}
    catch(e){db.exec('ROLLBACK');throw e;}
    flushFiles();return result;
  };
  // Check against the files that were synchronized, so a later edit cannot become the write baseline.
  const transaction=fn=>commitTasks(fn,syncFiles());
  const bump=()=>setMeta('revision',(getMeta('revision')||0)+1);
  function syncFiles(){
    if(!filePaths)return null;
    flushFiles();
    let expected=fileVersions(filePaths);
    if(expected.every(value=>value===null)){
      const contents=taskFileContents(rows(),getMeta('deletedTaskHistory')||[]);
      setMeta('taskFilesPending',{contents,expected});
      flushFiles();
      expected=contents;
    }else if(expected.includes(null))fail('Both active-tasks.json and completed-tasks.json must exist. Restore the missing file; use [] for an empty list.');
    const parsed=readTaskFiles(filePaths,normalizeFileTask,expected);
    const entries=parsed.filter(t=>!t.deleted).sort((a,b)=>a.rank-b.rank);
    const restoredIds=new Set(entries.map(t=>t.id));
    const fileHistory=parsed.filter(t=>t.deleted&&!restoredIds.has(t.id)).map(({deleted,...t})=>t);
    const previous=getMeta('taskFilesLoaded');
    const contents=taskFileContents(entries,fileHistory);
    if(JSON.stringify(contents)===JSON.stringify(previous)){
      assertFileVersions(filePaths,expected);
      if(!getMeta('deletedFilesMigrated')){commitTasks(()=>setMeta('deletedFilesMigrated',true),expected);return getMeta('taskFilesLoaded');}
      return expected;
    }
    commitTasks(()=>{
      const overrides=getMeta('priorityOverrides')||{};for(const t of entries)if(Object.hasOwn(overrides,t.id)&&overrides[t.id]!==t.priority){if(t.priority==null)delete overrides[t.id];else overrides[t.id]=t.priority;}setMeta('priorityOverrides',overrides);
      db.exec('DELETE FROM tasks');
      const restored=new Set(entries.map(t=>t.id));
      const legacy=getMeta('deletedFilesMigrated')?[]:(getMeta('deletedTaskHistory')||[]);
      const history=[...fileHistory,...legacy.filter(t=>!restored.has(t.id)&&!fileHistory.some(item=>item.id===t.id))];
      const oldHistory=getMeta('deletedTaskHistory')||[];
      setMeta('deletedTaskHistory',history);setMeta('deletedTaskIds',[...new Set([...(getMeta('deletedTaskIds')||[]).filter(id=>!restored.has(id)&&(!getMeta('deletedFilesMigrated')||!oldHistory.some(t=>t.id===id))),...history.map(t=>t.id)])]);setMeta('deletedFilesMigrated',true);
      const insert=db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?)');
      entries.forEach(({rank,completedAt,actual,...t},i)=>insert.run(t.id,JSON.stringify(t),i,completedAt,actual,now()));
      if(entries.some(t=>!t.sample))setMeta('live',true);
      setMeta('ranking',{reviewer:'Task files',summary:'Ordered by rank in active-tasks.json; lower numbers come first.',reviewedAt:now()});
      bump();
    },expected);
    return getMeta('taskFilesLoaded');
  }
  function snapshot(){
    syncFiles();
    return readSnapshot();
  }
  function readSnapshot(){
    const mode=workspaceMode();
    const all=rows();
    return {mode,revision:getMeta('revision')||0,deletedTaskHistory:getMeta('deletedTaskHistory')||[],tasks:visibleTasks(all,mode),legacyHistory:all.filter(t=>t.sample&&t.completedAt),sources:getMeta('sources')||sources.map(uncheckedSource),ranking:getMeta('ranking'),refresh:latestRefresh.get()||null,lastRefreshAt:getMeta('lastRefreshAt'),serverTime:now()};
  }
  function requestRefresh(){return transaction(()=>db.prepare("SELECT * FROM refreshes WHERE status='pending' LIMIT 1").get()||db.prepare("INSERT INTO refreshes VALUES(?,'pending',?,NULL,NULL) RETURNING *").get(randomUUID(),now()));}
  function addTask(payload){
    const task=normalizeFileTask({...payload,source:'Manual',sample:false});
    return transaction(()=>{
      const existing=db.prepare('SELECT data FROM tasks WHERE id=?').get(task.id);
      // A retried request keeps its identity if the first response was lost.
      if(existing){if(JSON.stringify(JSON.parse(existing.data))===JSON.stringify(task))return readSnapshot();fail('Task ID already exists');}
      if(!Number.isInteger(payload.baseRevision)||payload.baseRevision!==(getMeta('revision')||0))throw Object.assign(new Error('Workspace changed; reload tasks before adding this task'),{status:409});
      db.prepare('INSERT INTO tasks VALUES(?,?,?,NULL,NULL,?)').run(task.id,JSON.stringify(task),db.prepare('SELECT COUNT(*) AS count FROM tasks').get().count,now());
      setMeta('live',true);bump();return readSnapshot();
    });
  }
  function updateTask(id,action,actual=null,baseRevision,priority=null){return transaction(()=>{
    if(baseRevision!==undefined&&(!Number.isInteger(baseRevision)||baseRevision!==(getMeta('revision')||0)))throw Object.assign(new Error('Workspace changed; reload before updating this task'),{status:409});
    const row=db.prepare('SELECT * FROM tasks WHERE id=?').get(id);if(!row)throw Object.assign(new Error('Task not found'),{status:404});
    if(action==='delete'){
      const task=JSON.parse(row.data);if(!task.sample){const history=(getMeta('deletedTaskHistory')||[]).filter(item=>item.id!==id);history.push({id,source:task.source,externalId:task.externalId,actionKey:task.actionKey,title:task.title,context:task.context,from:task.from,deletedAt:now()});setMeta('deletedTaskHistory',history);}
      const deleted=new Set(getMeta('deletedTaskIds')||[]);deleted.add(id);setMeta('deletedTaskIds',[...deleted]);const overrides=getMeta('priorityOverrides')||{};delete overrides[id];setMeta('priorityOverrides',overrides);
      db.prepare('DELETE FROM events WHERE task_id=?').run(id);db.prepare('DELETE FROM tasks WHERE id=?').run(id);bump();return readSnapshot();
    }
    if(action==='hide'){
      const task=JSON.parse(row.data);task.hidden=true;db.prepare('UPDATE tasks SET data=?,updated_at=? WHERE id=?').run(JSON.stringify(task),now(),id);bump();return readSnapshot();
    }
    if(action==='priority'){
      if(!Number.isInteger(priority)||priority<1||priority>5)fail('Priority must be 1–5');
      const task=JSON.parse(row.data);task.priority=priority;db.prepare('UPDATE tasks SET data=?,updated_at=? WHERE id=?').run(JSON.stringify(task),now(),id);
      const overrides=getMeta('priorityOverrides')||{};overrides[id]=priority;setMeta('priorityOverrides',overrides);
      const active=rows().filter(t=>!t.completedAt).sort((a,b)=>(b.priority||0)-(a.priority||0));active.forEach((t,i)=>updatePosition.run(i,t.id));
      setMeta('ranking',{reviewer:'Manual order',summary:'Priority set by you.',reviewedAt:now()});bump();return readSnapshot();
    }
    if(!['complete','restore'].includes(action))fail('Invalid action');
    if(actual!==null&&(!Number.isInteger(actual)||actual<1||actual>1440))fail('Duration must be 1–1440 minutes');
    if((action==='complete'&&row.completed_at&&row.actual===actual)||(action==='restore'&&!row.completed_at))return readSnapshot();
    db.prepare('UPDATE tasks SET completed_at=?,actual=?,updated_at=? WHERE id=?').run(action==='complete'?(row.completed_at||now()):null,action==='complete'?actual:row.actual,now(),id);
    db.prepare('INSERT INTO events(task_id,kind,actual,created_at) VALUES(?,?,?,?)').run(id,action,actual,now());bump();return readSnapshot();
  });}
  function importBatch(batch){
    if(!batch||!Array.isArray(batch.tasks)||batch.tasks.length>500||!Array.isArray(batch.sources))fail('Invalid import batch');
    for(const t of batch.tasks){if(t.submissionStatus!=null&&!['not_submitted','in_progress','submitted','graded','unknown'].includes(t.submissionStatus))fail('Invalid submission status');if(t.submissionStatus!=null&&t.source!=='Blackboard')fail('Submission status is only supported for Blackboard');if(['not_submitted','in_progress'].includes(t.submissionStatus)&&(t.sourceStatus!=='active'||!t.due))fail('Unsubmitted Blackboard work must be active and have a due date');}
    const normalized=batch.tasks.map(normalize),ids=new Set(normalized.map(t=>t.id));if(ids.size!==normalized.length)fail('Duplicate task in batch');
    const checks=batch.sources.map(check=>normalizeSourceCheck(check,['reviewed','partial','blocked','error']));
    if(new Set(checks.map(s=>s.source)).size!==checks.length)fail('Duplicate source status');
    const ranking=batch.ranking;if(!ranking||!Array.isArray(ranking.order)||ranking.order.length>1000||!Number.isInteger(batch.baseRevision))fail('Ranking and baseRevision required');
    let order=ranking.order.map(ref=>typeof ref==='string'?ref:taskId(ref.source,ref.externalId,ref.actionKey));
    if(new Set(order).size!==order.length)fail('Duplicate rank');
    const reviewer=string(ranking.reviewer,100,true),summary=string(ranking.summary,1500,true);
    return transaction(()=>{
      if(batch.baseRevision!==(getMeta('revision')||0))throw Object.assign(new Error('Workspace changed; review current history before importing'),{status:409});
      if(batch.requestId&&!db.prepare("SELECT id FROM refreshes WHERE id=? AND status='pending'").get(batch.requestId))fail('Refresh request is not pending');
      const deleted=new Set(getMeta('deletedTaskIds')||[]),history=getMeta('deletedTaskHistory')||[],finished=rows().filter(t=>t.completedAt),blocked=new Set(),overrides=getMeta('priorityOverrides')||{};
      const upsert=db.prepare('INSERT INTO tasks VALUES(?,?,?,NULL,NULL,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at');
      for(const [i,t] of normalized.entries()){
        const unsubmitted=t.source==='Blackboard'&&['not_submitted','in_progress'].includes(batch.tasks[i].submissionStatus);
        const mailStatus=batch.tasks[i].mailReadStatus;
        if(batch.requestId&&['Gmail','Outlook'].includes(t.source)&&mailStatus==null)fail('Email read status is required');
        if(mailStatus!=null&&!['Gmail','Outlook'].includes(t.source))fail('Mail read status is only supported for email');
        if(mailStatus!=null&&!['read','unread','unknown'].includes(mailStatus))fail('Invalid mail read status');
        if(mailStatus==='read')t.sourceStatus='completed';
        if(mailStatus==='unknown'&&!db.prepare('SELECT id FROM tasks WHERE id=?').get(t.id))fail('New email tasks require confirmed unread status');
        if(deleted.has(t.id)||history.some(old=>sameTask(old,t))||finished.some(old=>old.id!==t.id&&sameTask(old,t))){blocked.add(t.id);continue;}
        const existing=db.prepare('SELECT data FROM tasks WHERE id=?').get(t.id);if(existing&&JSON.parse(existing.data).hidden)t.hidden=true;
        if(Object.hasOwn(overrides,t.id))t.priority=overrides[t.id];
        const prior=unsubmitted?db.prepare('SELECT completed_at,actual FROM tasks WHERE id=?').get(t.id):null;
        upsert.run(t.id,JSON.stringify(t),100000,now());
        if(prior?.completed_at){db.prepare('UPDATE tasks SET completed_at=NULL,updated_at=? WHERE id=?').run(now(),t.id);db.prepare('INSERT INTO events(task_id,kind,actual,created_at) VALUES(?,?,?,?)').run(t.id,'restore',prior.actual,now());}
        if(t.sourceStatus==='completed')db.prepare('UPDATE tasks SET completed_at=COALESCE(completed_at,?) WHERE id=?').run(now(),t.id);
      }
      setMeta('deletedTaskIds',[...deleted]);
      setMeta('deletedTaskHistory',(getMeta('deletedTaskHistory')||[]).filter(item=>deleted.has(item.id)));
      const activeTasks=db.prepare('SELECT id,data FROM tasks WHERE completed_at IS NULL').all().map(r=>({id:r.id,...JSON.parse(r.data)})).filter(t=>!t.sample);
      const active=new Set(activeTasks.map(t=>t.id));
      const completed=new Set(db.prepare('SELECT id FROM tasks WHERE completed_at IS NOT NULL').all().map(t=>t.id));
      // Other completed work stays complete unless explicitly restored above.
      order=order.filter(id=>!completed.has(id)&&!deleted.has(id)&&!blocked.has(id));
      if(active.size!==order.length||order.some(id=>!active.has(id)))fail('Rank every active real task exactly once');
      const priorities=new Map(activeTasks.map(t=>[t.id,t.priority??0]));
      // Criticality sets the tier; AI ordering breaks ties within each tier.
      order.sort((a,b)=>priorities.get(b)-priorities.get(a));
      order.forEach((id,i)=>updatePosition.run(i,id));
      updateSources(checks);
      const at=now();setMeta('ranking',{reviewer,summary,reviewedAt:at});setMeta('lastRefreshAt',at);setMeta('live',true);bump();
      db.prepare('INSERT INTO runs VALUES(?,?,?)').run(randomUUID(),at,summary);
      if(batch.requestId)db.prepare("UPDATE refreshes SET status='complete',finished_at=? WHERE id=?").run(at,batch.requestId);
      return readSnapshot();
    });
  }
  function reorderTasks(order,baseRevision){return transaction(()=>{
    if(!Number.isInteger(baseRevision)||baseRevision!==(getMeta('revision')||0))throw Object.assign(new Error('Workspace changed; reload before reordering'),{status:409});
    const active=new Set(visibleTasks(rows(),workspaceMode()).filter(t=>!t.completedAt).map(t=>t.id));
    if(!Array.isArray(order)||order.length!==active.size||new Set(order).size!==order.length||order.some(id=>!active.has(id)))fail('Order must include every active task exactly once');
    order.forEach((id,i)=>updatePosition.run(i,id));
    setMeta('ranking',{reviewer:'Manual order',summary:'Tasks reordered by you. The next AI refresh may reorder them.',reviewedAt:now()});
    bump();return readSnapshot();
  });}
  // Publication already committed the refresh; preserve its recovery diagnosis without retrying.
  function reportRefreshPublicationError(id,error){db.prepare("UPDATE refreshes SET error=? WHERE id=? AND status='complete'").run(string(error,500,true),id);}
  function failRefresh(id,error,checks=[]){
    const note=string(error,500,true);
    const diagnostics=checks.map(check=>normalizeSourceCheck(check,['blocked','error']));
    db.exec('BEGIN IMMEDIATE');
    try{const r=db.prepare("UPDATE refreshes SET status='failed',error=?,finished_at=? WHERE id=? AND status='pending'").run(note,now(),id);if(!r.changes)fail('Refresh request is not pending');
      if(diagnostics.length)updateSources(diagnostics);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return snapshot();
  }

  function migrateLegacy(entries){if(!Array.isArray(entries)||entries.length>100)fail('Invalid legacy history');return transaction(()=>{for(const h of entries){if(!Number.isInteger(h.id)||!samples.some(t=>t.id===h.id)||!Number.isFinite(Date.parse(h.completedAt))||(h.actual!==null&&(!Number.isInteger(h.actual)||h.actual<1||h.actual>1440)))fail('Invalid legacy completion');db.prepare('UPDATE tasks SET completed_at=COALESCE(completed_at,?),actual=CASE WHEN completed_at IS NULL THEN ? ELSE actual END WHERE id=?').run(h.completedAt,h.actual,'demo:'+h.id);}if(entries.length)bump();return readSnapshot();});}
  syncFiles();
  return {db,snapshot,requestRefresh,updateTask,addTask,reorderTasks,importBatch,failRefresh,reportRefreshPublicationError,migrateLegacy,close};
  }catch(error){if(db)close();else writer?.close();throw error;}
}
