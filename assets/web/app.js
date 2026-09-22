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
function readingDetails(key,label,body,className='',defaultOpen=false,id=''){
  const open=detailViews.has(key)?detailViews.get(key):defaultOpen;
  return '<details class="'+esc(className)+'" data-view-key="'+esc(key)+'" '+(id?'id="'+esc(id)+'" ':'')+(open?'open':'')+'><summary>'+label+'</summary>'+body+'</details>';
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
function stepView(cardId,stepId,defaultOpen=false){
  const key=JSON.stringify([cardId,stepId]);
  if(!stepViews.has(key))stepViews.set(key,{open:defaultOpen,request:0});
  return stepViews.get(key);
}
function recordPreview(r,raw,toggleAttribute){
  return '<article class="recordPreview"><h3>'+esc(r.title)+'</h3><div class="readingToolbar"><span>'+(raw?'Markdown / 原始文本':'阅读版')+'</span><button class="textButton" '+toggleAttribute+' aria-pressed="'+raw+'">'+(raw?'返回阅读版':'查看原文')+'</button></div><details class="recordAddress"><summary>文件位置</summary><p class="sourcepath">'+esc(r.path)+'</p></details><div class="documentBody">'+(raw?'<pre class="documentPlain">'+esc(r.content)+'</pre>':globalThis.ProgressDocument.render(r.content,r.path))+'</div></article>';
}
function stepBody(c,s){
  const view=stepView(c.id,s.id),current=s.id===c.mainlineStepId;
  const staged=!!workflowStages(c);
  let html='<p class="stepStatus">'+(s.done?'已完成':current?'当前主线 · 尚未验收完成':'待完成')+'</p>';
  if(s.work && typeof s.work==='object'){
    const categories=Array.isArray(s.work.categories)?s.work.categories:[];
    html+='<div class="workCategories">'+categories.filter(v=>v&&typeof v.title==='string'&&Array.isArray(v.items)).map((v,i)=>{
      const items='<ul>'+v.items.filter(x=>typeof x==='string').map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>';
      return staged?readingDetails(c.id+':work:'+s.id+':'+i,esc(v.title),items,'workCategory'):'<section class="workCategory"><h4>'+esc(v.title)+'</h4>'+items+'</section>';
    }).join('')+'</div>';
    const fields=[['output','交付物'],['doneWhen','通过条件'],['returnPoint','不合格返回']];
    const acceptance='<dl class="workAcceptance">'+fields.filter(([key])=>typeof s.work[key]==='string'&&s.work[key].trim()).map(([key,label])=>'<div><dt>'+label+'</dt><dd>'+esc(s.work[key])+'</dd></div>').join('')+'</dl>';
    html+=staged?readingDetails(c.id+':acceptance:'+s.id,'交付物与验收条件',acceptance,'workEvidence'):acceptance;
  }
  const recordStart=html.length;
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
  return staged?html.slice(0,recordStart)+readingDetails(c.id+':records:'+s.id,'依据与相关资料',html.slice(recordStart),'workEvidence'):html;
}
function renderStep(c,s,i,compact=false){
  const view=stepView(c.id,s.id,compact&&s.id===c.mainlineStepId&&!s.done);
  return '<li class="'+(s.done?'done':s.id===c.mainlineStepId?'now':'')+'"><details class="stepDetails" data-card-id="'+esc(c.id)+'" data-step-id="'+esc(s.id)+'" '+(view.open?'open':'')+'><summary><span class="stepnum">'+(s.done?'✓':i+1)+'</span><span class="stepTitle">'+esc(compact?s.label||s.title:s.title)+'</span>'+(!s.done&&s.id===c.mainlineStepId?'<span class="nowtag">主线在这里</span>':'')+'<span class="stepChevron" aria-hidden="true">›</span></summary><div class="stepBody" data-step-body data-card-id="'+esc(c.id)+'" data-step-id="'+esc(s.id)+'">'+stepBody(c,s)+'</div></details></li>';
}
function workflowStages(c){
  const stages=c.workflow?.stages;
  if(!Array.isArray(stages)||!stages.length)return null;
  const stageIds=new Set(),stepIds=[];
  for(const stage of stages){
    if(!stage||typeof stage.id!=='string'||!stage.id||stageIds.has(stage.id)||typeof stage.title!=='string'||!stage.title.trim()||!Array.isArray(stage.stepIds)||!stage.stepIds.length)return null;
    stageIds.add(stage.id);stepIds.push(...stage.stepIds);
  }
  // Fall back to the complete flat list rather than hide a missing or duplicated step.
  if(stepIds.length!==c.steps.length||stepIds.some((id,i)=>id!==c.steps[i].id))return null;
  return stages;
}
function renderWorkflow(c,stages,scope){
  const current=stages.findIndex(stage=>stage.stepIds.includes(c.mainlineStepId));
  const groupId=stage=>scope+':'+c.id+':workflow:'+stage.id;
  const stats=stage=>{
    const steps=stage.stepIds.map(id=>c.steps.find(s=>s.id===id)),done=steps.filter(s=>s.done).length;
    return {steps,done,complete:done===steps.length};
  };
  const shortTitle=s=>s.label||s.title;
  const rows=stages.map((stage,i)=>{
    const {steps,done,complete}=stats(stage),active=c.status!=='DONE'&&i===current;
    const status=active?'当前阶段':complete?'已完成':done?'部分完成':'待完成';
    const label='<span class="stageNumber" aria-hidden="true">'+(i+1)+'</span><span class="stageHeading"><strong>'+esc(stage.title)+'</strong><span class="stageMeta">'+esc(stage.stepIds[0].toUpperCase())+(steps.length>1?'–'+esc(stage.stepIds.at(-1).toUpperCase()):'')+' · 已完成 '+done+'/'+steps.length+'</span></span><span class="stageState">'+status+'</span><span class="stageChevron" aria-hidden="true">›</span>';
    const outstanding=i<current&&!complete?'<span class="stageOutstanding">未完成：'+steps.filter(s=>!s.done).map(s=>esc(shortTitle(s))).join('、')+'</span>':'';
    return '<li class="workflowStage '+(active?'isCurrent':complete?'isComplete':'isPending')+'"'+(active?' aria-current="step"':'')+'><button type="button" class="stageNode" data-workflow-stage="'+esc(stage.id)+'" data-workflow-card="'+esc(c.id)+'" aria-controls="'+esc(groupId(stage))+'">'+label+outstanding+'</button>'+(i<stages.length-1?'<div class="stageConnector" aria-hidden="true">↓</div>':'')+'</li>';
  }).join('');
  const detail=stages.map((stage,i)=>{
    const {steps}=stats(stage),active=c.status!=='DONE'&&i===current;
    const body='<div class="stageContent">'+(typeof stage.summary==='string'?'<p class="stagePurpose">'+esc(stage.summary)+'</p>':'')+'<ol class="steps stageSteps">'+steps.map(s=>renderStep(c,s,c.steps.indexOf(s),true)).join('')+'</ol></div>';
    const label='<span class="stageHeading"><strong>'+esc(stage.title)+'</strong></span>'+(active?'<span class="stageState">当前工作</span>':'')+'<span class="stageChevron" aria-hidden="true">›</span>';
    return readingDetails(c.id+':stage:'+stage.id,label,body,'stageDetails',active,groupId(stage));
  }).join('');
  return '<section class="workflowMap" aria-label="整体制作流程"><div class="workflowHeading"><h3>整体制作流程</h3><span>'+stages.length+' 个阶段'+(c.status==='DONE'?' · 全部完成':' · 当前在第 '+(current+1)+' 阶段')+'</span></div><ol class="workflowStages">'+rows+'</ol><section class="workflowDrilldown" aria-label="分步工作内容"><h3>分步工作内容</h3>'+detail+'</section></section>';
}
function workflowFocus(c,stages){
  const step=c.steps.find(s=>s.id===c.mainlineStepId),d=c.detours.at(-1),stage=stages.find(s=>s.stepIds.includes(c.mainlineStepId));
  const target=d&&(d.returnTo.kind==='step'?c.steps.find(s=>s.id===d.returnTo.id):c.detours.find(s=>s.id===d.returnTo.id));
  const short=s=>s?.label||s?.title||'';
  const prior=c.steps.slice(0,c.steps.indexOf(step)).filter(s=>!s.done);
  let html='<section class="workflowFocus" aria-label="当前定位"><div class="focusLocation"><span>'+esc(stage.title)+'</span><strong>'+(c.status==='DONE'?'本次任务已完结':esc(short(step)))+'</strong></div>';
  if(d)html+='<p class="focusRepair">'+esc(d.title)+'</p><p class="focusReturn">修完返回 → '+esc(short(target)||d.returnTo.id)+'</p>';
  html+='<div class="focusNext"><span>'+(c.status==='DONE'?'完成结果':'接下来')+'</span><p>'+esc(c.status==='DONE'?c.currentAction:c.nextAction)+'</p></div>';
  if(prior.length)html+='<p class="focusPrerequisite">前序尚未完成：'+prior.map(s=>esc(short(s))).join('；')+'</p>';
  const scopeRefs=Array.isArray(c.workflow.scopeEvidenceRefs)?c.workflow.scopeEvidenceRefs:[];
  const scope=scopeRefs.filter(n=>Number.isSafeInteger(n)&&n>=0&&n<c.acceptance.length);
  if(scope.length)html+='<div class="focusScope">'+scope.map(n=>'<p>'+esc(c.acceptance[n])+'</p>').join('')+'</div>';
  const extra='<p>'+esc(c.currentAction)+'</p>'+(d?'<p>回补原因：'+esc(d.reason)+'</p><p>回补通过条件：'+esc(d.doneWhen)+'</p>':'');
  return html+readingDetails(c.id+':resume','当前依据与回补条件',extra,'focusEvidence')+'</section>';
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
  const node=e.target.closest('[data-workflow-stage]');
  if(node?.dataset?.workflowStage){
    const c=snapshot?.cards.find(c=>c.id===node.dataset.workflowCard),stage=c&&workflowStages(c)?.find(s=>s.id===node.dataset.workflowStage);
    if(!stage)return false;
    // Find within this render surface: current and history may show the same card.
    const surface=node.closest('.workflowMap');
    const detail=[...(surface?.querySelectorAll('.stageDetails')||[])].find(el=>el.dataset.viewKey===c.id+':stage:'+stage.id);
    if(!detail)return false;
    detail.open=true;detailViews.set(c.id+':stage:'+stage.id,true);rememberView();
    detail.querySelector('summary')?.focus({preventScroll:true});detail.scrollIntoView?.({block:'start',behavior:'auto'});
    return true;
  }
  const button=e.target.closest('[data-step-record],[data-step-raw],[data-step-retry]');if(!button)return false;
  const {cardId,stepId}=button.closest('.stepDetails').dataset,view=stepView(cardId,stepId);
  if(button.hasAttribute('data-step-raw')){view.rawView=!view.rawView;updateStepBody(cardId,stepId);return true;}
  if(button.hasAttribute('data-step-retry'))return loadStepRecords(cardId,stepId);
  return selectStepRecord(cardId,stepId,button.dataset.stepRecord);
}
function renderCard(c,scope='current'){
  if(c.error)return '<div class="empty"><strong>状态卡暂时无法读取</strong>'+esc(c.error)+'<p>请核对原文件，未自动重建进度。</p></div>';
  if(c.kind==='legacy'||c.kind==='catalog')return legacyCard(c);
  const step=c.steps.find(s=>s.id===c.mainlineStepId),index=c.steps.findIndex(s=>s.id===c.mainlineStepId);
  const d=c.detours.at(-1);
  const stages=workflowStages(c);
  let result='<div class="tasktop"><span>本对话的当前任务</span>'+pill(c.status)+'</div><h2>'+esc(c.title)+'</h2>';
  if(stages)result+=workflowFocus(c,stages)+renderWorkflow(c,stages,scope);
  else{
  result+='<div class="mainline"><div class="sectionlabel">主线位置</div><strong>'+ (c.status==='DONE'?'本次任务已完结':esc(step?.title||'待明确'))+'</strong><span class="small">'+(c.status==='DONE'?'验收结果已保留': '第 '+(index+1)+' 步 / 共 '+c.steps.length+' 步'+(d?' · 回补期间保留此位置':''))+'</span></div>';
  result+='<div class="doing"><div class="sectionlabel">'+(c.status==='DONE'?'完成结果':'此刻在做')+'</div><p>'+esc(c.currentAction)+'</p></div>';
  if(d){
    const target=d.returnTo.kind==='step'?c.steps.find(s=>s.id===d.returnTo.id)?.title:c.detours.find(s=>s.id===d.returnTo.id)?.title;
    result+='<aside class="detour"><div class="sectionlabel">↶ 临时回补'+(c.detours.length>1?' · 第 '+c.detours.length+' 层':'')+'</div><h3>'+esc(d.title)+'</h3><p class="return">补完返回 → '+esc(target||d.returnTo.id)+'</p>'+readingDetails(c.id+':detour:'+d.id,'为什么回补 · 完成条件','<p>原因：'+esc(d.reason)+'</p><p>补到这里就够了：'+esc(d.doneWhen)+'</p>')+'</aside>';
  }
  result+='<div class="next"><span>接下来</span><p>'+esc(c.nextAction)+'</p></div>';
  }
  const completed=c.steps.filter(s=>s.done).length;
  const steps='<p class="stepHint">点击任一步，查看完成依据与相关资料</p><ol class="steps">'+c.steps.map((s,i)=>renderStep(c,s,i)).join('')+'</ol>';
  if(!stages)result+=readingDetails(c.id+':steps','<span>步骤与资料</span><span class="stepCount">已完成 '+completed+' / '+c.steps.length+' 步</span><span class="stepChevron" aria-hidden="true">›</span>',steps,'workflowDetails');
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
    const days=[...new Set(events.map(e=>e.day))];
    html+=days.map(day=>readingDetails(c.id+':timeline:'+day,esc(day)+' · '+events.filter(e=>e.day===day).length+' 条记录','<ol class="timelineRows">'+events.filter(e=>e.day===day).map(row).join('')+'</ol>','historyDay')).join('');
  }else html+='<p class="small">'+(range.active?'该时段没有已登记的进展。':'原卡没有可靠的事件日期，时间尚待补充。')+'</p>';
  if(c.timeline?.undated)html+='<p class="small">另有 '+c.timeline.undated+' 条记录缺少有效时间。</p>';
  if(c.timeline?.fileUpdatedAt)html+='<details class="fileTimestamp"><summary>文件时间参考</summary><p class="small">文件修改于 '+esc(date(c.timeline.fileUpdatedAt))+'；不作为任务发生或完结日期。</p></details>';
  return html+'</section>';
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
function historyContents(state){
  const record=state.record,sections=state.sections||[];
  let html='<section class="historyContents" aria-label="成果与版本"><div class="historySectionHeading"><h3>成果与版本</h3><span>'+sections.length+' 个章节</span></div>';
  if(sections.length){
    html+='<p class="historyCaption">按原文标题归类；保留原版本与待审标记。</p>';
    const groups=[...new Set(sections.map(s=>s.groupId))];
    // Keep a predictable category order rather than the order of incidental file headings.
    groups.sort((a,b)=>['story','shots','assets','process','other'].indexOf(a)-['story','shots','assets','process','other'].indexOf(b));
    html+=groups.map(group=>{
      const items=sections.filter(s=>s.groupId===group);
      const body='<ul class="historyChapters">'+items.map(s=>{
        const open=state.sectionId===s.id;
        return '<li><button type="button" class="chapterButton" data-history-section="'+esc(s.id)+'" aria-expanded="'+open+'" aria-controls="history-chapter-'+esc(s.id)+'"><span><strong>'+esc(s.title)+'</strong>'+(s.summary?'<small>'+esc(s.summary)+'</small>':'')+'</span><span class="chapterChevron" aria-hidden="true">'+(open?'⌄':'›')+'</span></button><div id="history-chapter-'+esc(s.id)+'" '+(!open?'hidden':'')+'>'+(open?'<div class="chapterOrigin">原文：'+esc(record.title)+' / '+esc(s.sourceTitle)+'</div><div class="documentBody chapterBody">'+globalThis.ProgressDocument.render(s.content,record.path)+'</div>':'')+'</div></li>';
      }).join('')+'</ul>';
      return readingDetails(state.id+':contents:'+record.id+':'+group,'<span><strong>'+esc(items[0].groupTitle)+'</strong><small>'+items.length+' 项 · '+esc(items.slice(-2).map(s=>s.title).join(' / '))+'</small></span><span class="chapterChevron" aria-hidden="true">›</span>',body,'historyGroup');
    }).join('');
  }else html+='<p class="small">此文件没有可拆分的章节，保留完整原文入口。</p>';
  html+='<div class="historyOriginal"><button class="textButton" data-history-full aria-expanded="'+!!state.fullRecord+'">'+(state.fullRecord?'收起完整原文':'查看完整原文')+'</button><span>'+esc(record.title)+'</span></div>';
  if(state.fullRecord)html+=recordPreview(record,state.rawView===true,'data-toggle-source');
  return html+'</section>';
}
function renderTrace(){
  if(!selectedTrace)return;
  const state=selectedTrace,c=snapshot.cards.find(c=>c.id===state.id);if(!c)return;
  const data=state.data;
  let html='<button class="textButton backButton" data-back-history>← 返回记录列表</button><div class="tasktop"><span>本任务的记录</span>'+pill(c.status)+'</div><h2>'+esc(c.title)+'</h2><p class="historyCaption">资料按当前文件读取，不是历史快照。</p>';
  if(state.error)html+='<p role="alert" class="traceError">'+esc(state.error)+'</p><button class="textButton" data-retry-trace>重新读取档案</button>';
  else if(!data)html+='<p class="small" role="status">正在读取项目位置与相关记录…</p>';
  else {
    if(data.records.length>1||!state.record){
      html+='<div class="historyFiles" aria-label="资料文件">'+data.records.map(r=>'<button class="textButton '+(state.recordId===r.id?'selected':'')+'" data-record-id="'+esc(r.id)+'" '+(!r.readable?'disabled':'')+'>'+esc(r.title)+(!r.readable?' · '+esc(r.error||'暂不可读'):'')+'</button>').join('')+'</div>';
    }
    if(state.recordLoading)html+='<p class="small" role="status">正在读取原始记录…</p>';
    if(state.recordError)html+='<p class="traceError" role="alert">'+esc(state.recordError)+'</p>';
    if(state.record)html+=historyContents(state);
    html+=readingDetails(c.id+':history-events','进展时间记录 · '+matchingEvents(c).length+' 条',timelineView(c),'historyEvents');
    const location='<p class="sourcepath">'+esc(data.projectRoot||data.locationError||'项目目录尚未登记')+'</p>'+(data.projectRoot?'<button class="folderButton" data-open-project>打开项目文件夹 ↗</button>':'')+(state.openMessage?'<p class="small" role="status">'+esc(state.openMessage)+'</p>':'')+(state.record?'<p class="sourcepath">原始文件：'+esc(state.record.path)+'</p>':'');
    html+=readingDetails(c.id+':history-location','文件位置与来源',location,'historyLocation');
    html+='<details><summary>当前进度与验收摘要（非历史快照）</summary>'+renderCard(c,'history')+'</details>';
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
    const initial=['state','delivery','usage','entry','readme','info','contract'].map(key=>data.records.find(r=>r.id===key&&r.readable)).find(Boolean)||data.records.find(r=>r.readable);
    if(initial)await selectRecord(initial.id);
  }catch(e){if(request===traceRequest){selectedTrace.error=e.message;renderTrace();}}
}
async function selectRecord(recordId){
  const state=selectedTrace;if(!state?.data?.records.some(r=>r.id===recordId&&r.readable))return;
  const request=++recordRequest;state.recordId=recordId;state.recordLoading=true;state.record=null;state.sections=[];state.sectionId=null;state.fullRecord=false;state.recordError=null;state.rawView=false;renderTrace();
  try{
    const response=await fetch(scoped('/api/trace/'+encodeURIComponent(state.id)+'/'+encodeURIComponent(recordId)),{cache:'no-store',signal:AbortSignal.timeout(5000)});
    const record=await response.json();if(!response.ok)throw Error(record.error||'原文读取失败');
    if(selectedTrace!==state||request!==recordRequest)return;
    state.record=record;state.sections=globalThis.ProgressDocument.sections(record.content,record.path);
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
  if(e.target.closest('[data-history-full]')){selectedTrace.fullRecord=!selectedTrace.fullRecord;renderTrace();return;}
  const chapter=e.target.closest('[data-history-section]');
  if(chapter){
    const id=chapter.dataset.historySection,s=selectedTrace?.sections?.find(s=>s.id===id);if(!s)return;
    selectedTrace.sectionId=selectedTrace.sectionId===id?null:id;
    detailViews.set(selectedTrace.id+':contents:'+selectedTrace.record.id+':'+s.groupId,true);
    renderTrace();
    $('historyDetail').querySelector?.('[data-history-section="'+s.id+'"]')?.focus({preventScroll:true});
    return;
  }
  if(e.target.closest('[data-toggle-source]')){selectedTrace.rawView=!selectedTrace.rawView;renderTrace();return;}
  const record=e.target.closest('[data-record-id]');if(record)return selectRecord(record.dataset.recordId);
};
globalThis.addEventListener?.('hashchange',restoreHistory);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
refresh();setInterval(()=>{if(!document.hidden)refresh();},2500);
