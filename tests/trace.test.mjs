import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {traceProject,readRecord} from '../scripts/trace.mjs';
const run=path.join(path.dirname(fileURLToPath(import.meta.url)),'.runs','trace-'+Date.now());
const project=path.join(run,'project');
await fs.mkdir(project,{recursive:true});
const state=path.join(project,'state.md'),outside=path.join(run,'outside.md'),large=path.join(project,'large.md'),script=path.join(project,'example.ps1');
await fs.writeFile(state,'# 原始任务状态');
await fs.writeFile(outside,'不得通过项目相关记录读取');
await fs.writeFile(large,'x'.repeat(512*1024+1));
await fs.writeFile(script,'Write-Output test');
const entry={id:'test',title:'档案测试',source:state,projectRoot:project,records:[
 {id:'missing',title:'已失效链接',path:path.join(project,'missing.md')},
 {id:'outside',title:'范围外记录',path:outside},
 {id:'large',title:'大文件',path:large},
 {id:'script',title:'脚本',path:script}
]};
test('失效路径不会丢失整张档案，大文件和可执行脚本不会被直接读取',async()=>{
 const data=await traceProject(entry);
 assert.equal(data.records.find(r=>r.id==='state').exists,true);
 assert.equal(data.records.find(r=>r.id==='missing').exists,false);
 assert.equal(data.records.find(r=>r.id==='outside').exists,false);
 assert.equal(data.records.find(r=>r.id==='large').readable,false);
 assert.equal(data.records.find(r=>r.id==='script').readable,false);
 await assert.rejects(readRecord(entry,'outside'),e=>e.status===403);
 await assert.rejects(readRecord(entry,'large'),e=>e.status===413);
 await assert.rejects(readRecord(entry,'script'),e=>e.status===415);
 assert.equal((await readRecord(entry,'state')).content,'# 原始任务状态');
});

