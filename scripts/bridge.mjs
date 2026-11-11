import {openStore} from '../src/store.mjs';
import {readFile} from 'node:fs/promises';
const store=openStore();
try{
  const command=process.argv[2]||'context';
  if(command==='context'||command==='pending')console.log(JSON.stringify(store.snapshot(),null,2));
  else if(command==='request')console.log(JSON.stringify(store.requestRefresh()));
  else if(command==='import'){
    let input='';if(process.argv[3]&&process.argv[3]!=='-')input=await readFile(process.argv[3],'utf8');else for await(const chunk of process.stdin){input+=chunk;if(input.length>1000000)throw new Error('Import too large');}
    const result=store.importBatch(JSON.parse(input.replace(/^\uFEFF/,'')));
    console.log(JSON.stringify({ok:true,revision:result.revision,tasks:result.tasks.length,lastRefreshAt:result.lastRefreshAt}));
  }else if(command==='fail')console.log(JSON.stringify({refresh:store.failRefresh(process.argv[3],process.argv[4]).refresh}));
  else throw new Error('Use context, pending, request, import [file|-], or fail <id> <message>');
}catch(error){console.error(error.message);process.exitCode=1;}finally{store.close();}
