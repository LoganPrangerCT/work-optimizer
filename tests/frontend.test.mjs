import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseDuration,duration} from '../public/model.js';

function frontend(fetch=async()=>{throw Error("Unexpected request");}){
  const elements=new Map();
  const document={body:{classList:{toggle(){},remove(){}}},
    querySelector(selector){
      if(!elements.has(selector))elements.set(selector,{
        children:[],writes:0,markup:'',focus(){},classList:{toggle(){},add(){},remove(){}},setAttribute(){},addEventListener(){},
        set innerHTML(value){this.markup=value;this.writes++;},get innerHTML(){return this.markup;}
      });
      return elements.get(selector);
    },
    querySelectorAll(){return [];},addEventListener(){}
  };
  const context=vm.createContext({document,Intl,Date,Map,Set,WeakMap,AbortController,setTimeout:()=>1,clearTimeout(){},parseDuration,duration,fetch,window:{addEventListener(){}},matchMedia:()=>({matches:true})});
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8')
    .replace(/^import .*?;\r?\n/,'').replace(/start\(\);\s*$/,'');
  vm.runInContext(source,context);
  return {elements,run:code=>vm.runInContext(code,context)};
}

test('unchanged render preserves task and calendar controls across background updates',()=>{
  const {elements,run}=frontend();
  run("state={tasks:[],sources:[],mode:'demo'};render();render();");
  for(const selector of ['#task-list','#calendar','#sources','#agenda-list']){
    assert.equal(elements.get(selector).writes,1,selector+' should not replace its DOM on an unchanged poll');
  }
  run("setMarkup('#task-list','changed');setMarkup('#task-list','changed');");
  assert.equal(elements.get('#task-list').writes,2);
});

test('calendar keeps due counts, escaping and selection when changing months',()=>{
  const {elements,run}=frontend();
  run("year=2026;month=10;selectedDate='2026-11-03';renderCalendar([{due:'2026-11-03',title:'A < B',source:'Gmail',id:'one',estimate:5},{due:'2026-11-03',title:'Second',source:'Gmail',id:'two'},{due:null}]);");
  assert.match(elements.get('#calendar').innerHTML,/November 3, 2026, 2 tasks due/);
  assert.match(elements.get('#calendar').innerHTML,/data-date="2026-11-03"[^>]*aria-pressed="true"/);
  assert.match(elements.get('#agenda-list').innerHTML,/A &lt; B/);
  assert.equal(elements.get('#agenda-count').textContent,2);
  run('month=11;renderCalendar([]);');
  assert.equal(elements.get('#month-label').textContent,'December 2026');
  assert.doesNotMatch(elements.get('#calendar').innerHTML,/tasks due/);
});

test('filtered reordering preserves hidden slots and completed history',()=>{
  const {run}=frontend();
  const result=run("tasksInVisibleOrder([{id:'a'},{id:'hidden'},{id:'done',completedAt:'2026-11-01'},{id:'b'},{id:'last'}],['b','a']).map(task=>task.id)");
  assert.deepEqual(Array.from(result),['b','hidden','done','a','last']);
});

test('reviewed priorities remain independent of effort and unrated tasks stay neutral',()=>{
  const {run}=frontend();
  assert.equal(run("priorityOf({priority:5,estimate:5,due:'2026-11-03'})"),5);
  assert.equal(run("priorityOf({priority:4,estimate:240,due:'2026-11-09'})"),4);
  for(const value of ['null','0','6','2.5',"'5'"]){
    assert.equal(run(`priorityOf({priority:${value},estimate:480})`),0);
  }
  assert.equal(run('priorityOf({estimate:480})'),0);
  assert.match(run("card({id:'a',title:'A',source:'Gmail',reason:'Act now',priority:5},0,2)"),/priority-5/);
  assert.match(run("card({id:'a',title:'A',source:'Gmail'},0,2)"),/>Unrated</);
  assert.doesNotMatch(run("card({id:'a',title:'A',source:'Gmail',completedAt:'2026-11-01',actual:null},0,1)"),/data-drag|data-move/);
});

