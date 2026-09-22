import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {readCard} from '../scripts/card.mjs';
const code=await fs.readFile(new URL('../assets/web/app.js',import.meta.url),'utf8');
const markedCode=await fs.readFile(new URL('../assets/web/vendor/marked.umd.js',import.meta.url),'utf8');
const readerCode=await fs.readFile(new URL('../assets/web/reader.js',import.meta.url),'utf8');
import {sampleCard as original} from './fixtures.mjs';
function element(){return {innerHTML:'',textContent:'',hidden:false,value:'',checked:false,dataset:{},className:'',classList:{toggle(){}},listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}};}
async function mount(data,fetcher,bodies=[],hash='',options={}){
 const els=Object.fromEntries(['connection','notice','card','updated','count','current','history','currentTab','historyTab','historyList','historyDetail','catalogNotice','search','completedOnly','refresh','monthFilter','dateFrom','dateTo','clearDates','timeNotice'].map(id=>[id,element()]));
 const events={};
 const context=vm.createContext({document:{hidden:false,getElementById:id=>els[id],querySelectorAll:()=>bodies,addEventListener(){}},location:{pathname:'/t/'+(options.threadId||original.threadId),hash},sessionStorage:options.storage,addEventListener:(name,fn)=>{events[name]=fn;},
   fetch:fetcher?((url,options)=>fetcher(url.split('?')[0],options,url)):(async()=>({ok:true,json:async()=>structuredClone(data)})),AbortSignal,Date,URL,setInterval(){},console});
 vm.runInContext(markedCode,context);vm.runInContext(readerCode,context);
 vm.runInContext(code,context);
 await new Promise(r=>setImmediate(r));
 els.events=events;els.location=context.location;
 return els;
}
test('回补显示保留第三步和准确返回点，内容转义',async()=>{
 const c=structuredClone(original);c.status='RUNNING';c.mainlineStepId=c.steps[2].id;c.steps[0].done=true;c.steps[1].done=true;c.steps[2].done=false;
 c.title='<img src=x onerror=alert(1)>';c.detours=[{id:'source-fix',title:'回第一步补来源',reason:'来源缺口',doneWhen:'核对原始依据',returnTo:{kind:'step',id:c.steps[2].id}}];
 const els=await mount({activeId:c.id,cards:[c]});
 assert.match(els.card.innerHTML,/第 3 步/);assert.match(els.card.innerHTML,/回补期间保留此位置/);
 assert.match(els.card.innerHTML,/补完返回 → 验证回补恢复和页面显示/);
 assert.doesNotMatch(els.card.innerHTML,/<img/);assert.match(els.card.innerHTML,/&lt;img/);
});
test('历史搜索和只看完结使用原记录状态',async()=>{
 const legacy={id:'old',threadId:original.threadId,kind:'legacy',title:'旧驾驶舱',status:'REVIEW',source:'old.md'};
 const done={id:'done',threadId:original.threadId,kind:'legacy',title:'规则优化',status:'DONE',source:'done.md',currentAction:'限定规则已修改'};
 const els=await mount({activeId:original.id,cards:[original,legacy,done]});
 els.search.value='规则';els.search.listeners.input();assert.match(els.historyList.innerHTML,/规则优化/);assert.doesNotMatch(els.historyList.innerHTML,/旧驾驶舱/);
 els.search.value='';els.completedOnly.checked=true;els.completedOnly.onchange();assert.match(els.historyList.innerHTML,/规则优化/);assert.doesNotMatch(els.historyList.innerHTML,/旧驾驶舱/);
});
test('未绑定对话显示缺口而非默认第一张卡',async()=>{
 const els=await mount({activeId:null,cards:[original]});assert.match(els.card.innerHTML,/尚未绑定/);assert.doesNotMatch(els.card.innerHTML,/主线在这里/);
});
test('历史先显示目录而非整篇原文，显式阅读与快速切换不串文档',async()=>{
 const a={id:'a',threadId:original.threadId,kind:'legacy',title:'完结项目A',status:'DONE',source:'A.md'},b={id:'b',threadId:original.threadId,kind:'legacy',title:'项目B',status:'REVIEW',source:'B.md'};
 let releaseA;const pendingA=new Promise(resolve=>releaseA=resolve);
 const result=body=>({ok:true,json:async()=>body});
 const fetcher=async url=>{
   if(url.startsWith('/api/cards'))return result({activeId:original.id,cards:[original,a,b]});
   if(url==='/api/trace/a')return result({projectRoot:'D:/项目A',records:[{id:'delivery',title:'A交付记录',path:'D:/项目A/说明.md',readable:true,exists:true}]});
   if(url==='/api/trace/a/delivery'){await pendingA;return result({id:'delivery',title:'A交付记录',path:'D:/项目A/说明.md',content:'不应覆盖B的旧结果'});}
   if(url==='/api/trace/b')return result({projectRoot:'D:/项目B',records:[{id:'usage',title:'B使用说明',path:'D:/项目B/说明.md',readable:true,exists:true}]});
   return result({id:'usage',title:'B使用说明',path:'D:/项目B/说明.md',content:'<script>危险文本仅作为原文展示</script>'});
 };
 const els=await mount({},fetcher);
 const first=els.historyList.onclick({target:{closest:()=>({dataset:{id:'a'}})}});
 await new Promise(r=>setImmediate(r));
 assert.match(els.historyDetail.innerHTML,/D:\/项目A/);assert.match(els.historyDetail.innerHTML,/打开项目文件夹/);
 await els.historyList.onclick({target:{closest:()=>({dataset:{id:'b'}})}});
 releaseA();await first;
  assert.match(els.historyDetail.innerHTML,/D:\/项目B/);assert.match(els.historyDetail.innerHTML,/B使用说明/);
  assert.doesNotMatch(els.historyDetail.innerHTML,/不应覆盖B的旧结果|<script>/);
  assert.doesNotMatch(els.historyDetail.innerHTML,/危险文本仅作为原文展示/);
  els.historyDetail.onclick({target:{closest:selector=>selector==='[data-history-full]'?{}:null}});
 assert.match(els.historyDetail.innerHTML,/&lt;script&gt;/);
 assert.match(els.historyDetail.innerHTML,/阅读版/);
 els.historyDetail.onclick({target:{closest:selector=>selector==='[data-toggle-source]'?{}:null}});
 assert.match(els.historyDetail.innerHTML,/返回阅读版/);
 assert.match(els.historyDetail.innerHTML,/class="documentPlain"/);
});
test('已完成步骤可回看依据和关联资料，异步切换不串文档且不修改任务进度',async()=>{
 const c=structuredClone(original),data={activeId:c.id,cards:[c]},before=JSON.stringify(c);
 const body={dataset:{cardId:c.id,stepId:'discover'},innerHTML:''};
 const detail={dataset:body.dataset,open:true,classList:{contains:n=>n==='stepDetails'}};
 const calls=[],result=body=>({ok:true,json:async()=>body});
 let releaseOld;const old=new Promise(resolve=>releaseOld=resolve);
 const fetcher=async(url,options)=>{
   calls.push({url,method:options?.method||'GET'});
   if(url.startsWith('/api/cards'))return result(data);
   if(url==='/api/trace/'+c.id)return result({records:[
     {id:'a',title:'原方案',readable:true,exists:true,stepIds:['discover']},
     {id:'b',title:'采用理由',readable:true,exists:true,stepIds:['discover']},
     {id:'other',title:'后续步骤资料',readable:true,exists:true,stepIds:['build']}]});
   if(url.endsWith('/a')){await old;return result({id:'a',title:'原方案',path:'a.md',content:'迟到的原方案'});}
   return result({id:'b',title:'采用理由',path:'b.md',content:'# 采用理由\n\n读取**现有状态卡**。'});
 };
 const els=await mount(data,fetcher,[body]);
 assert.notEqual(els.card.onclick({target:{closest:()=>null}}),false,'Do not cancel native summary expansion');
 assert.equal((els.card.innerHTML.match(/class="stepDetails"/g)||[]).length,4);
 await els.card.listeners.toggle({target:detail});
 assert.match(body.innerHTML,/已完成/);assert.match(body.innerHTML,/示例材料/);
 assert.match(body.innerHTML,/未单列这一步的完成时间/);
 assert.match(body.innerHTML,/采用理由/);assert.doesNotMatch(body.innerHTML,/后续步骤资料/);
 const clickRecord=id=>({target:{closest:()=>({dataset:{stepRecord:id},hasAttribute:()=>false,closest:()=>detail})}});
 const pending=els.card.onclick(clickRecord('a'));
 await els.card.onclick(clickRecord('b'));releaseOld();await pending;
 assert.match(body.innerHTML,/<h1>采用理由<\/h1>/);assert.match(body.innerHTML,/<strong>现有状态卡<\/strong>/);
 assert.doesNotMatch(body.innerHTML,/迟到的原方案/);
 els.card.onclick({target:{closest:()=>({dataset:{},hasAttribute:n=>n==='data-step-raw',closest:()=>detail})}});
 assert.match(body.innerHTML,/返回阅读版/);assert.match(body.innerHTML,/class="documentPlain"/);
 // A data refresh preserves the open step and selected document.
 data.cards=[{...c,updatedAt:'2026-09-09T01:23:45Z'}];await els.refresh.onclick();
 assert.match(els.card.innerHTML,/data-step-id="discover" open/);
 assert.match(els.card.innerHTML,/第 3 步/);assert.match(els.card.innerHTML,/class="documentPlain"/);
 assert.match(els.card.innerHTML,/当前主线 · 尚未验收完成/);
 assert.match(els.card.innerHTML,/这一步尚未标记完成/);
 detail.open=false;await els.card.listeners.toggle({target:detail});
 detail.open=true;await els.card.listeners.toggle({target:detail});
 assert.equal(calls.filter(v=>v.url==='/api/trace/'+c.id).length,1);
 assert.ok(calls.every(v=>v.method==='GET'));assert.equal(JSON.stringify(c),before);
});
test('步骤资料读取失败保留完成依据，并允许重试',async()=>{
 const c=structuredClone(original),body={dataset:{cardId:c.id,stepId:'discover'},innerHTML:''};
 const detail={dataset:body.dataset,open:true,classList:{contains:()=>true}};let failed=true;
 const fetcher=async url=>{
   if(url.startsWith('/api/cards'))return {ok:true,json:async()=>({activeId:c.id,cards:[c]})};
   if(failed)throw Error('暂时断开');
   return {ok:true,json:async()=>({records:[]})};
 };
 const els=await mount({},fetcher,[body]);await els.card.listeners.toggle({target:detail});
 assert.match(body.innerHTML,/完成依据/);assert.match(body.innerHTML,/暂时断开/);
 failed=false;await els.card.onclick({target:{closest:()=>({dataset:{},hasAttribute:n=>n==='data-step-retry',closest:()=>detail})}});
 assert.match(body.innerHTML,/暂无单独关联/);assert.doesNotMatch(body.innerHTML,/暂时断开/);
});

