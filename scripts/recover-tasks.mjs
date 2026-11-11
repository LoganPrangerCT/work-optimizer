import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {taskFileNames} from '../src/task-files.mjs';

// Export only: never resolve a conflict by silently choosing a side.
export function exportRecovery(database=fileURLToPath(new URL('../data/work.sqlite',import.meta.url)),destination=join('data','backups','recovery-'+Date.now())){
  const db=new DatabaseSync(database,{readOnly:true});
  let pending;
  try{const row=db.prepare("SELECT value FROM metadata WHERE key='taskFilesPending'").get();pending=row&&JSON.parse(row.value);}finally{db.close();}
  if(!pending?.contents||!pending.expected)throw new Error('No versioned pending publication. Keep a full backup and inspect the task files before changing them.');
  mkdirSync(dirname(resolve(destination)),{recursive:true});mkdirSync(destination);
  const taskDirectory=dirname(resolve(database));
  taskFileNames.forEach((name,i)=>{
    if(pending.expected[i]!==null)writeFileSync(join(destination,'before-'+name),pending.expected[i]);
    writeFileSync(join(destination,'committed-'+name),pending.contents[i]);
    if(existsSync(join(taskDirectory,name)))writeFileSync(join(destination,'disk-'+name),readFileSync(join(taskDirectory,name)));
  });
  writeFileSync(join(destination,'pending.json'),JSON.stringify(pending,null,2));
  return resolve(destination);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log('Recovery copies saved to '+exportRecovery(process.argv[2],process.argv[3])+'. Database and task files unchanged.');}
  catch(error){console.error(error.message);process.exitCode=1;}
}