test('saving filtered order sends every active ID and revision, then shows manual ranking',async()=>{
  const calls=[];
  const saved={tasks:[{id:'b',source:'Gmail',priority:5},{id:'hidden',source:'Outlook'},{id:'a',source:'Gmail'}],sources:[],mode:'live',revision:8,ranking:{reviewer:'Manual order',summary:'Until next refresh',reviewedAt:'2026-11-03T12:00:00Z'}};
  const {elements,run}=frontend(async(path,options)=>{
    calls.push({path,body:JSON.parse(options.body)});
    return {ok:true,json:async()=>saved};
  });
  run("state={tasks:[{id:'a',source:'Gmail'},{id:'hidden',source:'Outlook'},{id:'b',source:'Gmail'}],sources:[],mode:'live',revision:7};source='Gmail';");
  await run("saveOrder(['b','a'],'b')");
  assert.deepEqual(calls,[{path:'/api/reorder',body:{order:['b','hidden','a'],baseRevision:7}}]);
  assert.equal(run('reordering'),false);
  assert.equal(elements.get('#ranking-status').textContent,'Manual order · until next refresh');
  assert.equal(run('state.revision'),8);
});

test('a rejected reorder restores the server order and tells the user it was not saved',async()=>{
  const initial={tasks:[{id:'a',source:'Gmail'},{id:'b',source:'Gmail'}],sources:[],mode:'live',revision:1};
  const {elements,run}=frontend(async(path)=>path==='/api/reorder'
    ?{ok:false,json:async()=>({error:'Workspace changed. Try again.'})}
    :{ok:true,json:async()=>initial});
  run(`state=${JSON.stringify(initial)};`);
  await run("saveOrder(['b','a'],'b')");
  assert.deepEqual(Array.from(run('active().map(task=>task.id)')),['a','b']);
  assert.equal(run('reordering'),false);
  assert.match(elements.get('#toast').textContent,/Order not saved: Workspace changed/);
});

test('pending refresh blocks moves and in-flight polls cannot overwrite an active drag',async()=>{
  let posts=0;
  const {run}=frontend(async(path,options)=>{
    if(options.method)posts++;
    return {ok:true,json:async()=>({tasks:[{id:'new'}],sources:[],mode:'live'})};
  });
  run("state={tasks:[{id:'a'},{id:'b'}],sources:[],refresh:{status:'pending'}};moveTask('a',1);");
  assert.equal(posts,0);
  assert.deepEqual(Array.from(run('active().map(task=>task.id)')),['a','b']);
  run("dragging={id:'a'};");
  await run('load()');
  assert.deepEqual(Array.from(run('active().map(task=>task.id)')),['a','b']);
});

test('search, course, effort, criticality and deadline scopes compose without reordering results',()=>{
 const {run}=frontend();
 run("state.tasks=[{id:'a',title:'Proposal',source:'Blackboard',context:'Security. More',priority:4,estimate:240,due:today()},{id:'b',title:'Module',source:'Blackboard',context:'Cloud',priority:3,estimate:5,due:weekEnd()},{id:'c',title:'Old',source:'Gmail',priority:5,estimate:45,due:'2000-01-01'}];");
 run("search='proposal';course='Security';effort='deep';selectedPriority=4;");
 assert.deepEqual(Array.from(run('filtered().map(t=>t.id)')),['a']);
 run("clearFilters();scope='quick';");assert.deepEqual(Array.from(run('filtered().map(t=>t.id)')),['b']);
 run("effort='deep';");assert.deepEqual(Array.from(run('filtered().map(t=>t.id)')),[]);
 run("clearFilters();effort='quick';");assert.deepEqual(Array.from(run('filtered().map(t=>t.id)')),['b']);
 run("clearFilters();scope='overdue';");assert.deepEqual(Array.from(run('filtered().map(t=>t.id)')),['c']);
 run("clearFilters();view='week';");assert.deepEqual(Array.from(run('filtered().map(t=>t.id)')),['a','b']);
 run("clearFilters();view='focus';preferences.focusId='b';");assert.deepEqual(Array.from(run('filtered().map(t=>t.id)')),['b']);
});

