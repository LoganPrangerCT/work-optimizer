import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const url='http://127.0.0.1:4173';
export async function serverRunning(address=url){
  try{
    const response=await fetch(address+'/api/state',{signal:AbortSignal.timeout(1000)});
    const state=await response.json();
    return response.ok&&Array.isArray(state.tasks)&&Array.isArray(state.sources)&&typeof state.revision==='number';
  }catch{return false;}
}
async function main(){
  let child;
  if(!await serverRunning()){
    child=spawn(process.execPath,['src/server.mjs'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,PORT:'4173'},stdio:'inherit',windowsHide:true});
    child.on('error',error=>{console.error(error.message);process.exitCode=1;});
    let ready=false;
    for(let i=0;i<60;i++){
      if(child.exitCode!==null||process.exitCode)break;
      if(await serverRunning()){ready=true;break;}
      await delay(500);
    }
    if(!ready){child.kill();throw Error('Server did not become ready on port 4173. Check Node.js and whether the port is occupied.');}
  }
  const browser=spawn('explorer.exe',[url],{stdio:'ignore',windowsHide:true});
  browser.on('error',()=>console.error('Open '+url+' in your browser.'));
  if(child){
    console.log('Keep this window open. Press Ctrl+C to stop the app.');
    process.on('SIGINT',()=>child.kill());
    child.on('exit',code=>{process.exitCode=code??0;});
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
