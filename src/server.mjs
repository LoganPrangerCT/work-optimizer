import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {openStore} from './store.mjs';
import {createWorker} from './worker.mjs';
import {config} from './config.mjs';
import {spawn,execFile} from 'node:child_process';
const routes={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/model.js':'model.js'};
const project=fileURLToPath(new URL('..',import.meta.url));
const bbEnv=()=>({...process.env,BB_BASE_URL:config.bbBaseUrl,BB_SSO_ENTRY_URL:config.bbSsoEntryUrl});
function checkBlackboard(){
  return new Promise((resolve,reject)=>execFile(process.execPath,[fileURLToPath(new URL('../blackboard-mcp/dist/cli/status.js',import.meta.url))],{cwd:project,env:bbEnv(),windowsHide:true,timeout:120000},(error,stdout)=>{
    if(!error)return resolve(true);
    if(/^(No Blackboard session found|Blackboard session expired)/m.test(stdout))return resolve(false);
    reject(error);
  }));
}
export function createServer(store,worker=null,{spawnLogin=spawn,checkSession=checkBlackboard,autoExit=false,autoShutdown=autoExit,ttl=Number(process.env.WORK_OPTIMIZER_TTL||process.env.TTL||config.ttl)||60000,gracePeriod=4000,startupTimeout=60000,onShutdown=null}={}){
  let loginProcess=null, loginStatus='idle', loginError='';
  const activeClients=new Map();
  let hasHadClients=false, graceTimer=null, startupTimer=null, ttlInterval=null, isShuttingDown=false;

  async function shutdown(reason='Shutdown'){
    if(isShuttingDown)return;
    isShuttingDown=true;
    if(graceTimer)clearTimeout(graceTimer);
    if(startupTimer)clearTimeout(startupTimer);
    if(ttlInterval)clearInterval(ttlInterval);
    try{if(worker?.running)await worker.stop().catch(()=>{});}catch{}
    try{store?.close?.();}catch{}
    if(typeof onShutdown==='function'){try{onShutdown(reason);}catch{}}
    if(typeof server.closeAllConnections==='function')try{server.closeAllConnections();}catch{}
    server.close(()=>{if(autoExit)process.exit(0);});
    if(autoExit)setTimeout(()=>process.exit(0),1000).unref?.();
  }

  function registerHeartbeat(clientId){
    if(!clientId)return;
    hasHadClients=true;
    if(startupTimer){clearTimeout(startupTimer);startupTimer=null;}
    if(graceTimer){clearTimeout(graceTimer);graceTimer=null;}
    activeClients.set(clientId,Date.now());
  }

  function unregisterClient(clientId){
    if(!clientId)return;
    activeClients.delete(clientId);
    if(hasHadClients&&activeClients.size===0&&autoShutdown&&!graceTimer&&!isShuttingDown){
      graceTimer=setTimeout(()=>shutdown('No active tabs remaining'),gracePeriod);
      if(graceTimer.unref)graceTimer.unref();
    }
  }

  if(autoShutdown&&startupTimeout>0){
    startupTimer=setTimeout(()=>{
      if(!hasHadClients&&activeClients.size===0&&!isShuttingDown){
        shutdown('Startup timeout expired: no browser tab connected');
      }
    },startupTimeout);
    if(startupTimer.unref)startupTimer.unref();
  }

  if(autoShutdown&&ttl>0){
    const checkFrequency=Math.min(Math.max(50,Math.floor(ttl/4)),15000);
    ttlInterval=setInterval(()=>{
      const now=Date.now();
      for(const [id,lastSeen] of activeClients.entries()){
        if(now-lastSeen>ttl)activeClients.delete(id);
      }
      if(hasHadClients&&activeClients.size===0&&!graceTimer&&!isShuttingDown){
        shutdown('TTL expired: inactivity timeout reached');
      }
    },checkFrequency);
    if(ttlInterval.unref)ttlInterval.unref();
  }

  function startLogin(resumeRefresh=false){
    loginStatus='starting';loginError='';
    try{
      const child=spawnLogin(process.execPath,[fileURLToPath(new URL('../blackboard-mcp/dist/cli/login.js',import.meta.url))],{cwd:project,env:bbEnv(),windowsHide:true,stdio:['ignore','ignore','pipe']});
      loginProcess=child;loginStatus='pending';
      let stderr='';child.stderr?.on('data',chunk=>{stderr=(stderr+chunk).slice(-4096);});
      child.once('error',()=>{if(loginProcess===child){loginProcess=null;loginStatus='failed';loginError='Could not start Blackboard sign-in. Restart the app and try again.';}});
      child.once('close',code=>{if(loginProcess===child){loginProcess=null;loginStatus=code===0?'complete':'failed';if(code===0)store.recordSourceConnection('Blackboard','connected');if(code===0&&resumeRefresh){try{const request=store.requestRefresh();worker.launch(request);}catch{loginStatus='failed';loginError='Signed in, but refresh could not start. Try again.';}}if(code!==0)loginError=/MODULE_NOT_FOUND|Cannot find module/.test(stderr)?'Blackboard integration is missing. Run npm run setup:mcp in the project folder.':/BROWSER_PROFILE_BUSY/.test(stderr)?'Blackboard is already in use by another app. Close it and try again.':/BROWSER_NOT_INSTALLED/.test(stderr)?'Install Chrome or Edge, then try again.':'Sign-in could not open or did not complete. Try again.';}});
      return true;
    }catch{loginStatus='failed';loginError='Could not open Blackboard sign-in. Check that the Blackboard MCP is installed.';return false;}
  }
  const server = http.createServer(async(req,res)=>{
  const respond=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  const withStatus=state=>({...state,workerEnabled:!!worker,blackboardLogin:loginStatus,blackboardLoginError:loginError});
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  try{
    if(!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host||''))return respond(403,{error:'Localhost only'});
    const url=new URL(req.url,`http://${req.headers.host}`);
    if(req.method==='GET'&&url.pathname==='/api/state'){
      const clientId=url.searchParams.get('clientId');
      if(clientId)registerHeartbeat(clientId);
      return respond(200,withStatus(store.snapshot()));
    }
    if(req.method==='POST'&&url.pathname.startsWith('/api/')){
      if(req.headers.origin&&req.headers.origin!==url.origin)return respond(403,{error:'Cross-origin request denied'});
      const contentType=(req.headers['content-type']||'').toLowerCase();
      if(!contentType.startsWith('application/json'))return respond(415,{error:'JSON required'});
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>1000000)return respond(413,{error:'Request too large'});}
      let payload;try{payload=JSON.parse(body);}catch{return respond(400,{error:'Invalid JSON'});}
      if(url.pathname==='/api/heartbeat'){
        const clientId=payload?.clientId;
        const action=payload?.action||'heartbeat';
        if(action==='close'){
          unregisterClient(clientId);
          return respond(200,{status:'closing',activeClients:activeClients.size});
        }
        registerHeartbeat(clientId);
        return respond(200,{status:'ok',activeClients:activeClients.size,ttl});
      }
      if(url.pathname==='/api/blackboard-login'){
        if(worker?.running)return respond(409,{error:'Wait for the current refresh to finish before signing in.'});
        if(loginProcess)return respond(409,{error:'Blackboard sign-in is already open.'});
        if(loginStatus==='checking')return respond(409,{error:'Checking Blackboard sign-in.'});
        return startLogin()?respond(202,{status:loginStatus}):respond(503,{error:loginError});
      }
      if(url.pathname==='/api/refresh'){
        if(!worker)return respond(503,{error:'Refresh service unavailable. Restart the app.'});
        if(loginProcess||loginStatus==='checking')return respond(409,{error:'Finish Blackboard sign-in before refreshing.'});
        if(worker.running&&store.snapshot().refresh?.status!=='pending'){try{await worker.stop();}catch{return respond(503,{error:'Process cleanup failed. Stop the CLI process in Task Manager, then restart the server.'});}if(worker.running)return respond(409,{error:'Previous refresh is stopping. Retry shortly.'});}
        if(worker.running)return respond(409,{error:'A refresh is already running.'});
        loginStatus='checking';loginError='';
        Promise.resolve().then(()=>checkSession()).then(signedIn=>{
          if(!signedIn){store.recordSourceConnection('Blackboard','signed_out');startLogin(true);return;}
          store.recordSourceConnection('Blackboard','connected');loginStatus='idle';
          const request=store.requestRefresh();worker.launch(request);
        }).catch(()=>{loginStatus='failed';loginError='Could not check Blackboard sign-in. Check the connection and try again.';});
        return respond(202,{status:'checking'});
      }
      if(url.pathname==='/api/tasks')return respond(200,withStatus(store.addTask(payload)));
      if(url.pathname==='/api/import')return respond(200,store.importBatch(payload));
      if(url.pathname==='/api/reorder')return respond(200,withStatus(store.reorderTasks(payload.order,payload.baseRevision)));
      if(url.pathname==='/api/migrate')return respond(200,withStatus(store.migrateLegacy(payload)));
      const task=url.pathname.match(/^\/api\/tasks\/([^/]+)$/);if(task){if(!Number.isInteger(payload.baseRevision))return respond(400,{error:'baseRevision required; reload before updating this task'});return respond(200,withStatus(store.updateTask(decodeURIComponent(task[1]),payload.action,payload.actual??null,payload.baseRevision,payload.priority??null)));}
      return respond(404,{error:'Not found'});
    }
    const file=routes[url.pathname];if(req.method!=='GET'||!file)return respond(404,{error:'Not found'});
    const body=await readFile(new URL('../public/'+file,import.meta.url));res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript');res.end(body);
  }catch(error){respond(error.status||500,{error:error.status?error.message:'Server error',...(error.committed?{committed:true}: {})});}
});
  server.activeClients=activeClients;
  server.shutdown=shutdown;
  server.registerHeartbeat=registerHeartbeat;
  server.unregisterClient=unregisterClient;
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const store=openStore();
  const {refresh}=store.snapshot();
  if(refresh?.status==='pending')store.failRefresh(refresh.id,'Previous refresh interrupted. Retry.');
  const noAutoExit=process.argv.includes('--no-auto-exit')||process.env.AUTO_EXIT==='false'||process.env.WORK_OPTIMIZER_AUTO_EXIT==='false';
  const ttlArg=process.argv.find(arg=>arg.startsWith('--ttl='));
  const parsedTtl=ttlArg?Number(ttlArg.split('=')[1]):undefined;
  const ttl=(parsedTtl!==undefined&&!isNaN(parsedTtl))?parsedTtl:(Number(process.env.WORK_OPTIMIZER_TTL||process.env.TTL||config.ttl)||60000);
  const server=createServer(store,createWorker(store),{autoExit:!noAutoExit,ttl});
  server.listen(Number(process.env.PORT)||4173,'127.0.0.1',()=>{console.log(`Dashboard: http://127.0.0.1:${server.address().port}`);});
}
