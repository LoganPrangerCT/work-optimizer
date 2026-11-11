import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';

export function readBackups(path=fileURLToPath(new URL('../data/backups/backups.jsonl',import.meta.url))){
  return readFileSync(path,'utf8').split('\n').filter(Boolean).map((line,i)=>{
    try{
      const entry=JSON.parse(line);
      if(typeof entry.file!=='string'||typeof entry.time!=='string'||typeof entry.bytes!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.bytes))throw new Error('Invalid backup entry');
      return entry;
    }catch(error){throw new Error(`Backup line ${i+1}: ${error.message}`);}
  });
}

export function extractBackup(entries,index,destination){
  if(!Number.isSafeInteger(index)||index<1||index>entries.length)throw new Error('Choose a valid backup number.');
  writeFileSync(destination,Buffer.from(entries[index-1].bytes,'base64'),{flag:'wx'});
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const [number,destination]=process.argv.slice(2),entries=readBackups();
    if(number===undefined)entries.forEach((entry,i)=>console.log(`${i+1}\t${entry.time}\t${entry.file}`));
    else if(!/^\d+$/.test(number)||!destination)throw new Error('Usage: node scripts/backup-tasks.mjs [number destination]');
    else{extractBackup(entries,Number(number),destination);console.log(`Backup saved to ${destination}.`);}
  }catch(error){console.error(error.message);process.exitCode=1;}
}