test('即使接口混入其他对话条目，列表与旧历史深链也不能串卡',async()=>{
 const foreign={id:'foreign',threadId:'another-thread',kind:'legacy',title:'不属于本对话',status:'DONE'};
 const unbound={id:'unbound',kind:'catalog',title:'全局地图项目',status:'DONE'};
 const calls=[];
 const els=await mount({},async(url,options,raw)=>{
   calls.push(raw);
   assert.equal(new URL(raw,'http://localhost').searchParams.get('thread'),original.threadId);
   return {ok:true,json:async()=>({activeId:original.id,cards:[original,foreign,unbound]})};
 },[],'#history/foreign');
 assert.equal(els.count.textContent,1);
 assert.doesNotMatch(els.historyList.innerHTML,/不属于本对话|全局地图项目/);
 assert.equal(els.historyDetail.innerHTML,'');
 await els.historyList.onclick({target:{closest:()=>({dataset:{id:'foreign'}})}});
 assert.equal(calls.length,1,'No document read for a foreign deep link or click');
});

test('长任务按中间月份与日期边界查找，并展示该时段进展而非最新动作',async()=>{
 const long={...structuredClone(original),id:'long',title:'跨月长任务',currentAction:'九月当前动作',timeline:{events:[
   {day:'2026-07-31',label:'七月材料',summary:'七月材料核对'},
   {day:'2026-08-01',label:'八月回补',summary:'补齐八月来源'},
   {day:'2026-08-31',label:'八月验收',summary:'八月末结果'},
   {day:'2026-09-09',label:'九月动作',summary:'九月当前动作'}]}};
 const unknown={id:'unknown-date',threadId:original.threadId,kind:'legacy',title:'日期缺失的旧记录',status:'DONE',updatedAt:'2026-08-08T00:00:00Z'};
 const data={activeId:long.id,cards:[long,unknown]},result=body=>({ok:true,json:async()=>structuredClone(body)});
 const els=await mount({},async url=>url.startsWith('/api/cards')?result(data):result({projectRoot:'D:/project',records:[]}));
 assert.match(els.monthFilter.innerHTML,/2026-07/);assert.match(els.monthFilter.innerHTML,/2026-08/);
 els.monthFilter.value='2026-08';els.monthFilter.onchange();
 assert.match(els.historyList.innerHTML,/跨月长任务/);assert.match(els.historyList.innerHTML,/八月末结果/);
 assert.doesNotMatch(els.historyList.innerHTML,/九月当前动作/);
 assert.match(els.historyList.innerHTML,/不计入时段结果/);assert.match(els.timeNotice.textContent,/1 项有时间记录/);
 await els.historyList.onclick({target:{closest:()=>({dataset:{id:'long'}})}});
 assert.match(els.historyDetail.innerHTML,/所选时段的进展/);
 const timePart=els.historyDetail.innerHTML.split('<section class="taskTimeline">')[1].split('</section>')[0];
 assert.match(timePart,/补齐八月来源/);assert.match(timePart,/八月末结果/);assert.doesNotMatch(timePart,/七月材料核对|九月当前动作/);
 els.dateFrom.value='2026-08-01';els.dateTo.value='2026-08-01';els.dateFrom.onchange();
 assert.equal(els.monthFilter.value,'');assert.match(els.historyList.innerHTML,/补齐八月来源/);assert.doesNotMatch(els.historyList.innerHTML,/八月末结果/);
 els.dateFrom.value='2026-08-02';els.dateFrom.onchange();assert.match(els.timeNotice.textContent,/结束日期不能早于/);
 assert.equal(els.historyList.innerHTML,'');
 els.clearDates.onclick();assert.match(els.historyList.innerHTML,/九月当前动作/);
 assert.equal(long.mainlineStepId,original.mainlineStepId);
});

