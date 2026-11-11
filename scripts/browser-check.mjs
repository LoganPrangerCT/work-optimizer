import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {openStore} from '../src/store.mjs';
import {createServer} from '../src/server.mjs';

// Optional browser checks use the integration's existing dependency, never personal task files.
export async function runBrowserChecks({origin,store,screenshotDir,browserOrigin=origin,screenshotPrefix='round-3'}={}){
  const {chromium}=await import('../blackboard-mcp/node_modules/playwright/index.mjs');
  const browser=await chromium.launch({channel:'msedge',headless:true});
  console.log('Headless Edge '+browser.version());
  const page=await browser.newPage({viewport:{width:1440,height:900},hasTouch:true});
  const fetchRoute=route=>route.fetch({url:route.request().url().replace(browserOrigin,origin),headers:{...route.request().headers(),host:new URL(origin).host,origin}});
  if(browserOrigin!==origin)await page.route(browserOrigin+'/**',async route=>{await route.fulfill({response:await fetchRoute(route)});});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const shot=async name=>{if(screenshotDir){mkdirSync(screenshotDir,{recursive:true});const path=screenshotDir+'/'+screenshotPrefix+'-'+name+'.png';await page.screenshot({path,fullPage:true});console.log('Screenshot: '+path);}};
  const fits=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const events=()=>store.db.prepare('SELECT count(*) n FROM events').get().n;
  const loseResponse=async pattern=>{
    await page.route(pattern,async route=>{const response=await fetchRoute(route);assert.equal(response.status(),200);console.log('Committed HTTP 200 before intentionally dropping '+route.request().method()+' response');await route.abort('failed');},{times:1});
  };
  try{
    await page.goto(browserOrigin);await page.locator('[data-card]').first().waitFor();await fits();await shot('desktop');
    for(const width of [390,320]){
      await page.setViewportSize({width,height:844});await fits();
      for(const view of ['queue','week','history']){
        const nav=page.locator('.sidebar [data-view="'+view+'"]');
        await nav.focus();await page.keyboard.press('Enter');
        assert.equal(await nav.getAttribute('aria-current'),'page');
        const box=await nav.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width&&box.y+box.height<844);
        assert.equal(await nav.evaluate(el=>el===document.activeElement),true);
      }
      await shot('mobile-'+width+'-navigation');await page.locator('.sidebar [data-view="queue"]').click();await shot('mobile-'+width);
      console.log('PASS '+width+'px: all three navigation controls visible and keyboard reachable; no horizontal overflow');
    }
    const draftId=await page.locator('[data-card]').first().getAttribute('data-card');
    await page.locator('[data-card]').first().press('Enter');await page.locator('#task-dialog').waitFor();await shot('detail-mobile');
    await page.locator('#actual-time').fill('37 min');
    for(const tab of ['source','time','overview']){
      await page.locator('[data-detail-tab="'+tab+'"]').click();
    }
    await page.locator('#detail-tab-overview').focus();await page.keyboard.press('End');await page.keyboard.press('Home');
    assert.equal(await page.locator('#actual-time').inputValue(),'37 min');
    ;
    // Changing detail panes must not silently accept a newer workspace revision.
    store.reorderTasks(store.snapshot().tasks.filter(t=>!t.completedAt).map(t=>t.id),store.snapshot().revision);
    await page.locator('#duration-form button').click();await page.locator('#reconcile-task').waitFor();
    await page.locator('#reconcile-task').click();await page.getByText(/Current state: active/).waitFor();
    await page.locator('#duration-form button').click();await page.locator('#task-dialog').waitFor({state:'hidden'});
    assert.equal(store.snapshot().tasks.find(t=>t.id===draftId).actual,37);
    console.log('PASS draft survives Source, Time history, Overview and keyboard tabs; stale revision rejected; completion records exactly 37 minutes');
    await page.locator('[data-card]').first().press('Enter');
    await page.locator('#actual-time').fill('not a duration');await page.locator('#duration-form button').click();await page.getByText('Enter 1 min–24 hours.').waitFor();await shot('validation-error');
    await page.locator('#task-dialog').press('Escape');
    await page.locator('#add-task').click();await page.locator('#new-title').fill('Browser recovery task');
    await loseResponse('**/api/tasks');await page.locator('#new-task-form button[type=submit]').click();
    await page.locator('#reconcile-add').waitFor();assert.equal(await page.locator('#new-title').inputValue(),'Browser recovery task');await shot('creation-response-lost');
    await page.locator('#reconcile-add').click();await page.getByText('Tasks reloaded. Your input is kept; retry uses the same task ID.').waitFor();
    await page.locator('#new-task-form button[type=submit]').click();await page.locator('#add-dialog').waitFor({state:'hidden'});
    assert.equal(store.snapshot().tasks.length,1);const id=store.snapshot().tasks[0].id;
    await page.locator('[data-card]').first().press('Enter');await page.locator('#actual-time').fill('31 min');
    // Stale revision recovery stays within the modal and retains both fields.
    store.addTask({id:'competing',title:'Another tab task',baseRevision:store.snapshot().revision});
    await page.locator('#duration-form button').click();await page.locator('#reconcile-task').waitFor();await shot('stale-dialog');
    await page.locator('#reconcile-task').click();await page.getByText(/Current state: active/).waitFor();
    assert.equal(await page.locator('#actual-time').inputValue(),'31 min');
    for(const minutes of [31,47]){
      const before=events();await page.locator('#actual-time').fill(minutes+' min');
      await loseResponse('**/api/tasks/*');await page.locator('#duration-form button').click();await page.locator('#reconcile-task').waitFor();
      assert.equal(store.snapshot().tasks.find(t=>t.id===id).actual,minutes);assert.equal(events(),before+1);
      await shot('time-'+minutes+'-response-lost');await page.locator('#reconcile-task').click();await page.getByText(/Current state: completed/).waitFor();
      assert.equal(await page.locator('#actual-time').inputValue(),minutes+' min');
      await page.locator('#duration-form button').click();await page.locator('#task-dialog').waitFor({state:'hidden'});assert.equal(events(),before+1);
      await page.locator('.sidebar [data-view="history"]').click();await page.locator('[data-card]').first().press('Enter');
    }
    await page.locator('#task-dialog').press('Escape');
    await shot('completed');
    const before=events();await loseResponse('**/api/tasks/*');await page.locator('[data-restore]').click();await page.locator('#reload-tasks').waitFor();
    await page.locator('#reload-tasks').click();await page.locator('[data-restore]').waitFor({state:'hidden'});
    assert.equal(events(),before+1);assert.equal(store.snapshot().tasks.find(t=>t.id===id).completedAt,null);assert.equal(store.snapshot().tasks.find(t=>t.id===id).actual,47);
    console.log('PASS committed response loss: create, complete, edit time, restore; one task identity and one event per operation; input retained');
    console.log('PASS stale modal reload preserves entered duration');
    await page.locator('.sidebar [data-view="queue"]').click();
    store.addTask({id:'long',title:'LongTitle'.repeat(32),context:'UnbrokenContext'.repeat(18),baseRevision:store.snapshot().revision});
    await page.reload();await page.getByText('LongTitle'.repeat(32),{exact:true}).waitFor();await fits();await shot('long-mobile');
    await page.getByText('LongTitle'.repeat(32),{exact:true}).click();await page.getByRole('tab',{name:'Source',exact:true}).click();await fits();await shot('long-source-mobile');
    await page.getByRole('button',{name:'Close details',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#task-dialog').isVisible(),false);
    const future=new Date(Date.now()+20*86400000).toISOString().slice(0,10);
    store.addTask({id:'hide-fixture',title:'Later deadline',due:future,baseRevision:store.snapshot().revision});
    await page.reload();
    const later=page.getByRole('button',{name:'Later deadline',exact:true});
    await later.click({button:'right'});
    const toggle=page.locator('#priority-toggle'),choices=page.locator('#priority-options');
    await toggle.hover();await page.waitForTimeout(220);
    assert.equal(await toggle.getAttribute('aria-expanded'),'true');
    assert.equal(await choices.locator('[data-set-priority]').count(),5);
    const boxes=await choices.locator('[data-set-priority]').evaluateAll(items=>items.map(item=>item.getBoundingClientRect().toJSON()));
    assert.ok(boxes.every(box=>Math.abs(box.y-boxes[0].y)<1));
    await page.getByRole('menuitem',{name:'Hide'}).hover();
    await page.getByRole('menuitem',{name:'Hide'}).click();
    await later.waitFor({state:'hidden'});
    await page.reload();
    await page.locator('[data-card]').first().waitFor();
    assert.equal(await later.count(),0);
    assert.ok(store.snapshot().tasks.some(task=>task.externalId==='hide-fixture'));
    console.log('PASS right-click hide persists across reload without deleting the task');
    assert.deepEqual(errors,[]);console.log('PASS long unbroken titles/context and native dialog keyboard close; no page errors');
  }finally{await browser.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const store=openStore(':memory:'),server=createServer(store);
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});await runBrowserChecks({origin:'http://127.0.0.1:'+server.address().port,store});}
  finally{await new Promise(resolve=>server.close(resolve));store.close();}
}
