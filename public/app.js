import {parseDuration,duration} from './model.js';
const $=selector=>document.querySelector(selector);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const easternDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}),localDate=new Intl.DateTimeFormat('en-CA'),shortDate=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric'}),fullDate=new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}),monthDate=new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric'}),timeFormat=new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit'});
const today=()=>easternDate.format(new Date()),clock=iso=>timeFormat.format(new Date(iso));
const renderedMarkup=new WeakMap();
function setMarkup(selector,markup){const element=$(selector);if(renderedMarkup.get(element)===markup)return;element.innerHTML=markup;renderedMarkup.set(element,markup);}
function readPreferences(){try{return JSON.parse(localStorage.getItem('work-optimizer-ui-v1')||'{}')||{};}catch{return {};}}
let preferences=readPreferences();
function savePreferences(){try{localStorage.setItem('work-optimizer-ui-v1',JSON.stringify(preferences));return true;}catch{notify('Could not save on this device. Your changes are temporary; allow browser storage and retry.');return false;}}
let dataUnavailable=true;
let state={tasks:[],sources:[],mode:'demo'},view='queue',scope='all',selectedDate=null,source='All sources',course='',effort='all',search='',selectedPriority=null;
let month=new Date().getMonth(),year=new Date().getFullYear(),toastTimer,pollTimer,busy=false,requestError=null,reordering=false,dragging=null,loadVersion=0,suppressClickUntil=0,detailId=null,detailTab='overview';
const active=()=>state.tasks.filter(task=>!task.completedAt),completed=()=>state.tasks.filter(task=>task.completedAt).sort((a,b)=>b.completedAt.localeCompare(a.completedAt));
function hideUntil(task){
 if(!task?.due||task.completedAt)return null;
 const deadline=Date.parse(task.due);
 return Number.isFinite(deadline)?new Date(deadline-10*86400000).toISOString().slice(0,10):null;
}
const visibleActive=(date=today())=>active().filter(task=>!(task.hidden||preferences.hiddenTasks?.[task.id])||!(hideUntil(task)>date));
const PRIORITY_LABELS={0:'Unrated',1:'Minor',2:'Low',3:'Standard',4:'High',5:'Critical'};
const priorityOf=task=>Number.isInteger(task.priority)&&task.priority>=1&&task.priority<=5?task.priority:0;
const priorityLabel=p=>p?`P${p} · ${PRIORITY_LABELS[p]}`:'Unrated · awaiting review';
const contextOf=task=>(task.context||task.from||'').split(/\.\s|\n/)[0];
const totalEstimate=tasks=>tasks.reduce((sum,task)=>sum+(task.estimate||0),0);
const weekEnd=(start=today())=>{const date=new Date(start+'T12:00:00');date.setDate(date.getDate()+6);return localDate.format(date);};
const inWeek=(task,start,end)=>task.due&&task.due>=start&&task.due<=end;
function filtered(date=today(),end=weekEnd(date),tasks=view==='history'?completed():visibleActive(date)){
 const query=search.toLowerCase(),quick=scope==='quick'||effort==='quick';
 return tasks.filter(task=>
  (view!=='focus'||task.id===preferences.focusId)&&
  (view!=='week'||inWeek(task,date,end))&&
  (!selectedDate||task.due===selectedDate)&&
  (source==='All sources'||task.source===source)&&
  (!course||contextOf(task)===course)&&
  (!selectedPriority||priorityOf(task)===selectedPriority)&&
  (scope!=='today'||task.due===date)&&
  (scope!=='overdue'||task.due&&task.due<date)&&
  (!quick||task.estimate&&task.estimate<=15)&&
  (effort!=='hour'||task.estimate&&task.estimate<=60)&&
  (effort!=='deep'||task.estimate>60)&&
  (effort!=='unknown'||!task.estimate)&&
  (!query||[task.title,task.context,task.source,task.reason,task.from].join(' ').toLowerCase().includes(query)));
}
const sourceStatusLabel=status=>({reviewed:'Reviewed',partial:'Partially reviewed',blocked:'Access blocked',error:'Check failed',not_checked:'Not checked'})[status]||'Not checked';
const sourceIcons={Blackboard:'Bb',Outlook:'O',Gmail:'M',Teams:'T'};
const icon=name=>`<span class="source-icon ${escape(name.toLowerCase())}" aria-hidden="true">${sourceIcons[name]||'·'}</span>`;
function dateLabel(date){if(!date)return 'No due date';if(date===today())return 'Today';const next=new Date(today()+'T12:00:00');next.setDate(next.getDate()+1);return date===localDate.format(next)?'Tomorrow':shortDate.format(new Date(date+'T12:00:00'));}
const dueDetails=task=>task.due?`${fullDate.format(new Date(task.due+'T12:00:00'))}${task.time?' · '+task.time:' · Due time unspecified'}`:'No verified due date';
function notify(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4000);}
async function api(path,data){
 const controller=new AbortController();let timer;
 try{
  return await Promise.race([(async()=>{const response=await fetch(path,{signal:controller.signal,...(data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Request failed');return result;})(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Request timed out. Reload tasks to check whether the change saved, then retry.'));},10000);})]);
 }catch(error){$('#reload-tasks').hidden=false;if(error instanceof TypeError)throw new Error('Cannot reach the local server. Start it, then reload tasks and retry.');throw error;}finally{clearTimeout(timer);}
}
async function load(){
 const version=++loadVersion;
 try{const next=await api('/api/state');if(version===loadVersion){dataUnavailable=false;document.body.classList.remove('loading');$('#reload-tasks').hidden=true;$('#load-error').hidden=true;if(!dragging&&!reordering){state=next;render();}}schedulePoll();}
 catch(error){if(version===loadVersion){dataUnavailable=true;$('#refresh-button').disabled=true;$('#reload-tasks').hidden=false;$('#load-error').textContent='Tasks could not load: '+error.message+' Fix the issue, then select Reload tasks.';$('#load-error').hidden=false;}throw error;}
}
function schedulePoll(){clearTimeout(pollTimer);pollTimer=setTimeout(async()=>{try{await load();await migrateHiddenTasks();}catch(error){$('#sync-feedback').textContent=error.message;schedulePoll();}},state.blackboardLogin==='pending'?2000:state.refresh?.status==='pending'?4000:30000);}
function refreshStatus(){const pending=state.refresh?.status==='pending';$('#refresh-button').disabled=dataUnavailable||state.workerEnabled===false||busy||pending||state.blackboardLogin==='pending'||reordering||!!dragging;$('#refresh-button').textContent=busy?'↻ Starting…':pending?'↻ Refreshing…':'↻ Refresh';const last=state.lastRefreshAt?'Updated '+clock(state.lastRefreshAt):'Not refreshed';$('#sync-feedback').textContent=requestError||(state.workerEnabled===false?'Restart the app to enable refresh':state.blackboardLogin==='pending'?'Finish Blackboard sign-in':pending?'AI refresh running':state.refresh?.error?`${state.refresh.status==='failed'?'Refresh failed':'Attention'} · ${state.refresh.error}`:last);;}
const canReorder=()=>!['history','insights'].includes(view)&&!busy&&!reordering&&state.refresh?.status!=='pending';
function card(task){
 const done=!!task.completedAt,p=priorityOf(task);
 return `<article class="task-card priority-${p}" data-card="${escape(task.id)}" tabindex="0" aria-label="${escape(task.title)}. ${priorityLabel(p)}. ${task.estimate?duration(task.estimate)+' estimated. ':''}${escape(dueDetails(task))}" ${!done?'aria-describedby="queue-help"':''}>
 ${done?'<span class="completed-mark" aria-label="Completed">✓</span>':`<input type="checkbox" class="complete-check" aria-label="Complete ${escape(task.title)}" data-complete="${escape(task.id)}">`}
 <div class="card-body"><div class="card-heading"><h3><button class="task-title-link" data-open="${escape(task.id)}">${escape(task.title)}</button></h3><span class="priority-tag p${p}" tabindex="0" aria-label="${escape(priorityLabel(p)+'. '+(task.reason||''))}">${p?'P'+p:'Unrated'}<span class="priority-tooltip" role="tooltip">${escape(priorityLabel(p))}<br>${escape(task.reason||'Awaiting reviewed priority.')}</span></span></div>
 ${contextOf(task)?`<button class="task-context" data-course="${escape(contextOf(task))}" title="Filter by ${escape(contextOf(task))}">${escape(contextOf(task))}</button>`:''}
 <div class="task-metrics"><span class="task-estimate" title="Estimated work time; separate from action priority"><span aria-hidden="true">◷</span> ${task.estimate?duration(task.estimate):'Estimate pending'}<small>${task.estimate?'estimated':''}</small></span><span class="task-due ${task.due&&task.due<today()&&!done?'overdue':task.due===today()?'due-today':''}" title="${escape(dueDetails(task))}"><span aria-hidden="true">▦</span> ${task.due&&task.due<today()&&!done?'Overdue · ':''}${escape(dateLabel(task.due))}${task.time?`<small>${escape(task.time)}</small>`:''}</span></div>
 <div class="task-footer"><span class="card-source">${icon(task.source)}${escape(task.source)}</span>${done?`<span class="actual-summary">${task.actual==null?'Time not logged':duration(task.actual)+' actual'} · ${shortDate.format(new Date(task.completedAt))}</span><button class="restore-button" data-restore="${escape(task.id)}">Restore</button>`:''}${task.url?`<a href="${escape(task.url)}" target="_blank" rel="noopener noreferrer" class="card-source-link" title="Open the original source">Open source ↗</a>`:''}</div>
 </div></article>`;
}
function render(){
 const date=today(),end=weekEnd(date),tasks=visibleActive(date),history=completed(),due=tasks.filter(task=>task.due===date),list=filtered(date,end,view==='history'?history:tasks),titles={queue:'Priority queue',focus:'Focus',week:'Next 7 days',history:'Completed',insights:'Time insights'};
 $('#active-stat').textContent=tasks.length;$('#due-stat').textContent=due.length;$('#time-stat').textContent=duration(totalEstimate(tasks));$('#nav-count').textContent=tasks.length;$('#history-count').textContent=history.length;$('#today-count').textContent=due.length;$('#focus-count').textContent=tasks.some(task=>task.id===preferences.focusId)?1:0;$('#week-count').textContent=tasks.filter(task=>inWeek(task,date,end)).length;
 $('#page-title').textContent=titles[view];setMarkup('#queue-title',`Tasks <span>${view==='insights'?history.length:list.length}</span>`);
 document.querySelectorAll('[data-view]').forEach(button=>{button.classList.toggle('active',button.dataset.view===view);button.setAttribute('aria-current',button.dataset.view===view?'page':'false');});document.querySelectorAll('[data-scope]').forEach(button=>{button.classList.toggle('active',scope===button.dataset.scope);button.setAttribute('aria-pressed',String(scope===button.dataset.scope));});
 const insight=view==='insights';$('.queue-toolbar').hidden=insight||view==='focus';$('#filter-controls').hidden=insight||view==='focus';$('#priority-legend').hidden=insight||view==='focus';$('#task-list').hidden=insight;$('#insights').hidden=!insight;$('#focus-tools').hidden=view!=='focus';
 setMarkup('#priority-legend',[1,2,3,4,5].map(p=>`<button class="legend-item p${p}" data-priority="${p}" aria-pressed="${selectedPriority===p}" title="Filter ${priorityLabel(p)}; click again to clear"><i class="dot"></i>P${p} ${PRIORITY_LABELS[p]}</button>`).join(''));
 const sources=[...new Set([...state.sources.map(item=>item.source),...state.tasks.map(task=>task.source)])];setMarkup('#source-filter','<option>All sources</option>'+sources.map(name=>`<option>${escape(name)}</option>`).join(''));$('#source-filter').value=source;
 const courses=[...new Set(state.tasks.map(contextOf).filter(Boolean))].sort();setMarkup('#course-filter','<option value="">All courses</option>'+courses.map(name=>`<option value="${escape(name)}">${escape(name)}</option>`).join(''));$('#course-filter').value=course;$('#effort-filter').value=effort;
 $('#clear-search').hidden=!search;$('#results-summary').textContent=insight?`${history.length} completed · ${history.filter(task=>task.actual!=null).length} with logged time`:`${list.length} ${list.length===1?'task':'tasks'} · ${duration(totalEstimate(list))} estimated${list.some(task=>!task.estimate)?' + pending estimates':''}`;
 const hasFilters=!!(search||course||selectedDate||selectedPriority||source!=='All sources'||effort!=='all'||scope!=='all');$('#clear-filters').hidden=!hasFilters||insight||!list.length;
 setMarkup('#filter-note',hasFilters&&!insight?`<div class="filter-chip">${escape([selectedDate?'Due '+dateLabel(selectedDate):'',selectedPriority?priorityLabel(selectedPriority):'',course,source!=='All sources'?source:'',effort!=='all'?$('#effort-filter').selectedOptions?.[0]?.textContent||effort:'',search?'Search: '+search:'',({today:'Due today',overdue:'Overdue',quick:'Quick wins'})[scope]||''].filter(Boolean).join(' · '))}</div>`:'');
 $('#queue-help').hidden=insight||view==='history';$('#queue-help').textContent=state.refresh?.status==='pending'?'AI refresh in progress · reordering resumes when it finishes.':'Drag anywhere on a card · Alt + ↑ / ↓ when focused · touch: hold then move. Order lasts until the next AI refresh.';
 $('#task-list').setAttribute('aria-busy',String(reordering));setMarkup('#task-list',list.length?list.map(card).join(''):`<div class="empty-state">${view==='focus'?'Choose one task to focus on.':hasFilters?(scope==='today'?'No tasks due today.':scope==='overdue'?'No overdue tasks.':scope==='quick'?'No quick wins match.':'No tasks match these filters.'):view==='history'?'No completed tasks yet.':active().length&&!tasks.length?'Tasks are hidden until 10 days before they’re due.':'No active tasks. Capture your next step.'}${hasFilters?'<button class="text-button" data-clear-filters>Clear filters</button>':view==='focus'?'<button class="text-button" data-view="queue">Choose from your queue</button>':view!=='history'?'<button class="primary-button" data-add-task>+ Add task</button>':''}</div>`);
 setMarkup('#sources',state.sources.map(item=>`<button class="source-item" data-source-status="${escape(item.source)}" title="${escape(sourceStatusLabel(item.status)+': '+(item.note||'No details available.'))}" aria-label="${escape(item.source+': '+sourceStatusLabel(item.status))}">${icon(item.source)}<span>${escape(item.source)}</span><span class="source-status"><span class="status-dot ${escape(item.status)}" aria-hidden="true"></span></span></button>`).join(''));
 $('#current-date').textContent=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',timeZone:'America/New_York'}).toUpperCase();
 document.body.classList.toggle('compact',preferences.density==='compact');document.body.classList.toggle('reduce-motion',preferences.motion==='reduced');$('#density-toggle').setAttribute('aria-pressed',String(preferences.density==='compact'));$('#motion-toggle').setAttribute('aria-pressed',String(preferences.motion==='reduced'));$('#density-toggle').textContent=preferences.density==='compact'?'Comfortable':'Compact';$('#motion-toggle').textContent=preferences.motion==='reduced'?'Motion off':'Motion on';
 $('#ranking-status').textContent=reordering?'Saving order…':state.ranking?.reviewer==='Task files'?'Task file order · until next refresh':state.ranking?.reviewer==='Manual order'?'Manual order · until next refresh':state.mode==='demo'?'Sample order':state.ranking?`AI reviewed ${clock(state.ranking.reviewedAt)}`:'Awaiting review';$('#ranking-status').title=state.ranking?.summary||'';
 refreshStatus();if($('#status-dialog').open&&$('#status-title')?.textContent==='Blackboard'&&shownLoginStatus!==state.blackboardLogin)openStatus('Blackboard');renderCalendar(tasks,date);if(insight)renderInsights(history);
}
function renderCalendar(tasks,currentDate=today()){
 const dates=new Map();for(const task of tasks)if(task.due){if(!dates.has(task.due))dates.set(task.due,[]);dates.get(task.due).push(task);}
 $('#month-label').textContent=monthDate.format(new Date(year,month,1));const offset=(new Date(year,month,1).getDay()+6)%7,count=new Date(year,month+1,0).getDate(),cells=Math.ceil((offset+count)/7)*7;
 setMarkup('#calendar',Array.from({length:cells},(_,index)=>{const date=new Date(year,month,index-offset+1),iso=localDate.format(date),due=dates.get(iso)||[],p=Math.max(0,...due.map(priorityOf)),label=`${fullDate.format(date)}${due.length?`, ${due.length} tasks due, ${duration(totalEstimate(due))} estimated, highest ${priorityLabel(p)}`:', no deadlines'}`;return `<button data-date="${iso}" class="priority-${p} ${date.getMonth()!==month?'outside ':''}${iso===currentDate?'today ':''}${iso===selectedDate?'selected':''}" aria-label="${escape(label)}" title="${escape(label)}" aria-pressed="${iso===selectedDate}">${date.getDate()}${due.length?'<i></i>':''}</button>`;}).join(''));
 const date=selectedDate||currentDate,agenda=dates.get(date)||[];$('#agenda-title').textContent=date===currentDate?'Due today':`Due ${dateLabel(date)}`;$('#agenda-count').textContent=agenda.length;$('#agenda-workload').textContent=agenda.length?`${duration(totalEstimate(agenda))} estimated${agenda.some(task=>!task.estimate)?' + pending estimates':''}`:'';
 setMarkup('#agenda-list',agenda.map(task=>`<div class="agenda-item"><span class="agenda-line priority-${priorityOf(task)}"></span><button data-open="${escape(task.id)}"><time>${escape(task.time||'Time unspecified')}</time>${escape(task.title)}<small>${escape(contextOf(task)||task.source)}${task.estimate?' · '+duration(task.estimate):''}</small></button></div>`).join('')||'<p class="help-text">No deadlines.</p>');$('#clear-date').hidden=!selectedDate;
}
function renderInsights(history){
 const logged=history.filter(task=>task.actual!=null),paired=logged.filter(task=>task.estimate),actual=logged.reduce((n,task)=>n+task.actual,0),estimated=totalEstimate(paired),pairedActual=paired.reduce((n,task)=>n+task.actual,0);
 setMarkup('#insights',`<div class="insight-stats"><div><b>${duration(actual)}</b><span>logged across ${logged.length} tasks</span></div><div><b>${logged.length?duration(Math.round(actual/logged.length)):'—'}</b><span>average logged task</span></div><div><b>${paired.length?duration(Math.abs(pairedActual-estimated)):'—'}</b><span>${paired.length?`${pairedActual>estimated?'over':'under'} estimate across ${paired.length} tasks`:'No comparable estimates yet'}</span></div></div><h3 class="insight-heading">Completed work</h3>${history.length?`<div class="insight-table"><table><thead><tr><th>Task</th><th>Estimate</th><th>Actual</th><th>Difference</th></tr></thead><tbody>${history.map(task=>`<tr><td><button data-open="${escape(task.id)}">${escape(task.title)}</button><small>${escape(contextOf(task)||task.source)}</small></td><td>${task.estimate?duration(task.estimate):'—'}</td><td>${task.actual!=null?duration(task.actual):'Not logged'}</td><td>${task.actual!=null&&task.estimate?(task.actual>task.estimate?'+':'−')+duration(Math.abs(task.actual-task.estimate)):'—'}</td></tr>`).join('')}</tbody></table></div>`:'<p class="help-text">Complete a task and log time to build your personal estimate history.</p>'}`);
}
function clearFilters(){search='';course='';source='All sources';effort='all';selectedPriority=null;selectedDate=null;scope='all';$('#task-search').value='';}
function setView(next,nextScope='all'){clearFilters();view=next;scope=nextScope;render();}
function setFocus(id){preferences.focusId=preferences.focusId===id?null:id;const saved=savePreferences();render();if(saved)notify(preferences.focusId?'Task added to Focus':'Task removed from Focus');}
const detailTabs=Object.entries({overview:'Overview',source:'Source',time:'Time history'});
let detailDraft=null;
function openTask(id){detailDraft=null;detailId=id;detailTab='overview';renderDetails();$('#task-dialog').showModal();$('#actual-time')?.focus();}
function renderDetails(){
 const task=state.tasks.find(item=>item.id===detailId);if(!task)return;const p=priorityOf(task);if(detailDraft?.id!==task.id)detailDraft={id:task.id,revision:state.revision,actual:task.actual!=null?task.actual+' min':''};const draft=detailDraft;let content='';
 if(detailTab==='overview')content=`<div class="detail-meta"><div><small>DUE</small><strong title="${escape(dueDetails(task))}">${escape(dateLabel(task.due))}${task.time?' · '+escape(task.time):''}</strong></div><div><small>ESTIMATE</small><strong>${task.estimate?duration(task.estimate):'Pending'}</strong></div><div class="priority-${p}"><small>PRIORITY</small><strong class="priority-value">${priorityLabel(p)}</strong></div></div><label class="duration-label" for="actual-time">${task.completedAt?'Update logged time':'Actual time (optional)'}</label><form id="duration-form"><div class="duration-input"><input id="actual-time" placeholder="e.g. 45 min" value="${escape(draft.actual)}" autocomplete="off" aria-describedby="duration-error"><button class="primary-button">${task.completedAt?'Save time':'Complete task'}</button></div><div id="duration-error" class="error-text" role="alert"></div></form><button id="reconcile-task" class="text-button" hidden>Reload current task / keep my input</button>`;
 if(detailTab==='source')content=`<div class="context-box"><h3>${escape(task.source)}</h3><p>${escape(task.context||'No source context recorded.')}</p>${task.from?`<small>From ${escape(task.from)}</small>`:''}<blockquote>${escape(task.excerpt||'No source excerpt recorded.')}</blockquote>${task.observedAt?`<small>Observed ${escape(new Date(task.observedAt).toLocaleString())}</small>`:''}${task.url?`<a class="source-link" href="${escape(task.url)}" target="_blank" rel="noopener noreferrer">Open original source ↗</a>`:''}</div>`;
 if(detailTab==='time'){const comparisons=completed().filter(item=>item.id!==task.id&&contextOf(item)===contextOf(task)&&item.actual!=null).slice(0,5);content=`<div class="detail-meta"><div><small>ESTIMATED</small><strong>${task.estimate?duration(task.estimate):'Pending'}</strong></div><div><small>ACTUAL</small><strong>${task.actual!=null?duration(task.actual):'Not logged'}</strong></div></div><p class="detail-reason">${task.completedAt?'Completed '+new Date(task.completedAt).toLocaleString():'This task is still active.'}${task.actual!=null&&task.estimate?' Actual time was '+duration(Math.abs(task.actual-task.estimate))+(task.actual>task.estimate?' over':' under')+' estimate.':''}</p><h3 class="insight-heading">Other logged work in this course</h3>${comparisons.map(item=>`<button class="comparison-task" data-detail-open="${escape(item.id)}">${escape(item.title)}<strong>${duration(item.actual)} actual</strong></button>`).join('')||'<p class="help-text">No comparable logged tasks yet.</p>'}`;}
 setMarkup('#detail-content',`<div class="detail-eyebrow">${escape(task.source)} · ${escape(contextOf(task))}</div><h2 id="detail-title">${escape(task.title)}</h2><div class="detail-tabs" role="tablist" aria-label="Task information">${detailTabs.map(([tab,label])=>`<button role="tab" id="detail-tab-${tab}" aria-controls="detail-pane" tabindex="${detailTab===tab?0:-1}" aria-selected="${detailTab===tab}" class="${detailTab===tab?'active':''}" data-detail-tab="${tab}">${label}</button>`).join('')}</div><div id="detail-pane" class="detail-pane" role="tabpanel" aria-labelledby="detail-tab-${detailTab}">${content}</div><div class="detail-actions"><label class="detail-priority"><span>Priority</span><select data-task-priority="${escape(task.id)}" aria-label="Set task priority"><option value="" disabled ${!task.priority?'selected':''}>Unrated</option>${[5,4,3,2,1].map(n=>`<option value="${n}" ${task.priority===n?'selected':''}>${priorityLabel(n)}</option>`).join('')}</select></label><button class="text-button" data-delete="${escape(task.id)}">Delete task</button></div>`);
 if($('#actual-time'))$('#actual-time').oninput=event=>{draft.actual=event.target.value;};
 if($('#duration-form'))$('#duration-form').onsubmit=async event=>{event.preventDefault();const value=$('#actual-time').value.trim(),actual=value?parseDuration(value):null;if(value&&!actual){$('#duration-error').textContent='Enter 1 min–24 hours.';return;}const button=$('#duration-form button');button.disabled=true;try{loadVersion++;state=await api('/api/tasks/'+encodeURIComponent(task.id),{action:'complete',actual,baseRevision:draft.revision});$('#task-dialog').close();render();notify(task.completedAt?'Time saved':'Completed');}catch(error){$('#duration-error').textContent=error.message;$('#reconcile-task').hidden=false;}finally{button.disabled=false;}};
 if($('#reconcile-task'))$('#reconcile-task').onclick=async()=>{const button=$('#reconcile-task');button.disabled=true;try{await load();draft.revision=state.revision;const current=state.tasks.find(item=>item.id===task.id);$('#duration-error').textContent=current?'Current state: '+(current.completedAt?'completed, '+(current.actual??'no')+' minutes logged.':'active.')+' Your entered time is kept. Review, then save if needed.':'Task no longer exists. Copy your input before closing.';}catch(error){$('#duration-error').textContent=error.message;}finally{button.disabled=false;}};
}
let shownLoginStatus;
function openStatus(name){
 shownLoginStatus=state.blackboardLogin;
 const items=name?state.sources.filter(item=>item.source===name):state.sources;
 const login=state.blackboardLogin;
 const recovery=item=>item.source==='Blackboard'?`<button class="text-button" data-blackboard-login ${login==='pending'?'disabled':''}>${login==='pending'?'Sign-in window open':'Sign in to Blackboard'}</button><p class="help-text">${login==='complete'?'Sign-in completed. Select Refresh to check again.':login==='failed'?'Sign-in did not complete. Try again and finish in the browser window.':'Opens the Blackboard MCP browser. Complete sign-in there, then refresh.'}</p>`:item.source==='Gmail'||item.source==='Outlook'?`<p class="help-text">Refresh uses a separate Codex CLI process. A connection in ChatGPT or the Codex app may not be available to that process; check its available mail tools and permissions.</p>`:'';
 setMarkup('#status-content',`<div class="detail-eyebrow">SOURCE HEALTH</div><h2 id="status-title">${escape(name||'Refresh details')}</h2>${!name?`<p class="detail-reason">${escape($('#sync-feedback').textContent)}</p><p class="help-text">${state.lastRefreshAt?'Last import: '+escape(new Date(state.lastRefreshAt).toLocaleString()):'No source import yet.'} Refresh runs only when selected.</p>`:''}${items.map(item=>`<section class="source-report"><h3>${icon(item.source)} ${escape(item.source)} <span class="source-report-status">${escape(sourceStatusLabel(item.status))}</span></h3><p>${escape(item.note||'No note recorded.')}</p><small>${item.checkedAt?'Checked '+escape(new Date(item.checkedAt).toLocaleString()):'Not checked yet'}</small>${recovery(item)}<button class="text-button" data-filter-source="${escape(item.source)}">Show tasks from ${escape(item.source)}</button></section>`).join('')||'<p class="help-text">No source status available.</p>'}`);
 if(!$('#status-dialog').open)$('#status-dialog').showModal();
}
async function signInBlackboard(){
 try{await api('/api/blackboard-login',{});state.blackboardLogin='pending';openStatus('Blackboard');refreshStatus();schedulePoll();}
 catch(error){notify(error.message);}
}

