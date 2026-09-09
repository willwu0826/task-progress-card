import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
import {createServer} from '../scripts/server.mjs';
import {createCard,updateCard,readCard} from '../scripts/card.mjs';
import {bindCard} from '../scripts/bind.mjs';
import {resolveEntry} from '../scripts/entry.mjs';
import {sampleCard,threadA,threadB} from './fixtures.mjs';

const run=path.join(path.dirname(fileURLToPath(import.meta.url)),'.runs','server-'+Date.now()+'-'+process.pid);
await fs.mkdir(run,{recursive:true});
const registryPath=path.join(run,'registry.json');
const a=path.join(run,'a.md'),b=path.join(run,'b.md'),history=path.join(run,'history.md'),record=path.join(run,'delivery.md');
await createCard(a,{...sampleCard,revision:0,id:'a'});await createCard(b,{...sampleCard,revision:0,id:'b',threadId:threadB});
await fs.writeFile(history,'# 已完结示例\n\n| 当前状态 | DONE |\n');
await fs.writeFile(record,'# 交付说明\n\n原始资料可以追溯。');
await fs.writeFile(registryPath,JSON.stringify({version:1,active:{[threadA]:'a',[threadB]:'b'},entries:[
  {id:'a',threadId:threadA,kind:'card',title:'任务A',source:a,projectRoot:run},
  {id:'old',threadId:threadA,kind:'legacy',title:'已完结任务',source:history,projectRoot:run,records:[{id:'delivery',title:'交付说明',path:record}]},
  {id:'b',threadId:threadB,kind:'card',title:'任务B',source:b,projectRoot:run}
]}));

test('独立数据目录中的服务、绑定与恢复',async t=>{
  const opened=[];const server=createServer({registryPath,openDirectory:async folder=>opened.push(folder)});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port;
  const scoped=route=>base+route+'?thread='+threadA;
  await t.test('各对话只返回自己的卡，无身份不返回全项目',async()=>{
    const body=await(await fetch(scoped('/api/cards'))).json();
    assert.equal(body.activeId,'a');assert.deepEqual(body.cards.map(x=>x.id),['a','old']);
    assert.equal(body.cards[1].status,'DONE');assert.deepEqual(body.cards[1].timeline.events,[]);
    const other=await(await fetch(base+'/api/cards?thread='+threadB)).json();assert.deepEqual(other.cards.map(x=>x.id),['b']);
    assert.deepEqual((await(await fetch(base+'/api/cards')).json()).cards,[]);
  });
  await t.test('卡片变化由页面重新读取，查看不写原卡',async()=>{
    const before=await readCard(a);await updateCard(a,before.revision,{type:'setAction',text:'示例进入新的核对步骤'});
    const snapshot=await fs.readFile(a,'utf8');
    const body=await(await fetch(scoped('/api/cards'))).json();assert.equal(body.cards[0].currentAction,'示例进入新的核对步骤');
    const source=await fetch(scoped('/api/source/a'));assert.equal(source.status,200);assert.equal(await source.text(),snapshot);
    assert.equal(await fs.readFile(a,'utf8'),snapshot);
  });
  await t.test('其他对话的卡与档案不能通过本对话地址读取',async()=>{
    for(const route of ['/api/source/b','/api/trace/b','/api/trace/b/state'])assert.equal((await fetch(scoped(route))).status,404);
  });
  await t.test('历史档案可追溯已登记原文',async()=>{
    const trace=await(await fetch(scoped('/api/trace/old'))).json();assert.ok(trace.records.every(x=>x.exists));
    const doc=await(await fetch(scoped('/api/trace/old/delivery'))).json();assert.match(doc.content,/原始资料可以追溯/);
  });
  await t.test('同源边界、任意文件、写入和目录副作用受到限制',async()=>{
    assert.equal((await fetch(base+'/api/cards',{headers:{Origin:'https://example.com'}})).status,403);
    assert.equal((await fetch(base+'/api/cards',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
    assert.equal((await fetch(base+'/api/cards',{method:'POST'})).status,405);
    assert.equal((await fetch(base+'/registry.json')).status,404);
    const status=await new Promise((resolve,reject)=>http.get(base+'/health',{headers:{Host:'example.com'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject));assert.equal(status,403);
    const endpoint=scoped('/api/open-project/old'),headers={Origin:base,'X-Progress-Action':'open-project'};
    assert.equal((await fetch(endpoint,{method:'POST'})).status,403);
    assert.equal((await fetch(endpoint,{method:'POST',headers,body:'arbitrary path'})).status,400);
    assert.equal(opened.length,0);assert.equal((await fetch(endpoint,{method:'POST',headers})).status,200);assert.deepEqual(opened,[run]);
  });
  await t.test('关闭页面后入口仍可恢复，端口与数据目录可配置',async()=>{
    const result=await resolveEntry({threadId:threadA,registryPath,port:server.address().port});
    assert.equal(result.source,a);assert.equal(result.url,base+'/t/'+threadA+'#current');
    const page=await fetch(result.url);assert.equal(page.status,200);assert.match(await page.text(),/本对话记录/);
  });
  await t.test('重复绑定不丢导航，未完结指针不能被替换',async()=>{
    const existing=JSON.parse(await fs.readFile(registryPath,'utf8')).entries[1];
    const originalBytes=await fs.readFile(registryPath,'utf8');
    const active=JSON.parse(originalBytes).entries[0];
    await bindCard({...active,registryPath});assert.equal(await fs.readFile(registryPath,'utf8'),originalBytes);
    const newFile=path.join(run,'new.md');await createCard(newFile,{...sampleCard,revision:0,id:'new'});
    await assert.rejects(bindCard({kind:'card',source:newFile,threadId:threadA,id:'new',title:'不能抢占',registryPath}),/unfinished/);
    assert.equal(await fs.readFile(registryPath,'utf8'),originalBytes);
    assert.equal(existing.records.length,1);
  });
  await t.test('同一 legacy 原卡不能换一个 ID 绑定到另一对话',async()=>{
    const before=await fs.readFile(registryPath,'utf8');
    await assert.rejects(bindCard({kind:'legacy',source:history,threadId:'44444444-4444-4444-8444-444444444444',id:'alias',title:'别名',registryPath}),/already bound/);
    assert.equal(await fs.readFile(registryPath,'utf8'),before);
  });
  await t.test('原卡身份变化后，原文和档案接口同样拒绝返回错误卡片',async()=>{
    const before=await fs.readFile(a,'utf8');
    try {
      await fs.writeFile(a,await fs.readFile(b,'utf8'));
      const cards=await(await fetch(scoped('/api/cards'))).json();assert.ok(cards.cards[0].error);
      for(const route of ['/api/source/a','/api/trace/a','/api/trace/a/state'])assert.equal((await fetch(scoped(route))).status,409);
    } finally {await fs.writeFile(a,before);}
  });
});
