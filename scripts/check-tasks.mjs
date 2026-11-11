import {fileURLToPath} from 'node:url';
import {readTaskFiles,taskFileNames} from '../src/task-files.mjs';
import {normalizeFileTask} from '../src/store.mjs';

try{
  const paths=taskFileNames.map(name=>fileURLToPath(new URL('../data/'+name,import.meta.url)));
  const tasks=readTaskFiles(paths,normalizeFileTask);
  const old=tasks.filter(t=>t.completedAt||t.deleted).length;
  console.log(`Valid: ${tasks.length-old} current tasks, ${old} old tasks. No files changed.`);
}catch(error){console.error(error.message);process.exitCode=1;}