test('从历史返回当前任务后，后台进度更新和哈希导航不抢回历史页',async()=>{
 const c=structuredClone(original),data={activeId:c.id,cards:[c]};
 const els=await mount(data,undefined,[],'#history');
 assert.equal(els.history.hidden,false);
 els.currentTab.onclick();assert.equal(els.current.hidden,false);
 data.cards[0]={...c,revision:c.revision+1,currentAction:'新的实际动作'};
 await els.refresh.onclick();
 assert.equal(els.current.hidden,false);assert.equal(els.history.hidden,true);
 assert.match(els.card.innerHTML,/新的实际动作/);
 els.location.hash='#history';els.events.hashchange();assert.equal(els.history.hidden,false);
 els.location.hash='#current';els.events.hashchange();assert.equal(els.current.hidden,false);
});

test('展开状态与筛选仅按对话保存，刷新恢复视图但不保存或修改任务正文',async()=>{
 const stored=new Map(),storage={getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)};
 const c={...structuredClone(original),timeline:{events:[{day:'2026-09-09',label:'材料核对',summary:'保留资料依据'}]}},before=JSON.stringify(c);
 const data={activeId:c.id,cards:[c]};
 const els=await mount(data,undefined,[],'',{storage});
 assert.match(els.card.innerHTML,/步骤与资料/);
 assert.ok(els.card.innerHTML.indexOf('接下来')<els.card.innerHTML.indexOf('步骤与资料'));
 const key=c.id+':steps';
 await els.card.listeners.toggle({target:{dataset:{viewKey:key},open:true,classList:{contains:()=>false}}});
 data.cards=[{...c,revision:c.revision+1}];await els.refresh.onclick();
 assert.ok(els.card.innerHTML.includes('data-view-key="'+key+'" open'));
 els.historyTab.onclick();els.monthFilter.value='2026-09';els.monthFilter.onchange();
 els.search.value='材料';els.search.listeners.input();
 const reloaded=await mount(data,undefined,[],'',{storage});
 assert.equal(reloaded.history.hidden,false);assert.equal(reloaded.monthFilter.value,'2026-09');assert.equal(reloaded.search.value,'材料');
 assert.ok(reloaded.card.innerHTML.includes('data-view-key="'+key+'" open'));
 reloaded.dateFrom.value='2026-09-09';reloaded.dateTo.value='2026-09-09';reloaded.dateFrom.onchange();
 const dates=await mount(data,undefined,[],'',{storage});
 assert.equal(dates.monthFilter.value,'');assert.equal(dates.dateFrom.value,'2026-09-09');assert.equal(dates.dateTo.value,'2026-09-09');
 const anotherId='33333333-3333-4333-8333-333333333333';
 const another=await mount({activeId:null,cards:[]},undefined,[],'',{storage,threadId:anotherId});
 assert.equal(another.monthFilter.value,'');assert.equal(another.search.value,'');assert.equal(another.dateFrom.value,'');
 const saved=JSON.parse(stored.get('progress-card-view-v1:'+c.threadId));
 assert.deepEqual(Object.keys(saved).sort(),['completed','details','from','month','search','tab','to']);
 assert.equal(JSON.stringify(c),before);assert.doesNotMatch(JSON.stringify(saved),/currentAction|mainlineStepId|source|acceptance/);
});

