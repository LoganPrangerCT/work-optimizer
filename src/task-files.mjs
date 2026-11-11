import {existsSync,readFileSync,writeFileSync,appendFileSync,renameSync,unlinkSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {dirname,basename,join} from 'node:path';

const invalid=message=>{throw Object.assign(new Error(message),{status:400});};
const fields=new Set(['id','title','source','externalId','actionKey','context','due','time','estimate','priority','reason','excerpt','from','url','observedAt','sourceStatus','submissionStatus','sample','rank','completedAt','actual','tag','tone','hidden','deletedAt']);
export const taskFileNames=Object.freeze(['active-tasks.json','completed-tasks.json']);

export function readTaskFiles(paths,normalize,versions){
  const ids=new Set();
  return paths.flatMap((path,index)=>{
    let entries;
    try{
      const contents=versions?versions[index]:readFileSync(path,'utf8');
      entries=JSON.parse(contents.replace(/^\uFEFF/,''));
    }
    catch(error){invalid(`${path}: ${error.message}`);}
    if(!Array.isArray(entries))invalid(`${path}: expected a JSON array of tasks`);
    return entries.map((entry,i)=>{
      try{
        if(!entry||typeof entry!=='object'||Array.isArray(entry))invalid('Expected a task object');
        for(const key of Object.keys(entry))if(!fields.has(key))invalid(`Unknown field: ${key}`);
        if(entry.deletedAt!=null){
          if(index!==1||!Number.isFinite(Date.parse(entry.deletedAt))||typeof entry.id!=='string'||!entry.id||typeof entry.title!=='string'||!entry.title||typeof entry.source!=='string'||(entry.externalId!=null&&typeof entry.externalId!=='string')||(entry.actionKey!=null&&typeof entry.actionKey!=='string'))invalid('Invalid deleted task');
          return {...entry,deleted:true};
        }
        const task=normalize(entry);
        if(entry.hidden!=null&&typeof entry.hidden!=='boolean')invalid('hidden must be true or false');
        if(ids.has(task.id))invalid(`Duplicate task ID: ${task.id} (check both files)`);
        ids.add(task.id);
        const rank=entry.rank??i+1;
        if(!Number.isInteger(rank)||rank<1)invalid('rank must be a positive integer');
        const actual=entry.actual??null;
        if(actual!==null&&(!Number.isInteger(actual)||actual<1||actual>1440))invalid('actual must be 1–1440 minutes or null');
        const completedAt=index===1?entry.completedAt:null;
        if(index===1&&(typeof completedAt!=='string'||!Number.isFinite(Date.parse(completedAt))))invalid('Old tasks need a completedAt timestamp');
        if(index===0&&entry.completedAt!=null)invalid('Move completed tasks to completed-tasks.json');
        if(index===0&&entry.sourceStatus==='completed')invalid('Move completed tasks to completed-tasks.json');
        return {...task,rank,actual,completedAt,...(entry.hidden?{hidden:true}:{})};
      }catch(error){invalid(`${path}, task ${i+1}: ${error.message}`);}
    });
  });
}

export function taskFileContents(rows,deleted=[]){
  // Unfinished demo tasks stop being useful once the workspace contains real work.
  if(rows.some(t=>!t.sample))rows=rows.filter(t=>!t.sample||t.completedAt);
  return [false,true].map(completed=>JSON.stringify([...rows.filter(t=>!!t.completedAt===completed).map((t,i)=>{
    const {completedAt,actual,hidden,...task}=t;
    const result=task.source==='Manual'?{
      id:task.externalId,title:task.title,priority:task.priority,rank:i+1,
      context:task.context,due:task.due,time:task.time,estimate:task.estimate,
      reason:task.reason,excerpt:task.excerpt,from:task.from,url:task.url,
    }:{...task,rank:i+1,sourceStatus:completed?'completed':'active'};
    if(hidden)result.hidden=true;
    if(completed)result.completedAt=completedAt;
    if(actual!==null)result.actual=actual;
    return result;
  }),...(completed?deleted.map(({deleted,...entry})=>entry):[])],null,2)+'\n');
}

// Each replacement is atomic; the SQLite outbox lets an interrupted pair finish on restart.
export const fileVersions=paths=>paths.map(path=>existsSync(path)?readFileSync(path,'utf8'):null);
export function assertFileVersions(paths,expected,contents=[]){
  const current=fileVersions(paths);
  if(current.some((value,i)=>value!==expected[i]&&value!==contents[i]))throw Object.assign(new Error('Task file conflict. Disk edits were preserved. Stop the server and follow docs/tasks.md recovery before retrying.'),{status:409});
}
export function writeTaskFiles(paths,contents,expected=fileVersions(paths)){
  assertFileVersions(paths,expected,contents);
  paths.forEach((path,i)=>{
    if(existsSync(path)&&readFileSync(path,'utf8')===contents[i])return;
    const temporary=path+'.'+randomUUID()+'.tmp';
    try{
      writeFileSync(temporary,contents[i],'utf8');
      assertFileVersions(paths,expected,contents);
      // Keep the exact replaced bytes for recovery from an editor racing the rename.
      if(existsSync(path)){
        const backups=join(dirname(path),'backups');mkdirSync(backups,{recursive:true});
        appendFileSync(join(backups,'backups.jsonl'),JSON.stringify({file:basename(path),time:new Date().toISOString(),bytes:readFileSync(path).toString('base64')})+'\n');
      }
      renameSync(temporary,path);
    }finally{if(existsSync(temporary))unlinkSync(temporary);}
  });
}
