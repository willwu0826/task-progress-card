const $=id=>document.getElementById(id);
const thread=location.pathname.startsWith('/t/')?location.pathname.slice(3):null;
const scoped=url=>url+(thread?'?thread='+encodeURIComponent(thread):'');
let snapshot=null,lastSignature='',busy=false;
let selectedTrace=null,traceRequest=0,recordRequest=0;
const stepViews=new Map();
// Only reading preferences live in browser storage; task state stays in its source card.
const viewStorageKey='progress-card-view-v1:'+thread;
let savedView={};
try{if(thread)savedView=JSON.parse(globalThis.sessionStorage?.getItem(viewStorageKey)||'{}')||{};}catch{}
const detailViews=new Map(Object.entries(savedView.details||{}).filter(([key,value])=>key.length<200&&typeof value==='boolean').slice(-100));
let activeTab='current';
function rememberView(){
  if(!thread)return;
  try{globalThis.sessionStorage?.setItem(viewStorageKey,JSON.stringify({tab:activeTab,search:$('search').value.slice(0,200),completed:$('completedOnly').checked,month:$('monthFilter').value,from:$('dateFrom').value,to:$('dateTo').value,details:Object.fromEntries([...detailViews].slice(-100))}));}catch{}
}
function restoreControls(){
  $('search').value=typeof savedView.search==='string'?savedView.search.slice(0,200):'';
  $('completedOnly').checked=savedView.completed===true;
  const month=typeof savedView.month==='string'&&/^\d{4}-\d{2}$/.test(savedView.month)?savedView.month:'';
  const dateValue=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';
  $('monthFilter').value=month;
  $('dateFrom').value=month?'':dateValue(savedView.from);$('dateTo').value=month?'':dateValue(savedView.to);
  if($('dateFrom').value||$('dateTo').value)document.querySelector?.('.dateOptions')?.setAttribute('open','');
}
function readingDetails(key,label,body,className='',defaultOpen=false){
  const open=detailViews.has(key)?detailViews.get(key):defaultOpen;
  return '<details class="'+esc(className)+'" data-view-key="'+esc(key)+'" '+(open?'open':'')+'><summary>'+label+'</summary>'+body+'</details>';
}
function toggleReading(e){
  const key=e.target.dataset?.viewKey;if(!key)return;
  detailViews.set(key,e.target.open);rememberView();
}
const states={READY:'就绪',RUNNING:'进行中',REVIEW:'待验收',BLOCKED:'待解决',DONE:'已完结',UNKNOWN:'待核实'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=s=>s?new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'未知';
const pill=s=>'<span class="pill '+esc(s)+'">'+esc(states[s]||s)+'</span>';
function eventText(h,c){
  const names={create:'建立任务卡',setAction:'更新当前动作',startDetour:'进入回补',reviseDetour:'纠正回补目标',finishDetour:'回补完成',advance:'主线推进',invalidate:'撤销失效验收',setStatus:'状态变化',complete:'任务完结'};
  const detail=h.details||{};
  const extra=detail.detour?.title||detail.text||detail.reason||detail.evidence||(detail.to?states[detail.to]:'')||c.steps.find(s=>s.id===detail.stepId)?.title||'';
  return date(h.at)+' · '+(names[h.action]||'记录变化')+(extra?'：'+extra:'');
}
function legacyCard(c){
  let html='<div class="tasktop">原项目状态 '+pill(c.status)+'</div><h2>'+esc(c.title)+'</h2><p class="goal">'+esc(c.goal)+'</p><div class="mainline"><div class="sectionlabel">主线位置</div><strong>'+esc(c.mainlineLabel||'原卡尚未单列')+'</strong><span class="small">保持原项目的续接记录</span></div>';
  if(c.detourTitle)html+='<aside class="detour"><div class="sectionlabel">↶ 当前回补</div><h3>'+esc(c.detourTitle)+'</h3><p>原因：'+esc(c.detourReason||'未记录')+'</p><p>完成条件：'+esc(c.detourDoneWhen||'未记录')+'</p><p class="return">补完返回 → '+esc(c.returnLabel||'未记录')+'</p></aside>';
  else html+='<p class="small">原卡未单列回补与返回点，不据此推断没有回补。</p>';
  if(c.statusText)html+='<p class="small">原卡状态说明：'+esc(c.statusText)+'</p>';
  return html+'<div class="doing"><div class="sectionlabel">'+(c.noState?'资料登记':'原卡记录')+'</div><p>'+esc(c.currentAction||'原卡未单列当前动作，请查看原始记录。')+'</p></div><div class="next"><span>续接点</span><p>'+esc(c.nextAction||'原卡未单列，请查看项目资料。')+'</p></div>'+source(c);
}
function stepView(cardId,stepId){
  const key=JSON.stringify([cardId,stepId]);
  if(!stepViews.has(key))stepViews.set(key,{open:false,request:0});
  return stepViews.get(key);
}
function recordPreview(r,raw,toggleAttribute){
  return '<article class="recordPreview"><h3>'+esc(r.title)+'</h3><div class="readingToolbar"><span>'+(raw?'Markdown / 原始文本':'阅读版')+'</span><button class="textButton" '+toggleAttribute+' aria-pressed="'+raw+'">'+(raw?'返回阅读版':'查看原文')+'</button></div><details class="recordAddress"><summary>文件位置</summary><p class="sourcepath">'+esc(r.path)+'</p></details><div class="documentBody">'+(raw?'<pre class="documentPlain">'+esc(r.content)+'</pre>':globalThis.ProgressDocument.render(r.content,r.path))+'</div></article>';
}
function stepBody(c,s){
  const view=stepView(c.id,s.id),current=s.id===c.mainlineStepId;
  let html='<p class="stepStatus">'+(s.done?'已完成':current?'当前主线 · 尚未验收完成':'待完成')+'</p>';
  if(s.done){
    html+='<div class="sectionlabel">完成依据</div><p class="stepEvidence">'+esc(s.evidence||'原卡标记为已完成，未单独记录完成依据。')+'</p>';
    const event=c.history.findLast(h=>h.action==='advance'&&h.details?.stepId===s.id);
    html+='<p class="small">'+(event?'完成记录时间：'+esc(date(event.at)):'原记录未单列这一步的完成时间')+'</p>';
  }else html+='<p class="small">'+(current?'本任务的主线保留在这里；回看其他步骤不会改变进度。':'这一步尚未标记完成；可以先查看已关联的资料。')+'</p>';
  html+='<div class="sectionlabel stepRecordHeading">相关资料（按当前文件显示）</div>';
  if(view.loading)html+='<p class="small" role="status">正在查找这一步的资料…</p>';
  else if(view.error)html+='<p class="traceError" role="alert">'+esc(view.error)+'</p><button class="textButton" data-step-retry>重新读取资料</button>';
  else if(view.records?.length)html+='<div class="recordList">'+view.records.map(r=>'<button class="recordItem '+(view.recordId===r.id?'selected':'')+'" data-step-record="'+esc(r.id)+'" '+(!r.readable?'disabled':'')+'><span>'+esc(r.title)+'</span><small>'+(!r.exists?esc(r.error||'未找到'):!r.readable?'请到项目目录查看':'展开阅读 →')+'</small></button>').join('')+'</div>';
  else html+='<p class="small">'+(view.records?'暂无单独关联的资料':'展开后读取相关资料')+'</p>';
  if(view.recordLoading)html+='<p class="small" role="status">正在读取资料…</p>';
  if(view.recordError)html+='<p class="traceError" role="alert">'+esc(view.recordError)+'</p>';
  if(view.record)html+=recordPreview(view.record,view.rawView===true,'data-step-raw');
  return html;
}
function renderStep(c,s,i){
  const view=stepView(c.id,s.id);
  return '<li class="'+(s.done?'done':s.id===c.mainlineStepId?'now':'')+'"><details class="stepDetails" data-card-id="'+esc(c.id)+'" data-step-id="'+esc(s.id)+'" '+(view.open?'open':'')+'><summary><span class="stepnum">'+(s.done?'✓':i+1)+'</span><span class="stepTitle">'+esc(s.title)+'</span>'+(!s.done&&s.id===c.mainlineStepId?'<span class="nowtag">主线在这里</span>':'')+'<span class="stepChevron" aria-hidden="true">›</span></summary><div class="stepBody" data-step-body data-card-id="'+esc(c.id)+'" data-step-id="'+esc(s.id)+'">'+stepBody(c,s)+'</div></details></li>';
}
function updateStepBody(cardId,stepId){
  const c=snapshot?.cards.find(c=>c.id===cardId),s=c?.steps?.find(s=>s.id===stepId);if(!s)return;
  document.querySelectorAll('[data-step-body]').forEach(el=>{if(el.dataset.cardId===cardId&&el.dataset.stepId===stepId)el.innerHTML=stepBody(c,s);});
}
async function loadStepRecords(cardId,stepId){
  const view=stepView(cardId,stepId);if(view.loading)return;
  view.loading=true;view.error=null;updateStepBody(cardId,stepId);
  try{
    const response=await fetch(scoped('/api/trace/'+encodeURIComponent(cardId)),{cache:'no-store',signal:AbortSignal.timeout(5000)});
    const data=await response.json();if(!response.ok)throw Error(data.error||'步骤资料读取失败');
    view.records=data.records.filter(r=>Array.isArray(r.stepIds)&&r.stepIds.includes(stepId));
  }catch(e){view.error=e.message;}
  finally{view.loading=false;updateStepBody(cardId,stepId);}
}
function toggleStep(e){
  const el=e.target;if(!el.classList?.contains('stepDetails'))return;
  const {cardId,stepId}=el.dataset,view=stepView(cardId,stepId);view.open=el.open;
  if(el.open&&!view.records&&!view.loading&&!view.error)return loadStepRecords(cardId,stepId);
}
async function selectStepRecord(cardId,stepId,recordId){
  const view=stepView(cardId,stepId);if(!view.records?.some(r=>r.id===recordId&&r.readable))return;
  const request=++view.request;view.recordId=recordId;view.recordLoading=true;view.record=null;view.recordError=null;view.rawView=false;updateStepBody(cardId,stepId);
  try{
    const response=await fetch(scoped('/api/trace/'+encodeURIComponent(cardId)+'/'+encodeURIComponent(recordId)),{cache:'no-store',signal:AbortSignal.timeout(5000)});
    const record=await response.json();if(!response.ok)throw Error(record.error||'资料读取失败');
    if(request===view.request)view.record=record;
  }catch(e){if(request===view.request)view.recordError=e.message;}
  finally{if(request===view.request){view.recordLoading=false;updateStepBody(cardId,stepId);}}
}
function stepClick(e){
  const button=e.target.closest('[data-step-record],[data-step-raw],[data-step-retry]');if(!button)return false;
  const {cardId,stepId}=button.closest('.stepDetails').dataset,view=stepView(cardId,stepId);
  if(button.hasAttribute('data-step-raw')){view.rawView=!view.rawView;updateStepBody(cardId,stepId);return true;}
  if(button.hasAttribute('data-step-retry'))return loadStepRecords(cardId,stepId);
  return selectStepRecord(cardId,stepId,button.dataset.stepRecord);
}
function renderCard(c){
  if(c.error)return '<div class="empty"><strong>状态卡暂时无法读取</strong>'+esc(c.error)+'<p>请核对原文件，未自动重建进度。</p></div>';
  if(c.kind==='legacy'||c.kind==='catalog')return legacyCard(c);
  const step=c.steps.find(s=>s.id===c.mainlineStepId),index=c.steps.findIndex(s=>s.id===c.mainlineStepId);
  const d=c.detours.at(-1);
  let result='<div class="tasktop"><span>本对话的当前任务</span>'+pill(c.status)+'</div><h2>'+esc(c.title)+'</h2>';
  result+='<div class="mainline"><div class="sectionlabel">主线位置</div><strong>'+ (c.status==='DONE'?'本次任务已完结':esc(step?.title||'待明确'))+'</strong><span class="small">'+(c.status==='DONE'?'验收结果已保留': '第 '+(index+1)+' 步 / 共 '+c.steps.length+' 步'+(d?' · 回补期间保留此位置':''))+'</span></div>';
  result+='<div class="doing"><div class="sectionlabel">'+(c.status==='DONE'?'完成结果':'此刻在做')+'</div><p>'+esc(c.currentAction)+'</p></div>';
  if(d){
    const target=d.returnTo.kind==='step'?c.steps.find(s=>s.id===d.returnTo.id)?.title:c.detours.find(s=>s.id===d.returnTo.id)?.title;
    result+='<aside class="detour"><div class="sectionlabel">↶ 临时回补'+(c.detours.length>1?' · 第 '+c.detours.length+' 层':'')+'</div><h3>'+esc(d.title)+'</h3><p class="return">补完返回 → '+esc(target||d.returnTo.id)+'</p>'+readingDetails(c.id+':detour:'+d.id,'为什么回补 · 完成条件','<p>原因：'+esc(d.reason)+'</p><p>补到这里就够了：'+esc(d.doneWhen)+'</p>')+'</aside>';
  }
  result+='<div class="next"><span>接下来</span><p>'+esc(c.nextAction)+'</p></div>';
  const completed=c.steps.filter(s=>s.done).length;
  const steps='<p class="stepHint">点击任一步，查看完成依据与相关资料</p><ol class="steps">'+c.steps.map((s,i)=>renderStep(c,s,i)).join('')+'</ol>';
  result+=readingDetails(c.id+':steps','<span>步骤与资料</span><span class="stepCount">已完成 '+completed+' / '+c.steps.length+' 步</span><span class="stepChevron" aria-hidden="true">›</span>',steps,'workflowDetails');
  const meta='<p>'+esc(c.goal)+'</p><ul>'+c.acceptance.map(v=>'<li>'+esc(v)+'</li>').join('')+'</ul><ul>'+c.evidence.map(v=>'<li>'+esc(v)+'</li>').join('')+'</ul><p class="small">最近 '+Math.min(6,c.history.length)+' 次变化</p>'+c.history.slice(-6).reverse().map(h=>'<p class="small">'+esc(eventText(h,c))+'</p>').join('');
  result+=readingDetails(c.id+':meta','任务目标、验收与变化记录',meta);
  return result+source(c);
}
function source(c){if(!c.source)return '<p class="small">尚未登记状态卡；项目资料可以从上方档案入口查看。</p>';return readingDetails(c.id+':source','原始状态卡','<p class="sourcepath">'+esc(c.source)+'</p><a href="'+scoped('/api/source/'+encodeURIComponent(c.id))+'" target="_blank" rel="noopener">打开原始状态卡</a><p class="small">'+esc(c.sourceNote||'当前卡片与记录使用同一份文件；不会因 AI 停止回复而自动完结。')+'</p>');}
const timeEvents=c=>(c.timeline?.events||[]).filter(e=>/^\d{4}-\d{2}-\d{2}$/.test(e.day)).slice().sort((a,b)=>b.day.localeCompare(a.day)||(b.sort||b.day).localeCompare(a.sort||a.day)||(b.revision||0)-(a.revision||0));
function timeRange(){
  const month=$('monthFilter').value;
  if(/^\d{4}-\d{2}$/.test(month)){
    const [year,m]=month.split('-').map(Number);
    return {from:month+'-01',to:new Date(Date.UTC(year,m,0)).toISOString().slice(0,10),active:true};
  }
  const from=$('dateFrom').value,to=$('dateTo').value;
  return {from,to,active:!!(from||to),invalid:!!(from&&to&&from>to)};
}
const matchingEvents=(c,range=timeRange())=>timeEvents(c).filter(e=>(!range.from||e.day>=range.from)&&(!range.to||e.day<=range.to));
const eventSummary=e=>e.label==='状态变化'?String(e.summary||'').replace(/\b(READY|RUNNING|REVIEW|BLOCKED|DONE)\b/g,s=>states[s]):e.summary;
const monthName=m=>Number(m.slice(0,4))+' 年 '+Number(m.slice(5,7))+' 月';
function syncMonths(selected=$('monthFilter').value){
  const months=[...new Set(snapshot.cards.flatMap(c=>timeEvents(c).map(e=>e.day.slice(0,7))))].sort().reverse();
  $('monthFilter').innerHTML='<option value="">全部时间</option>'+months.map(m=>'<option value="'+esc(m)+'">'+esc(monthName(m))+'</option>').join('');
  $('monthFilter').value=months.includes(selected)?selected:'';
}
function timeSummary(c){
  const events=timeEvents(c);
  if(!events.length)return '时间未记录';
  const first=events.at(-1).day,last=events[0].day;
  return '已有记录：'+first+(first===last?'':' — '+last);
}
function historyItem(c,events,range){
  const latest=events.find(e=>e.label!=='状态变化')||events[0];
  return '<button class="historyItem" data-id="'+esc(c.id)+'" aria-label="查看项目档案：'+esc(c.title)+'"><span class="tasktop"><span>'+(c.id===snapshot.activeId?'当前对话任务':'本对话任务')+'</span>'+pill(c.status)+'</span><strong>'+esc(c.title)+'</strong><span class="taskDates">'+esc(timeSummary(c))+'</span>'+(latest?'<p class="datedExcerpt"><time>'+esc(latest.dateLabel||latest.day)+'</time> · '+esc(latest.label)+(latest.summary?'：'+esc(eventSummary(latest)):'')+'</p>':'<p>原卡未登记日期，暂不归入月份</p>')+'<span class="traceHint">'+(range.active&&latest?'查看此时段进展与相关资料':'查看时间记录与项目资料')+' →</span></button>';
}
function timelineView(c){
  const range=timeRange(),events=matchingEvents(c,range);
  const row=e=>'<li><time>'+esc(e.dateLabel||e.day)+'</time><strong>'+esc(e.label)+'</strong>'+(e.summary?'<p>'+esc(eventSummary(e))+'</p>':'')+'<small>'+esc(e.sourceLabel||'原状态卡记录')+'</small></li>';
  let html='<section class="taskTimeline"><h3>'+(range.active?'所选时段的进展':'按时间回看')+'</h3><p class="small">'+esc(timeSummary(c))+' · 北京时间</p>';
  if(events.length){
    html+='<ol class="timelineRows">'+events.slice(0,5).map(row).join('')+'</ol>';
    if(events.length>5)html+=readingDetails(c.id+':timeline','查看其余 '+(events.length-5)+' 条时间记录','<ol class="timelineRows">'+events.slice(5).map(row).join('')+'</ol>');
  }else html+='<p class="small">'+(range.active?'该时段没有已登记的进展。':'原卡没有可靠的事件日期，时间尚待补充。')+'</p>';
  if(c.timeline?.undated)html+='<p class="small">另有 '+c.timeline.undated+' 条记录缺少有效时间。</p>';
  if(c.timeline?.fileUpdatedAt)html+='<details class="fileTimestamp"><summary>文件时间参考</summary><p class="small">文件修改于 '+esc(date(c.timeline.fileUpdatedAt))+'；不作为任务发生或完结日期。</p></details>';
  return html+'<p class="timelineNote">仅展示原卡已有进展；下方资料按当前文件读取。</p></section>';
}
function history(){
  if(!snapshot)return;
  const q=$('search').value.trim().toLowerCase(),done=$('completedOnly').checked;
  const range=timeRange();
  $('catalogNotice').textContent=thread?'本对话里的任务，按留下进展记录的时间查找。':'请从对应对话打开它的专属进度卡。';
  if(range.invalid){$('timeNotice').textContent='结束日期不能早于起始日期。';$('historyList').innerHTML='';return;}
  const cards=snapshot.cards.filter(c=>(!done||c.status==='DONE')&&(!q||[c.title,c.goal,...(range.active?[]:[c.currentAction,c.nextAction,JSON.stringify(c.evidence||[])]),...matchingEvents(c,range).map(e=>e.label+' '+eventSummary(e))].join(' ').toLowerCase().includes(q)));
  const known=cards.map(c=>({c,events:matchingEvents(c,range)})).filter(x=>x.events.length).sort((a,b)=>b.events[0].day.localeCompare(a.events[0].day));
  const unknown=cards.filter(c=>!timeEvents(c).length);
  $('timeNotice').textContent=(range.active?'所选时段：':'')+known.length+' 项有时间记录的任务'+(unknown.length?' · '+unknown.length+' 项时间未记录':'')+' · 北京时间';
  let lastMonth='',html='';
  for(const {c,events} of known){
    const month=events[0].day.slice(0,7);
    if(month!==lastMonth){html+='<h3 class="monthHeading">'+esc(monthName(month))+'<span>最近匹配记录</span></h3>';lastMonth=month;}
    html+=historyItem(c,events,range);
  }
  if(!known.length&&(range.active||!unknown.length))html+='<div class="empty">'+(range.active?'该时段没有已登记的进展':'没有找到匹配记录')+'</div>';
  if(unknown.length)html+='<details class="unknownTimes" '+(!range.active?'open':'')+'><summary>时间未记录 · '+unknown.length+' 项'+(range.active?'（不计入时段结果）':'')+'</summary>'+unknown.map(c=>historyItem(c,[],range)).join('')+'</details>';
  $('historyList').innerHTML=html;
}
function renderTrace(){
  if(!selectedTrace)return;
  const state=selectedTrace,c=snapshot.cards.find(c=>c.id===state.id);if(!c)return;
  const data=state.data;
  let html='<button class="textButton backButton" data-back-history>← 返回历史记录</button><div class="tasktop"><span>项目档案 · 当前状态</span>'+pill(c.status)+'</div><h2>'+esc(c.title)+'</h2>'+timelineView(c);
  if(state.error)html+='<p role="alert" class="traceError">'+esc(state.error)+'</p><button class="textButton" data-retry-trace>重新读取档案</button>';
  else if(!data)html+='<p class="small" role="status">正在读取项目位置与相关记录…</p>';
  else {
    html+='<section class="projectLocation"><div class="sectionlabel">项目位置</div><p class="sourcepath">'+esc(data.projectRoot||data.locationError||'尚未登记')+'</p><button class="folderButton" data-open-project '+(!data.projectRoot?'disabled':'')+'>打开项目文件夹 ↗</button><p class="small" role="status">'+esc(state.openMessage||'在本机文件资源管理器中查看原文件')+'</p></section><div class="sectionlabel recordHeading">相关记录</div><div class="recordList">';
    html+=data.records.map(r=>'<button class="recordItem '+(state.recordId===r.id?'selected':'')+'" data-record-id="'+esc(r.id)+'" '+(!r.readable?'disabled':'')+'><span>'+esc(r.title)+'</span><small>'+(!r.exists?esc(r.error||'未找到'):!r.readable?'请到项目目录查看':'阅读原文 →')+'</small></button>').join('')+'</div>';
    if(state.recordLoading)html+='<p class="small" role="status">正在读取原始记录…</p>';
    if(state.recordError)html+='<p class="traceError" role="alert">'+esc(state.recordError)+'</p>';
    if(state.record)html+=recordPreview(state.record,state.rawView===true,'data-toggle-source');
    html+='<details><summary>当前进度与验收摘要（非历史快照）</summary>'+renderCard(c)+'</details>';
  }
  $('historyDetail').innerHTML=html;
}
function clearTrace(updateHash=true){
  traceRequest++;recordRequest++;selectedTrace=null;delete $('historyDetail').dataset.id;
  $('historyDetail').innerHTML='';$('historyList').hidden=false;
  if(updateHash&&location.hash!=='#history')location.hash='history';
}
async function selectHistory(id,updateHash=true){
  if(!snapshot?.cards.some(c=>c.id===id))return;
  const request=++traceRequest;recordRequest++;
  selectedTrace={id};$('historyDetail').dataset.id=id;$('historyList').hidden=true;tab('history');renderTrace();
  if(updateHash)location.hash='history/'+encodeURIComponent(id);
  $('historyDetail').scrollIntoView?.({block:'start',behavior:'smooth'});
  try{
    const response=await fetch(scoped('/api/trace/'+encodeURIComponent(id)),{cache:'no-store',signal:AbortSignal.timeout(5000)});
    const data=await response.json();if(!response.ok)throw Error(data.error||'项目档案读取失败');
    if(request!==traceRequest)return;
    selectedTrace.data=data;renderTrace();
    const initial=['delivery','usage','state','entry','readme','info','contract'].map(key=>data.records.find(r=>r.id===key&&r.readable)).find(Boolean);
    if(initial)await selectRecord(initial.id);
  }catch(e){if(request===traceRequest){selectedTrace.error=e.message;renderTrace();}}
}
async function selectRecord(recordId){
  const state=selectedTrace;if(!state?.data)return;
  const request=++recordRequest;state.recordId=recordId;state.recordLoading=true;state.record=null;state.recordError=null;state.rawView=false;renderTrace();
  try{
    const response=await fetch(scoped('/api/trace/'+encodeURIComponent(state.id)+'/'+encodeURIComponent(recordId)),{cache:'no-store',signal:AbortSignal.timeout(5000)});
    const record=await response.json();if(!response.ok)throw Error(record.error||'原文读取失败');
    if(selectedTrace!==state||request!==recordRequest)return;
    state.record=record;
  }catch(e){if(selectedTrace===state&&request===recordRequest)state.recordError=e.message;}
  finally{if(selectedTrace===state&&request===recordRequest){state.recordLoading=false;renderTrace();}}
}
async function openFolder(){
  const state=selectedTrace;if(!state?.data?.projectRoot||state.opening)return;
  state.opening=true;state.openMessage='正在打开…';renderTrace();
  try{
    const response=await fetch(scoped('/api/open-project/'+encodeURIComponent(state.id)),{method:'POST',headers:{'X-Progress-Action':'open-project'},signal:AbortSignal.timeout(5000)});
    const data=await response.json();if(!response.ok)throw Error(data.error||'未能打开目录');
    state.openMessage='已请求打开项目文件夹。若窗口未出现在前台，可从任务栏查看文件资源管理器。';
  }catch(e){state.openMessage='打开失败：'+e.message+'。上方保留完整地址。';}
  finally{state.opening=false;if(selectedTrace===state)renderTrace();}
}
function restoreHistory(){
  if(location.hash==='#current'){tab('current');return;}
  if(!location.hash){tab(savedView.tab==='history'?'history':'current');return;}
  if(location.hash==='#history'){if(selectedTrace)clearTrace(false);tab('history');return;}
  const id=(location.hash||'').match(/^#history\/([a-z0-9_-]+)$/)?.[1];
  if(id&&snapshot?.cards.some(c=>c.id===id)){tab('history');if(selectedTrace?.id!==id)selectHistory(id,false);}
}
async function refresh(){
  if(busy)return;busy=true;
  try{
    const response=await fetch(scoped('/api/cards'),{cache:'no-store',signal:AbortSignal.timeout(4000)});
    const data=await response.json();if(!response.ok)throw Error(data.error||'读取失败');
    data.cards=data.cards.filter(c=>thread && c.threadId===thread);
    if(data.activeId&&!data.cards.some(c=>c.id===data.activeId))throw Error('当前卡与本对话不匹配，已停止显示');
    const initialLoad=!snapshot;snapshot=data;
    const signature=JSON.stringify([data.activeId,data.cards,data.catalogNotice]);
    if(signature!==lastSignature){
      lastSignature=signature;
      const c=data.cards.find(c=>c.id===data.activeId);
      $('card').innerHTML=c?renderCard(c):'<div class="empty"><strong>'+(thread?'本对话尚未绑定进度卡':'请从对应对话打开')+'</strong><p>'+(thread?'尚无当前任务时，可以查看本对话记录。新任务由执行者关联原状态卡。':'每个对话使用自己的进度卡地址。这里不混排全部项目。')+'</p></div>';
      $('updated').textContent=c?'记录更新于 '+date(c.updatedAt):'已读取登记的任务记录';
      $('count').textContent=data.cards.length;
      if(initialLoad)restoreControls();
      syncMonths(initialLoad?savedView.month||'':$('monthFilter').value);
      history();
      if(selectedTrace)renderTrace();
      if(initialLoad)restoreHistory();
    }
    $('connection').textContent='已连接';$('connection').className='connection';$('notice').hidden=true;
  }catch(e){$('connection').textContent='连接中断';$('connection').className='connection error';$('notice').hidden=false;$('notice').textContent='更新暂停：'+e.message+'。下方若有卡片，是上次读取的记录。';}
  finally{busy=false;}
}
function tab(name){activeTab=name;$('current').hidden=name!=='current';$('history').hidden=name!=='history';$('currentTab').classList.toggle('active',name==='current');$('historyTab').classList.toggle('active',name==='history');rememberView();}
$('currentTab').onclick=()=>{tab('current');location.hash='current';};$('historyTab').onclick=()=>{tab('history');location.hash=selectedTrace?'history/'+encodeURIComponent(selectedTrace.id):'history';};$('refresh').onclick=refresh;
function filterChanged(){clearTrace();history();rememberView();}
$('search').addEventListener('input',filterChanged);
$('completedOnly').onchange=filterChanged;
$('monthFilter').onchange=()=>{$('dateFrom').value='';$('dateTo').value='';filterChanged();};
for(const id of ['dateFrom','dateTo'])$(id).onchange=()=>{$('monthFilter').value='';filterChanged();};
$('clearDates').onclick=()=>{$('monthFilter').value='';$('dateFrom').value='';$('dateTo').value='';filterChanged();};
$('historyList').onclick=e=>{const button=e.target.closest('[data-id]');if(button)return selectHistory(button.dataset.id);};
$('card').onclick=e=>{const action=stepClick(e);if(action!==false)return action;};
for(const id of ['card','historyDetail'])$(id).addEventListener('toggle',e=>{toggleReading(e);return toggleStep(e);},true);
$('historyDetail').onclick=e=>{
  const stepAction=stepClick(e);if(stepAction!==false)return stepAction;
  if(e.target.closest('[data-back-history]')){clearTrace();history();return;}
  if(e.target.closest('[data-retry-trace]'))return selectHistory(selectedTrace.id);
  if(e.target.closest('[data-open-project]'))return openFolder();
  if(e.target.closest('[data-toggle-source]')){selectedTrace.rawView=!selectedTrace.rawView;renderTrace();return;}
  const record=e.target.closest('[data-record-id]');if(record)return selectRecord(record.dataset.recordId);
};
globalThis.addEventListener?.('hashchange',restoreHistory);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
refresh();setInterval(()=>{if(!document.hidden)refresh();},2500);