async function refresh(){if(busy||reordering||dragging||state.refresh?.status==='pending')return;busy=true;requestError=null;refreshStatus();try{await api('/api/refresh',{});await load();}catch(error){requestError=error.message;notify('Refresh could not start');}finally{busy=false;refreshStatus();}}
// Filtered-out tasks and completion history retain their positions when visible slots move.
function tasksInVisibleOrder(tasks,visibleOrder){const visible=new Set(visibleOrder),byId=new Map(tasks.map(task=>[task.id,task]));let index=0;return tasks.map(task=>!task.completedAt&&visible.has(task.id)?byId.get(visibleOrder[index++]):task);}
const taskRects=()=>new Map([...$('#task-list').children].map(node=>[node.dataset.card,node.getBoundingClientRect()]));
const reducedMotion=()=>preferences.motion==='reduced'||matchMedia('(prefers-reduced-motion: reduce)').matches;
function animateCards(before){if(reducedMotion())return;for(const node of $('#task-list').children){const previous=before.get(node.dataset.card);if(!previous||node===dragging?.element)continue;node.getAnimations().forEach(animation=>animation.cancel());const dy=previous.top-node.getBoundingClientRect().top;if(Math.abs(dy)>1)node.animate([{transform:`translateY(${dy}px)`},{transform:'translateY(0)'}],{duration:240,easing:'cubic-bezier(.2,.8,.2,1)'});}}
function focusCard(id){[...document.querySelectorAll('#task-list [data-card]')].find(node=>node.dataset.card===id)?.focus({preventScroll:true});}
async function saveOrder(visibleOrder,focusId){
 if(!canReorder())return;const previous=state,nextTasks=tasksInVisibleOrder(state.tasks,visibleOrder),order=nextTasks.filter(task=>!task.completedAt).map(task=>task.id),currentOrder=active().map(task=>task.id);
 if(order.every((id,index)=>id===currentOrder[index])){renderedMarkup.delete($('#task-list'));render();focusCard(focusId);schedulePoll();return;}
 const before=taskRects();reordering=true;loadVersion++;clearTimeout(pollTimer);state={...state,tasks:nextTasks};renderedMarkup.delete($('#task-list'));render();animateCards(before);let failed=false;
 try{state=await api('/api/reorder',{order,baseRevision:previous.revision});notify('Order saved · next AI refresh may reorder it');}catch(error){state=previous;failed=true;notify(`Order not saved: ${error.message}`);}finally{const positions=taskRects();reordering=false;render();animateCards(positions);focusCard(focusId);schedulePoll();}if(failed)load().catch(()=>{});
}
function moveTask(id,direction){if(!canReorder())return;const order=filtered().map(task=>task.id),index=order.indexOf(id),target=index+direction;if(index<0||target<0||target>=order.length)return;[order[index],order[target]]=[order[target],order[index]];saveOrder(order,id);}
function moveDragSlot(){const list=$('#task-list'),target=[...list.children].filter(node=>node!==dragging.element).find(node=>{return dragging.y<list.getBoundingClientRect().top+node.offsetTop+node.offsetHeight/2;})||null;if(dragging.element.nextElementSibling===target)return;const before=taskRects();list.insertBefore(dragging.element,target);animateCards(before);}
function dragFrame(){if(!dragging?.started)return;dragging.ghost.style.transform=`translate3d(${(dragging.x-dragging.startX)*.1}px,${dragging.y-dragging.startY}px,0) scale(1.012)`;const edge=72,speed=dragging.y<edge?-Math.min(16,(edge-dragging.y)/4):dragging.y>innerHeight-edge?Math.min(16,(dragging.y-innerHeight+edge)/4):0;if(speed)window.scrollBy(0,speed);moveDragSlot();dragging.frame=requestAnimationFrame(dragFrame);}
function beginDrag(){if(!dragging||dragging.started)return;const rect=dragging.element.getBoundingClientRect();dragging.started=true;dragging.ghost=dragging.element.cloneNode(true);dragging.ghost.classList.add('drag-ghost');dragging.ghost.setAttribute('aria-hidden','true');dragging.ghost.inert=true;Object.assign(dragging.ghost.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px'});document.body.append(dragging.ghost);dragging.element.classList.add('drag-placeholder');$('#task-list').classList.add('is-dragging');$('#task-list').setPointerCapture(dragging.pointerId);$('#reorder-announcement').textContent='Moving task. Release to save or Escape to cancel.';dragFrame();}
function finishDrag(cancel=false){
 if(!dragging)return;const current=dragging;dragging=null;clearTimeout(current.holdTimer);cancelAnimationFrame(current.frame);current.ghost?.remove();current.element.classList.remove('drag-placeholder');$('#task-list').classList.remove('is-dragging');if($('#task-list').hasPointerCapture?.(current.pointerId))$('#task-list').releasePointerCapture(current.pointerId);
 if(current.started){suppressClickUntil=Date.now()+350;if(!cancel){saveOrder([...$('#task-list').children].map(node=>node.dataset.card),current.id);return;}const before=taskRects();renderedMarkup.delete($('#task-list'));render();animateCards(before);notify('Reorder cancelled');}refreshStatus();schedulePoll();if(current.started)focusCard(current.id);
}
async function deleteTask(id){
 if(!state.tasks.some(item=>item.id===id))return;
 try{state=await api('/api/tasks/'+encodeURIComponent(id),{action:'delete',baseRevision:state.revision});if($('#task-dialog').open)$('#task-dialog').close();render();notify('Task deleted');}
 catch(error){notify('Task not deleted: '+error.message);load().catch(()=>{});}
}
let menuTaskId=null;
function setPriorityPicker(open){const panel=$('#priority-options');panel.inert=!open;$('#priority-toggle').setAttribute('aria-expanded',String(open));$('.priority-picker').classList.toggle('open',open);}
function closeTaskMenu(restoreFocus=false){setPriorityPicker(false);const id=menuTaskId;menuTaskId=null;$('#task-menu').hidden=true;if(restoreFocus&&id)focusCard(id);}
async function hideTask(id){
 const until=hideUntil(state.tasks.find(task=>task.id===id));
 if(!(until>today()))return;
 try{loadVersion++;state=await api('/api/tasks/'+encodeURIComponent(id),{action:'hide',baseRevision:state.revision});render();$('#task-search').focus();notify('Task hidden until '+fullDate.format(new Date(until+'T12:00:00')));}
 catch(error){notify(error.message);}
}
async function migrateHiddenTasks(){
 for(const id of Object.keys(preferences.hiddenTasks||{})){
  const task=state.tasks.find(item=>item.id===id);
  if(!task)continue;
  if(!task.hidden){loadVersion++;state=await api('/api/tasks/'+encodeURIComponent(id),{action:'hide',baseRevision:state.revision});}
  delete preferences.hiddenTasks[id];savePreferences();
 }
 render();
}
function openTaskMenu(id,x,y){menuTaskId=id;const hide=$('[data-menu-hide]'),until=hideUntil(state.tasks.find(task=>task.id===id));hide.disabled=!(until>today());hide.title=hide.disabled?'Requires a due date more than 10 days away.':'Returns 10 days before the due date.';const menu=$('#task-menu');menu.hidden=false;menu.style.left=Math.max(4,Math.min(x,innerWidth-menu.offsetWidth-4))+'px';menu.style.top=Math.max(4,Math.min(y,innerHeight-menu.offsetHeight-49))+'px';setPriorityPicker(false);menu.focus();}
async function setTaskPriority(id,priority){
 try{const revision=state.revision;loadVersion++;state=await api('/api/tasks/'+encodeURIComponent(id),{action:'priority',priority,baseRevision:revision});if(detailDraft?.id===id&&detailDraft.revision===revision)detailDraft.revision=state.revision;render();if($('#task-dialog').open){renderDetails();$('[data-task-priority]')?.focus();}else focusCard(id);notify('Priority updated');}
 catch(error){notify('Priority not changed: '+error.message);load().catch(()=>{});}
}
$('#task-list').addEventListener('contextmenu',event=>{const card=event.target.closest('[data-card]');if(!card||event.target.closest('a,input,select,textarea,details'))return;event.preventDefault();const rect=card.getBoundingClientRect();openTaskMenu(card.dataset.card,event.clientX||rect.left,event.clientY||rect.top);});
$('.priority-picker').addEventListener('pointerenter',()=>setPriorityPicker(true));
$('.priority-picker').addEventListener('pointerleave',()=>{if(!$('.priority-picker').contains(document.activeElement))setPriorityPicker(false);});
$('.priority-picker').addEventListener('focusout',event=>{if(!$('.priority-picker').contains(event.relatedTarget))setPriorityPicker(false);});
$('#priority-toggle').addEventListener('focus',()=>setPriorityPicker(true));
$('#priority-toggle').addEventListener('click',()=>setPriorityPicker(true));
$('#task-menu').addEventListener('click',event=>{const priority=event.target.closest('[data-set-priority]'),del=event.target.closest('[data-menu-delete]'),hide=event.target.closest('[data-menu-hide]'),id=menuTaskId;if(!id)return;if(priority){closeTaskMenu();setTaskPriority(id,Number(priority.dataset.setPriority));}else if(hide&&!hide.disabled){closeTaskMenu();hideTask(id);}else if(del){closeTaskMenu();deleteTask(id);}});
document.addEventListener('pointerdown',event=>{if(menuTaskId&&!event.target.closest('#task-menu'))closeTaskMenu();});

$('#task-list').addEventListener('pointerdown',event=>{const element=event.target.closest('[data-card]');if(!element||event.button!==0||event.target.closest('button,input,a,select,textarea,summary,details,.priority-tag')||!canReorder()||filtered().length<2||document.getSelection?.()?.toString())return;loadVersion++;clearTimeout(pollTimer);dragging={id:element.dataset.card,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,element,started:false,touch:event.pointerType==='touch'};if(dragging.touch)dragging.holdTimer=setTimeout(beginDrag,350);refreshStatus();});
document.addEventListener('pointermove',event=>{if(!dragging||event.pointerId!==dragging.pointerId)return;dragging.x=event.clientX;dragging.y=event.clientY;const distance=Math.hypot(dragging.x-dragging.startX,dragging.y-dragging.startY);if(!dragging.started&&distance>7){if(dragging.touch){finishDrag(true);return;}beginDrag();}if(dragging?.started)event.preventDefault();},{passive:false});
document.addEventListener('contextmenu',event=>{if(dragging?.started)event.preventDefault();});
document.addEventListener('touchmove',event=>{if(dragging?.started)event.preventDefault();},{passive:false});
document.addEventListener('pointerup',event=>{if(dragging?.pointerId===event.pointerId)finishDrag();});document.addEventListener('pointercancel',()=>finishDrag(true));window.addEventListener('blur',()=>finishDrag(true));
function csvCell(value){if(typeof value==='number'&&Number.isFinite(value))return String(value);const text=String(value??'');return '"'+(/^[\t\r]|^\s*[=+\-@]/.test(text)?"'":'')+text.replace(/"/g,'""')+'"';}
function exportTasks(){const tasks=view==='insights'?completed():filtered(),fields=['title','source','context','priority','due','time','estimate','actual','completedAt'];const csv=[fields,...tasks.map(task=>fields.map(field=>task[field]??''))].map(row=>row.map(csvCell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'})),anchor=document.createElement('a');anchor.href=url;anchor.download='tasks-'+today()+'.csv';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify(`Exported ${tasks.length} tasks`);}
document.addEventListener('click',async event=>{
 if(dragging)return;const target=event.target;
 const nav=target.closest('[data-view]');if(nav){setView(nav.dataset.view);return;}
 const tab=target.closest('[data-scope]');if(tab){selectedDate=null;view='queue';scope=tab.dataset.scope;render();return;}
 const priority=target.closest('[data-priority]');if(priority){const value=priority.dataset.priority;selectedPriority=selectedPriority===Number(value)?null:Number(value);render();$(`[data-priority="${value}"]`)?.focus();return;}
 const date=target.closest('[data-date]');if(date){const value=date.dataset.date;selectedDate=selectedDate===value?null:value;view='queue';scope='all';render();$(`[data-date="${value}"]`)?.focus();return;}
 const context=target.closest('[data-course]');if(context){course=course===context.dataset.course?'':context.dataset.course;render();$('#task-search').focus();return;}
 const focus=target.closest('[data-focus]');if(focus){setFocus(focus.dataset.focus);if($('#task-dialog').open)renderDetails();return;}
 if(target.closest('[data-blackboard-login]')){signInBlackboard();return;}
 const deletion=target.closest('[data-delete]');if(deletion){deleteTask(deletion.dataset.delete);return;}
 const status=target.closest('[data-source-status]');if(status){openStatus(status.dataset.sourceStatus);return;}
 const sourceButton=target.closest('[data-filter-source]');if(sourceButton){$('#status-dialog').close();clearFilters();source=sourceButton.dataset.filterSource;view='queue';render();return;}
 const tabButton=target.closest('[data-detail-tab]');if(tabButton){detailTab=tabButton.dataset.detailTab;renderDetails();$(`[data-detail-tab="${detailTab}"]`).focus();return;}
 const comparison=target.closest('[data-detail-open]');if(comparison){detailId=comparison.dataset.detailOpen;detailTab='time';renderDetails();return;}
 const restore=target.closest('[data-restore]');if(restore){restore.disabled=true;try{loadVersion++;state=await api('/api/tasks/'+encodeURIComponent(restore.dataset.restore),{action:'restore',baseRevision:state.revision});render();notify('Restored');}catch(error){notify(error.message);restore.disabled=false;}return;}
 if(target.closest('[data-add-task]')){openAddTask();return;}
 if(target.closest('[data-clear-filters]')){clearFilters();render();$('#task-search').focus();return;}
 const open=target.closest('[data-open]');if(open){openTask(open.dataset.open);return;}
 const cardElement=target.closest('[data-card]');if(cardElement&&Date.now()>=suppressClickUntil&&!target.closest('input,button,a,details,.priority-tag'))openTask(cardElement.dataset.card);
});
document.addEventListener('change',event=>{
 const target=event.target;if(target.matches('[data-task-priority]')){setTaskPriority(target.dataset.taskPriority,Number(target.value));return;}if(target.matches('[data-complete]')){target.checked=false;openTask(target.dataset.complete);}
 if(target.id==='source-filter'){source=target.value;render();}if(target.id==='course-filter'){course=target.value;render();}if(target.id==='effort-filter'){effort=target.value;render();}
 if(target.id==='jump-date'&&target.value){const date=new Date(target.value+'T12:00:00');if(!isNaN(date)){month=date.getMonth();year=date.getFullYear();selectedDate=target.value;view='queue';scope='all';render();}}
});
document.addEventListener('keydown',event=>{
 if(menuTaskId&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){const buttons=[...$('#task-menu').querySelectorAll('button:not(:disabled):not([inert] button)')],i=buttons.indexOf(document.activeElement);event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length].focus();return;}
 if(event.key==='Escape'&&menuTaskId){event.preventDefault();closeTaskMenu(true);return;}
 if(event.key==='Escape'&&dragging){event.preventDefault();finishDrag(true);return;}
 const target=event.target,typing=target.matches('input,textarea,select,[contenteditable="true"]');
 if(target.matches('[data-detail-tab]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const count=detailTabs.length,index=detailTabs.findIndex(([tab])=>tab===detailTab);[detailTab]=detailTabs[event.key==='Home'?0:event.key==='End'?count-1:(index+(event.key==='ArrowRight'?1:count-1))%count];renderDetails();$('[data-detail-tab="'+detailTab+'"]').focus();return;}
 if(event.key==='Escape'&&target.id==='task-search'){search='';target.value='';render();return;}
 if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'||!typing&&event.key==='/'){event.preventDefault();if(view==='insights'||view==='focus')setView('queue');$('#task-search').focus();return;}
 if(!typing&&event.key==='?'){event.preventDefault();$('#help-dialog').showModal();return;}
 const cardElement=target.closest('[data-card]');if(cardElement&&target===cardElement){if(event.altKey&&['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();moveTask(cardElement.dataset.card,event.key==='ArrowUp'?-1:1);}else if(event.key==='Enter'){event.preventDefault();openTask(cardElement.dataset.card);}}
});
$('#task-search').addEventListener('input',event=>{search=event.target.value;render();});$('#clear-search').onclick=()=>{search='';$('#task-search').value='';render();$('#task-search').focus();};$('#clear-filters').onclick=()=>{clearFilters();render();$('#task-search').focus();};
$('#reload-tasks').onclick=async()=>{try{await load();notify('Tasks reloaded. Review the current state before retrying.');}catch(error){notify(error.message);}};
function openAddTask(){$('#add-help').textContent=state.mode==='demo'?'Saved locally. Your first task hides the samples.':'Saved in your local workspace.';$('#reconcile-add').hidden=true;$('#new-task-error').textContent='';$('#add-dialog').showModal();$('#new-title').focus();}
$('#add-task').onclick=openAddTask;
$('#reconcile-add').onclick=async()=>{try{await load();$('#new-task-error').textContent='Tasks reloaded. Your input is kept; retry uses the same task ID.';}catch(error){$('#new-task-error').textContent=error.message;}};
let newTaskId=null;
$('#new-task-form').onsubmit=async event=>{
 event.preventDefault();const button=$('#new-task-form button[type="submit"]');button.disabled=true;newTaskId??=crypto.randomUUID();
 try{state=await api('/api/tasks',{id:newTaskId,title:$('#new-title').value.trim(),context:$('#new-context').value.trim(),due:$('#new-due').value||null,estimate:$('#new-estimate').value?Number($('#new-estimate').value):null,baseRevision:state.revision});loadVersion++;newTaskId=null;$('#new-task-form').reset();$('#add-dialog').close();clearFilters();view='queue';render();notify('Task added');}catch(error){$('#new-task-error').textContent=error.message;$('#reconcile-add').hidden=false;}finally{button.disabled=false;}
};
$('#refresh-button').onclick=refresh;$('#sync-details').onclick=()=>openStatus();$('#shortcut-help').onclick=()=>$('#help-dialog').showModal();$('#export-tasks').onclick=exportTasks;
$('#density-toggle').onclick=()=>{preferences.density=preferences.density==='compact'?'comfortable':'compact';savePreferences();render();};$('#motion-toggle').onclick=()=>{preferences.motion=preferences.motion==='reduced'?'system':'reduced';savePreferences();render();};
$('#active-summary').onclick=()=>setView('queue');$('#due-summary').onclick=()=>setView('queue','today');$('#time-summary').onclick=()=>setView('insights');
$('#next-focus').onclick=()=>{const tasks=active(),index=tasks.findIndex(task=>task.id===preferences.focusId);if(tasks.length){preferences.focusId=tasks[(index+1)%tasks.length].id;savePreferences();render();}};
$('#calendar-today').onclick=()=>{const date=new Date(today()+'T12:00:00');month=date.getMonth();year=date.getFullYear();selectedDate=today();view='queue';scope='all';render();};$('#clear-date').onclick=()=>{selectedDate=null;render();};
$('#prev-month').onclick=()=>{month--;if(month<0){month=11;year--;}render();};$('#next-month').onclick=()=>{month++;if(month>11){month=0;year++;}render();};
for(const selector of ['#task-dialog','#status-dialog','#help-dialog','#add-dialog'])$(selector).addEventListener('click',event=>{if(event.target===$(selector)){const rect=event.target.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)event.target.close();}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load().catch(error=>{$('#sync-feedback').textContent=error.message;});});
async function start(){try{const legacy=localStorage.getItem('work-optimizer-history-v1');if(legacy){await api('/api/migrate',JSON.parse(legacy));localStorage.removeItem('work-optimizer-history-v1');}}catch{notify('Legacy history could not be migrated; browser copy retained');}try{await load();await migrateHiddenTasks();}catch(error){$('#sync-feedback').textContent=error.message;setMarkup('#task-list','');schedulePoll();}}
start();