test('浏览器存储被禁用时仍可查看进度和筛选，不借用别的任务',async()=>{
 const storage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
 const els=await mount({activeId:original.id,cards:[original]},undefined,[],'',{storage});
 assert.match(els.card.innerHTML,/主线位置/);assert.equal(els.notice.hidden,true);
 els.historyTab.onclick();els.search.value='不存在的任务';els.search.listeners.input();
 assert.match(els.historyList.innerHTML,/没有找到匹配记录/);
});

function stagedCard(){
 const c=structuredClone(original);
 c.status='REVIEW';c.mainlineStepId=c.steps[2].id;c.detours=[];
 c.steps.forEach((s,i)=>s.done=i===0);
 c.workflow={stages:[
   {id:'plan',title:'故事与规格',summary:'先明确边界',stepIds:[c.steps[0].id]},
   {id:'assets',title:'资产准备',summary:'只准备当批资产',stepIds:[c.steps[1].id,c.steps[2].id]},
   {id:'delivery',title:'成片交付',stepIds:[c.steps[3].id]}
 ]};
 c.steps[2].label='P03 示例资产检查';
 c.steps[2].work={categories:[{title:'四视图一致性',items:['示例多视图对应','保留已确认结构']}],output:'选定资产与验收记录',doneWhen:'用户确认且结构检查通过',returnPoint:'仅返回局部返修'};
 return c;
}
function detailsOpen(html,key){
 const tag=(html.match(/<details\b[^>]*>/g)||[]).find(tag=>tag.includes('data-view-key="'+key+'"'));
 return !!tag&&/\bopen(?:\s|>)/.test(tag);
}

