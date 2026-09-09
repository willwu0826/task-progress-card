import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
const context=vm.createContext({URL});
vm.runInContext(await fs.readFile(new URL('../assets/web/vendor/marked.umd.js',import.meta.url),'utf8'),context);
vm.runInContext(await fs.readFile(new URL('../assets/web/reader.js',import.meta.url),'utf8'),context);
const render=context.ProgressDocument.render;
test('示例交付文档渲染成标题、表格与逐行栏目',async()=>{
 const source='# Codex 工作规则适配落地说明\n\n| 规则组 | 原问题与本批修改 | 预期作用 |\n|---|---|---|\n| 模型与实际入口 | 使用示例入口 | 可以恢复 |\n\n- 保存原记录\n- 保留验收依据';
 const html=render(source,'落地说明.md');
 assert.match(html,/<h1>Codex 工作规则适配落地说明<\/h1>/);
 assert.match(html,/<table>/);assert.match(html,/data-label="原问题与本批修改"/);
 assert.match(html,/<td data-label="规则组">模型与实际入口<\/td>/);
 assert.doesNotMatch(html,/\|---\|---\|---\|/);
 assert.match(html,/<ul>/);
});
test('保留强调、编号列表、中文路径和含竖线的代码表格单元',()=>{
 const source='# 标题\n\n**重点**\n\n1. 第一项\n2. 第二项\n\n| 路径 | 内容 |\n|---|---|\n| `D:\\项目\\源.md` | `A\\|B` |';
 const html=render(source,'test.md');
 assert.match(html,/<strong>重点<\/strong>/);assert.match(html,/<ol>/);
 assert.match(html,/D:\\项目\\源.md/);assert.match(html,/A\|B/);
});
test('原始HTML、脚本链接与图片不作为可执行内容插入',()=>{
 const html=render('<script>alert(1)</script>\n\n[坏链接](javascript:alert%281%29)\n\n![图](https://example.com/track.png)\n\n<img src=x onerror=alert(1)>\n\n[正常资料](https://example.com/docs)','test.md');
 assert.doesNotMatch(html,/<script|<img|href="javascript:/i);
 assert.match(html,/&lt;script&gt;/);
 assert.match(html,/href="https:\/\/example.com\/docs"/);
});
test('原始数据默认折叠，代码中的HTML仍然转义',()=>{
 const html=render('```json\n{"text":"<img src=x>"}\n```','state.md');
 assert.match(html,/<details class="documentCode"><summary>原始数据/);
 assert.doesNotMatch(html,/<details[^>]* open|<img/);
 assert.match(html,/&lt;img src=x&gt;/);
});
test('文档属性不冒充标题，非Markdown原文保持文本',()=>{
 const html=render('---\nstatus: DONE\n---\n# 正文\n说明','note.md');
 assert.match(html,/文档属性/);assert.match(html,/<h1>正文/);
 assert.equal(render('<b>文字</b>','note.txt'),'<pre class="documentPlain">&lt;b&gt;文字&lt;/b&gt;</pre>');
});

