import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCard} from '../scripts/card.mjs';
import {resolveEntry} from '../scripts/entry.mjs';

const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const run=path.join(path.dirname(fileURLToPath(import.meta.url)),'.runs','entry-'+Date.now()+'-'+process.pid);
await fs.mkdir(run,{recursive:true});
async function registry(name,entries,active={}){
  const registryPath=path.join(run,name+'.json');
  await fs.writeFile(registryPath,JSON.stringify({entries,active}));return registryPath;
}
const source=path.join(run,'card.md');
await createCard(source,{id:'a-card',threadId:a,title:'明确关联的任务',goal:'跟随正确对话',
  steps:[{id:'verify',title:'验收',done:false}],mainlineStepId:'verify',acceptance:['不串卡']});
const entry={id:'a-card',threadId:a,title:'明确关联的任务',kind:'card',source};

test('只核对当前对话的原卡，其他对话缺失的源文件不影响接入',async()=>{
 const registryPath=await registry('scope',[entry,{id:'foreign',threadId:b,kind:'card',source:path.join(run,'missing.md')}],{[a]:entry.id,[b]:'foreign'});
 const before=await fs.readFile(source,'utf8'),indexBefore=await fs.readFile(registryPath,'utf8');
 const result=await resolveEntry({threadId:a,registryPath});
 assert.equal(result.binding,'active');assert.equal(result.mainlineStepId,'verify');assert.equal(result.url,'http://127.0.0.1:43128/t/'+a+'#current');
 assert.deepEqual(result.records.map(r=>r.id),[entry.id]);
 assert.equal(await fs.readFile(source,'utf8'),before);assert.equal(await fs.readFile(registryPath,'utf8'),indexBefore);
});
test('只有历史时打开历史入口，不把旧卡变成当前任务或重读旧正文',async()=>{
 const registryPath=await registry('history',[{id:'old',threadId:b,kind:'legacy',title:'旧任务',source:path.join(run,'not-read.md')}]);
 const before=await fs.readFile(registryPath,'utf8');
 const result=await resolveEntry({threadId:b,registryPath});
 assert.equal(result.binding,'history-only');assert.equal(result.activeId,null);assert.match(result.url,/#history$/);
 assert.equal(await fs.readFile(registryPath,'utf8'),before);
});
test('未登记或缺少真实对话身份，不借用唯一一张现有卡',async()=>{
 const registryPath=await registry('unknown',[entry],{[a]:entry.id});
 const result=await resolveEntry({threadId:b,registryPath});
 assert.equal(result.binding,'unregistered');assert.equal(result.url,null);assert.deepEqual(result.records,[]);
 await assert.rejects(resolveEntry({registryPath}),/可信的当前对话ID/);
});
test('当前指针跨对话、重复ID、原卡身份矛盾均停止接入',async()=>{
 const cross=await registry('cross',[entry],{[b]:entry.id});
 await assert.rejects(resolveEntry({threadId:b,registryPath:cross}),/不属于本对话/);
 const duplicate=await registry('duplicate',[entry,entry],{[a]:entry.id});
 await assert.rejects(resolveEntry({threadId:a,registryPath:duplicate}),/重复记录ID/);
 const mismatch=await registry('mismatch',[{...entry,threadId:b}],{[b]:entry.id});
 await assert.rejects(resolveEntry({threadId:b,registryPath:mismatch}),/身份不一致/);
});
test('当前源文件失效时报错，不返回看似就绪的入口',async()=>{
 const registryPath=await registry('missing',[{...entry,source:path.join(run,'gone.md')}],{[a]:entry.id});
 await assert.rejects(resolveEntry({threadId:a,registryPath}),/ENOENT/);
});
test('旧格式当前卡沿用原文和状态，读取不迁移',async()=>{
 const legacySource=path.join(run,'legacy.md'),text='# 原卡\n\n| 当前状态 | REVIEW |\n';
 await fs.writeFile(legacySource,text);
 const registryPath=await registry('legacy',[{...entry,kind:'legacy',source:legacySource}],{[a]:entry.id});
 const result=await resolveEntry({threadId:a,registryPath});
 assert.equal(result.status,'REVIEW');assert.equal(result.binding,'active');assert.equal(await fs.readFile(legacySource,'utf8'),text);
});