test('阶段箭头图显示所有步骤、唯一当前位置，默认仅展开当前阶段',async()=>{
 const c=stagedCard(),before=JSON.stringify(c),els=await mount({activeId:c.id,cards:[c]});
 const html=els.card.innerHTML;
 assert.match(html,/整体制作流程/);
 assert.equal((html.match(/class="workflowStage /g)||[]).length,3);
 assert.equal((html.match(/class="stageConnector"/g)||[]).length,2);
 assert.equal((html.match(/class="stepDetails"/g)||[]).length,4);
 assert.equal((html.match(/aria-current="step"/g)||[]).length,1);
 assert.match(html,/当前在第 2 阶段/);
 assert.equal(detailsOpen(html,c.id+':stage:assets'),true);
 assert.equal(detailsOpen(html,c.id+':stage:plan'),false);
 assert.match(html,/P03 示例资产检查/);
 assert.match(html,/四视图一致性/);assert.match(html,/示例多视图对应/);
 assert.match(html,/交付物/);assert.match(html,/通过条件/);assert.match(html,/不合格返回/);
 assert.equal((html.match(/步骤与资料/g)||[]).length,0,'Do not duplicate the flat workflow');
 assert.equal(JSON.stringify(c),before);
});

test('阶段及其子步骤展开只改变阅读状态，刷新保留且资料请求只读',async()=>{
 const c=stagedCard(),before=JSON.stringify(c),data={activeId:c.id,cards:[c]},calls=[];
 const body={dataset:{cardId:c.id,stepId:c.steps[2].id},innerHTML:''};
 const els=await mount(data,async(url,options)=>{calls.push(options?.method||'GET');return {ok:true,json:async()=>url.startsWith('/api/cards')?structuredClone(data):{records:[]}};},[body]);
 const stageKey=c.id+':stage:assets';
 await els.card.listeners.toggle({target:{dataset:{viewKey:stageKey},open:false,classList:{contains:()=>false}}});
 data.cards[0]={...c,revision:c.revision+1};await els.refresh.onclick();
 assert.equal(detailsOpen(els.card.innerHTML,stageKey),false);
 await els.card.listeners.toggle({target:{dataset:{viewKey:stageKey},open:true,classList:{contains:()=>false}}});
 const step={dataset:body.dataset,open:true,classList:{contains:name=>name==='stepDetails'}};
 await els.card.listeners.toggle({target:step});
 assert.match(body.innerHTML,/四视图一致性/);assert.match(body.innerHTML,/暂无单独关联/);
 data.cards[0]={...c,revision:c.revision+2};await els.refresh.onclick();
 assert.equal(detailsOpen(els.card.innerHTML,stageKey),true);
 assert.ok(els.card.innerHTML.includes('data-step-id="'+step.dataset.stepId+'" open'));
 assert.ok(calls.every(method=>method==='GET'));assert.equal(JSON.stringify(c),before);
});

test('阶段分组缺失、重复、错序时回退完整清单，不隐去任何步骤',async()=>{
 for(const change of [c=>c.workflow.stages.pop(),c=>c.workflow.stages[2].stepIds=[c.steps[0].id],c=>c.workflow.stages.reverse()]){
   const c=stagedCard();change(c);
   const els=await mount({activeId:c.id,cards:[c]});
   assert.doesNotMatch(els.card.innerHTML,/class="workflowMap"/);
   assert.match(els.card.innerHTML,/步骤与资料/);
   assert.equal((els.card.innerHTML.match(/class="stepDetails"/g)||[]).length,4);
 }
});

test('阶段和工作类目文本全部转义，已完结任务不显示当前节点',async()=>{
 const c=stagedCard();c.workflow.stages[0].title='<img src=x onerror=alert(1)>';
 c.steps[2].label='<script>bad()</script>';c.steps[2].work.categories[0].items=['<iframe>bad</iframe>'];
 c.status='DONE';c.steps.forEach(s=>s.done=true);
 const els=await mount({activeId:c.id,cards:[c]});
 assert.doesNotMatch(els.card.innerHTML,/<img|<script|<iframe|aria-current="step"/);
 assert.match(els.card.innerHTML,/&lt;img/);assert.match(els.card.innerHTML,/&lt;iframe/);
 assert.match(els.card.innerHTML,/全部完成/);
});

test('定位摘要、完整箭头总览、工作细目按序呈现，不以当前位置推定前置已完成',async()=>{
 const c=stagedCard();
 c.steps[1].label='P02 待审规格';
 c.nextAction='先审Prompt及单张范围，尚未再次生成。';
 c.detours=[{id:'r01',title:'R01 局部返修',reason:'局部结构未通过',doneWhen:'同一身体结构',returnTo:{kind:'step',id:c.mainlineStepId}}];
 c.acceptance.push('P04/P05可做文字准备，不自动放行生成。');
 c.workflow.scopeEvidenceRefs=[c.acceptance.length-1,999,-1,'0'];
 const before=JSON.stringify(c),els=await mount({activeId:c.id,cards:[c]}),html=els.card.innerHTML;
 assert.ok(html.indexOf('class="workflowFocus"')<html.indexOf('class="workflowMap"'));
 assert.ok(html.indexOf('class="workflowStages"')<html.indexOf('class="workflowDrilldown"'));
 const overview=html.split('<ol class="workflowStages">')[1].split('<section class="workflowDrilldown"')[0];
 assert.equal((overview.match(/class="stageNode"/g)||[]).length,3);
 assert.doesNotMatch(overview,/<details|class="stepBody"/);
 assert.match(html,/前序尚未完成：P02 待审规格/);
 assert.match(html,/修完返回 → P03 示例资产检查/);
 assert.match(html,/P04\/P05可做文字准备，不自动放行生成/);
 assert.equal((html.match(/class="pill REVIEW"/g)||[]).length,1);
 assert.equal(detailsOpen(html,c.id+':work:'+c.mainlineStepId+':0'),false);
 assert.equal(detailsOpen(html,c.id+':acceptance:'+c.mainlineStepId),false);
 assert.equal(detailsOpen(html,c.id+':records:'+c.mainlineStepId),false);
 assert.ok(html.includes('data-step-id="'+c.mainlineStepId+'" open'));
 assert.equal(JSON.stringify(c),before);
});

test('流程节点只在本渲染区域展开对应阶段、移动焦点与滚动，不修改主线或发出写请求',async()=>{
 const c=stagedCard(),before=JSON.stringify(c),calls=[];
 const els=await mount({},async(url,options)=>{calls.push(options?.method||'GET');return {ok:true,json:async()=>({activeId:c.id,cards:[c]})};});
 let focused=0,scrolled=0;
 const detail={dataset:{viewKey:c.id+':stage:delivery'},open:false,querySelector:()=>({focus(){focused++;}}),scrollIntoView(){scrolled++;}};
 const other={dataset:{viewKey:c.id+':stage:assets'},open:false};
 const surface={querySelectorAll:()=>[other,detail]};
 const node={dataset:{workflowStage:'delivery',workflowCard:c.id},closest:()=>surface};
 const click=()=>els.card.onclick({target:{closest:selector=>selector==='[data-workflow-stage]'?node:null}});
 click();
 assert.equal(detail.open,true);assert.equal(other.open,false);assert.equal(focused,1);assert.equal(scrolled,1);
 assert.equal(JSON.stringify(c),before);assert.ok(calls.every(method=>method==='GET'));
 node.dataset.workflowStage='missing';click();assert.equal(focused,1);
 node.dataset.workflowStage='delivery';node.dataset.workflowCard='foreign';click();assert.equal(focused,1);
});

test('当前与历史重复呈现同一张卡时定位目标ID分开，历史状态不冒充快照',async()=>{
 const c=stagedCard();
 const els=await mount({},async url=>({ok:true,json:async()=>url.startsWith('/api/cards')?{activeId:c.id,cards:[c]}:{projectRoot:'D:/known',records:[]}}));
 await els.historyList.onclick({target:{closest:()=>({dataset:{id:c.id}})}});
 const current=[...els.card.innerHTML.matchAll(/aria-controls="([^"]+)"/g)].map(m=>m[1]);
 const history=[...els.historyDetail.innerHTML.matchAll(/aria-controls="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(current.length,3);assert.equal(history.length,3);
 assert.equal(new Set([...current,...history]).size,6);
 assert.match(els.historyDetail.innerHTML,/当前进度与验收摘要（非历史快照）/);
 for(const id of history)assert.ok(els.historyDetail.innerHTML.includes('id="'+id+'"'));
});

test('长历史按内容分组，默认折叠；缺失目录不显示大占位或无效按钮',async()=>{
 const c=stagedCard(),before=JSON.stringify(c),calls=[];
 const record={id:'state',title:'原始状态卡',path:'D:/source.md',content:'# 记录\n\n## 1. 统一分镜v4｜待审\n\n剧情摘要。\n\n完整剧情在这里。\n\n## 2. 示例返修Prompt\n\n返修摘要。\n\n另一章节的完整正文。\n\n## 3. <img src=x onerror=bad()>\n\n危险标题仅文本。'};
 const els=await mount({},async(url,options)=>{
   calls.push(options?.method||'GET');
   return {ok:true,json:async()=>url.startsWith('/api/cards')?{activeId:c.id,cards:[c]}:url.endsWith('/state')?record:{projectRoot:null,locationError:'此记录尚未登记项目位置',records:[{...record,content:undefined,readable:true,exists:true}]}};
 });
 const currentHtml=els.card.innerHTML;
 await els.historyList.onclick({target:{closest:()=>({dataset:{id:c.id}})}});
 let html=els.historyDetail.innerHTML;
 assert.match(html,/成果与版本|剧本与故事|资产与提示词/);
 assert.doesNotMatch(html,/class="projectLocation"|data-open-project|class="recordPreview"|完整剧情在这里|另一章节的完整正文|<img/);
 assert.match(html,/&lt;img/);
 assert.equal(detailsOpen(html,c.id+':contents:state:story'),false);
 assert.ok(html.indexOf('成果与版本')<html.indexOf('进展时间记录'));
 const clickSection=id=>els.historyDetail.onclick({target:{closest:selector=>selector==='[data-history-section]'?{dataset:{historySection:id}}:null}});
 clickSection('section-0');html=els.historyDetail.innerHTML;
 assert.match(html,/完整剧情在这里/);assert.doesNotMatch(html,/另一章节的完整正文/);
 assert.equal(detailsOpen(html,c.id+':contents:state:story'),true);
 clickSection('section-1');html=els.historyDetail.innerHTML;
 assert.doesNotMatch(html,/完整剧情在这里/);assert.match(html,/另一章节的完整正文/);
 clickSection('section-1');assert.doesNotMatch(els.historyDetail.innerHTML,/另一章节的完整正文/);
 els.historyDetail.onclick({target:{closest:selector=>selector==='[data-history-full]'?{}:null}});
 assert.match(els.historyDetail.innerHTML,/完整剧情在这里/);assert.match(els.historyDetail.innerHTML,/另一章节的完整正文/);
 assert.equal(els.card.innerHTML,currentHtml);assert.equal(JSON.stringify(c),before);assert.ok(calls.every(m=>m==='GET'));
});

test('历史时间记录按真实日期折叠且不把文件时间当成事件日期',async()=>{
 const c={...structuredClone(original),timeline:{fileUpdatedAt:'2026-09-22T00:00:00Z',undated:1,events:[
   {day:'2026-09-20',label:'初稿',summary:'写下第一版'},
   {day:'2026-09-21',label:'修订',summary:'修改第二版'},
   {day:'2026-09-21',label:'核验',summary:'检查来源'}]}};
 const els=await mount({},async url=>({ok:true,json:async()=>url.startsWith('/api/cards')?{activeId:c.id,cards:[c]}:{records:[]}}));
 await els.historyList.onclick({target:{closest:()=>({dataset:{id:c.id}})}});
 const html=els.historyDetail.innerHTML;
 assert.match(html,/2026-09-21 · 2 条记录/);assert.match(html,/2026-09-20 · 1 条记录/);
 assert.equal(detailsOpen(html,c.id+':history-events'),false);
 assert.equal(detailsOpen(html,c.id+':timeline:2026-09-21'),false);
 assert.doesNotMatch(html,/2026-09-22 · \d+ 条记录/);assert.match(html,/1 条记录缺少有效时间/);
});