test('due summary renders the filtered queue directly',()=>{
 const {elements,run}=frontend();
 run("state.tasks=[{id:'today',title:'Due now',source:'Manual',due:today()},{id:'later',title:'Due later',source:'Manual',due:weekEnd()}];view='history';render();");
 const list=elements.get('#task-list'),writes=list.writes;
 run("$('#due-summary').onclick();");
 assert.equal(list.writes,writes+1);
 assert.match(list.innerHTML,/data-card="today"/);
 assert.doesNotMatch(list.innerHTML,/data-card="later"/);
});

test('CSV export quotes text safely and keeps numerical durations numeric',()=>{
 const {run}=frontend();
 for(const value of ['=1+1','+SUM(A1)','-cmd','@SUM(A1)','\tformula','\rformula','  =HYPERLINK("bad")']){
  assert.match(run(`csvCell(${JSON.stringify(value)})`),/^"'/);
 }
 assert.equal(run('csvCell(45)'),'45');
 assert.equal(run('csvCell(-5)'),'-5');
 assert.equal(run('csvCell(\'A "quote", B\')'),'"A ""quote"", B"');
});

test('cards use whole-card focus and criticality, without numbering or right-side controls',()=>{
 const {run}=frontend(),markup=run("card({id:'a',title:'Proposal',source:'Gmail',priority:4,estimate:240,due:'2026-11-09'})");
 assert.match(markup,/<button class="task-title-link" data-open="a">Proposal<\/button>/);assert.match(markup,/tabindex="0"/);assert.match(markup,/task-estimate/);assert.match(markup,/task-due/);
 assert.doesNotMatch(markup,/class="rank"|data-drag|data-move|task-arrow|task-open/);
});

test('task form retains the revision displayed when opened and shows rejected stale edits',async()=>{
 const calls=[];
 const {elements,run}=frontend(async(path,options)=>{
  calls.push({path,body:JSON.parse(options.body)});
  return {ok:false,json:async()=>({error:'Workspace changed; reload before updating this task'})};
 });
 run("state={tasks:[{id:'a',title:'Task',source:'Gmail',actual:30}],sources:[],revision:7};detailId='a';renderDetails();");
 run("$('#actual-time').value='45 min';");
 // A background poll must not silently rebase a form containing older task data.
 run('state.revision=8;');
 await elements.get('#duration-form').onsubmit({preventDefault(){}});
 assert.deepEqual(calls,[{path:'/api/tasks/a',body:{action:'complete',actual:45,baseRevision:7}}]);
 assert.match(elements.get('#duration-error').textContent,/Workspace changed/);
 assert.equal(elements.get('#duration-form button').disabled,false);
 assert.equal(run('state.revision'),8);
});

test('storage refusal never announces persisted focus',()=>{
 const {elements,run}=frontend();
 run("setFocus('a')");assert.match(elements.get('#toast').textContent,/Could not save/);
});

test('empty queue and focus expose actions and detail tabs use one keyboard tab stop',()=>{
 const {elements,run}=frontend();
 run("state={tasks:[],sources:[],mode:'live',workerEnabled:false};render();");
 assert.match(elements.get('#task-list').innerHTML,/data-add-task/);
 run("view='focus';render();");assert.match(elements.get('#task-list').innerHTML,/data-view="queue"/);
 run("state.tasks=[{id:'a',title:'Task',source:'Manual'}];detailId='a';detailTab='source';renderDetails();");
 const markup=elements.get('#detail-content').innerHTML;
 assert.equal((markup.match(/tabindex="0"/g)||[]).length,1);
 assert.match(markup,/id="detail-tab-source"[^>]*tabindex="0"[^>]*aria-selected="true"/);
 assert.match(markup,/role="tabpanel" aria-labelledby="detail-tab-source"/);
});
test('refresh remains available without an automatic schedule',()=>{
 const {elements,run}=frontend();run("dataUnavailable=false;state={tasks:[],sources:[],mode:'live',workerEnabled:true};render();");
 assert.equal(elements.get('#refresh-button').disabled,false);
});


test('priority edit preserves task draft and advances its revision',async()=>{
 const {run}=frontend(async()=>({ok:true,json:async()=>({tasks:[{id:'a',title:'Task',source:'Manual',priority:5}],sources:[],revision:8})}));
 run("state={tasks:[{id:'a',title:'Task',source:'Manual'}],sources:[],revision:7};detailId='a';renderDetails();detailDraft.actual='45 min';$('#task-dialog').open=true;");
 await run("setTaskPriority('a',5)");assert.equal(run('detailDraft.revision'),8);assert.equal(run('detailDraft.actual'),'45 min');
});


test('load failure remains visible with an actionable retry',async()=>{
 const {elements,run}=frontend(async()=>({ok:false,json:async()=>({error:'active-tasks.json: invalid JSON'})}));
 await assert.rejects(run('load()'),/active-tasks.json/);assert.equal(elements.get('#load-error').hidden,false);assert.match(elements.get('#load-error').textContent,/active-tasks.json.*Reload tasks/);assert.equal(elements.get('#reload-tasks').hidden,false);
});

test('a hidden task stays stored and returns exactly ten calendar days before its due date',()=>{
 const {run}=frontend();
 run("state={tasks:[{id:'a',due:'2026-11-20'},{id:'b',due:'2026-11-21'}],sources:[]};preferences.hiddenTasks={a:true};");
 assert.equal(run("hideUntil(state.tasks[0])"),'2026-11-10');
 assert.deepEqual(Array.from(run("active().map(t=>t.id)")),['a','b']);
 assert.deepEqual(Array.from(run("visibleActive('2026-11-09').map(t=>t.id)")),['b']);
 assert.deepEqual(Array.from(run("visibleActive('2026-11-10').map(t=>t.id)")),['a','b']);
});

test('refresh keeps hidden Blackboard work out of the queue after submission status changes',async()=>{
 const due=new Date(Date.now()+20*86400000).toISOString().slice(0,10);
 const task={id:'hidden-bb',title:'Hidden assignment',source:'Blackboard',due};
 const snapshot={tasks:[task],sources:[],mode:'live'};
 const {elements,run}=frontend(async path=>({
  ok:true,json:async()=>path==='/api/state'?snapshot:{status:'pending'},
 }));
 run(`state=${JSON.stringify(snapshot)};preferences.hiddenTasks={'hidden-bb':true};render();`);
 for(const submissionStatus of ['not_submitted','in_progress']){
  snapshot.tasks=[{...task,submissionStatus}];
  await run('refresh()');
  assert.equal(run('state.tasks[0].submissionStatus'),submissionStatus);
  assert.doesNotMatch(elements.get('#task-list').innerHTML,/data-card="hidden-bb"/);
  assert.match(elements.get('#task-list').innerHTML,/hidden until 10 days/);
 }
});



test('legacy hidden preference migrates to a server task flag',async()=>{
 const calls=[];const {run}=frontend(async(path,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({revision:2,tasks:[{id:'a',hidden:true,due:'2030-01-01'}],sources:[]})};});
 run("state={revision:1,tasks:[{id:'a',due:'2030-01-01'}],sources:[]};preferences.hiddenTasks={a:true};savePreferences=()=>true;");
 await run('migrateHiddenTasks()');
 assert.equal(calls[0].action,'hide');assert.equal(run('state.tasks[0].hidden'),true);assert.equal(run('preferences.hiddenTasks.a'),undefined);
});


test('source indicators expose status without a banner',()=>{
 const {elements,run}=frontend();
 run("state={tasks:[],mode:'live',refresh:{status:'complete'},sources:[{source:'Gmail',status:'reviewed',note:'Connected'},{source:'Blackboard',status:'blocked',note:'Sign in again'},{source:'Outlook',status:'error',note:'Unavailable'}]};render();");
 const sources=elements.get('#sources').innerHTML;assert.match(sources,/status-dot reviewed/);assert.match(sources,/status-dot blocked/);assert.match(sources,/Outlook: Check failed/);assert.match(sources,/Sign in again/);
 run("state.refresh={status:'failed',error:'CLI failed'};render();");assert.match(elements.get('#sync-feedback').textContent,/CLI failed/);
});
