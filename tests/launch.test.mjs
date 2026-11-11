import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {serverRunning} from '../scripts/launch.mjs';
import {createServer} from '../src/server.mjs';
import {openStore} from '../src/store.mjs';

test('launcher readiness rejects unrelated services and accepts the dashboard',async()=>{
  const server=http.createServer((req,res)=>{res.end(JSON.stringify({tasks:[]}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  try{assert.equal(await serverRunning(url),false);}
  finally{await new Promise(resolve=>server.close(resolve));}
  assert.equal(await serverRunning(url),false);
  const store=openStore(':memory:');
  const dashboard=createServer(store);
  await new Promise(resolve=>dashboard.listen(0,'127.0.0.1',resolve));
  const address='http://127.0.0.1:'+dashboard.address().port;
  try{
    assert.equal(await serverRunning(address),true);
    const response=await fetch(address+'/api/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(response.status,503);
    assert.equal(store.snapshot().refresh,null);
    assert.equal((await (await fetch(address+'/api/state')).json()).workerEnabled,false);
    assert.equal((await fetch(address+'/config.json')).status,404);
    assert.equal((await fetch(address+'/active-tasks.json')).status,404);
    const status=await new Promise((resolve,reject)=>{
      http.get(address+'/api/state',{headers:{Host:'evil.example:4173'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);
    });
    assert.equal(status,403);
  }finally{await new Promise(resolve=>dashboard.close(resolve));store.close();}
});
