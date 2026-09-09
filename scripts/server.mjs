import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCard } from './card.mjs';
import { traceProject, readRecord, openProject } from './trace.mjs';
import { legacyFields, readSmallText } from './catalog.mjs';
import { cardTimeline, legacyTimeline } from './timeline.mjs';
import {registryFile, readRegistry, servicePort} from './paths.mjs';
export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function requireIdentity(entry) {
  if(entry.kind==='card') {
    const card=await readCard(entry.source);
    if(card.id!==entry.id||card.threadId!==entry.threadId) {
      const error=new Error('绑定与原状态卡身份不一致，停止读取原文');error.status=409;throw error;
    }
  }
}
async function project(entry) {
  try {
    if(entry.kind === 'card') {
      const card = await readCard(entry.source);
      if(card.id !== entry.id || card.threadId !== entry.threadId) throw Error('绑定与原状态卡不一致');
      return {...card,kind:'card',source:entry.source,timeline:cardTimeline({...card,source:entry.source})};
    }
    if(!entry.source)return {...entry,status:'UNKNOWN',noState:true,currentAction:'已找到项目位置，尚未发现唯一状态卡。',goal:'可查看项目资料；不从目录或旧产物推断当前进度。'};
    const {text,stat}=await readSmallText(entry.source);
    return {...entry,...legacyFields(text),updatedAt:stat.mtime.toISOString(),timeline:legacyTimeline(text,entry.source,stat.mtime.toISOString()),sourceNote:'直接读取原状态卡；文件修改时间不等于业务验收时间。'};
  } catch(e) { return {...entry,status:'UNKNOWN',error:e.message}; }
}
export function createServer(options={}) {
  const file=options.registryPath || registryFile();
  const getRegistry=()=>readRegistry(file);
  const getEntries=async thread=>(await getRegistry()).entries.filter(e=>thread && e.threadId===thread);
  return http.createServer(async(req,res)=>{
    const base = 'http://127.0.0.1:'+req.socket.localPort;
    const host = req.headers.host;
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
      'Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"};
    const send=(code,body,type='application/json; charset=utf-8')=>{
      res.writeHead(code,{...headers,'Content-Type':type});res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));
    };
    if(host !== '127.0.0.1:'+req.socket.localPort) return send(403,{error:'仅允许本机回环地址'});
    if(req.headers.origin && req.headers.origin !== base) return send(403,{error:'来源不匹配'});
    if(req.headers['sec-fetch-site']==='cross-site') return send(403,{error:'不接受跨站访问'});
    try {
      const url=new URL(req.url,base);
      const thread=url.searchParams.get('thread');
      if(thread!==null && !/^[a-f0-9-]{36}$/.test(thread))return send(400,{error:'对话编号无效'});
      if(req.method==='POST' && url.pathname.startsWith('/api/open-project/')){
        if(req.headers.origin!==base||req.headers['x-progress-action']!=='open-project')return send(403,{error:'请从项目档案中的按钮打开目录'});
        if(req.headers['transfer-encoding'] || Number(req.headers['content-length']||0)>0)return send(400,{error:'不接受目录或命令参数'});
        const id=decodeURIComponent(url.pathname.slice('/api/open-project/'.length));
        const entry=(await getEntries(thread)).find(e=>e.id===id);
        if(!entry)return send(404,{error:'未登记的项目'});
        return send(200,await openProject(entry,options.openDirectory));
      }
      if(req.method !== 'GET' && req.method !== 'HEAD') return send(405,{error:'面板不接受内容写入'});
      if(url.pathname.startsWith('/api/trace/')){
        const parts=url.pathname.slice('/api/trace/'.length).split('/').map(decodeURIComponent);
        if(parts.length>2)return send(404,{error:'记录不存在'});
        const entry=(await getEntries(thread)).find(e=>e.id===parts[0]);
        if(!entry)return send(404,{error:'未登记的项目'});
        await requireIdentity(entry);
        return send(200,parts.length===1?await traceProject(entry):await readRecord(entry,parts[1]));
      }
      if(url.pathname==='/health') return send(200,{app:'task-progress-card',version:3});
      if(url.pathname==='/api/cards') {
        const registry=await getRegistry();
        const entries=registry.entries.filter(e=>thread && e.threadId===thread);
        const activeId=thread?registry.active[thread] || null:null;
        if(activeId && !entries.some(e=>e.id===activeId)) return send(409,{error:'对话绑定冲突，未显示任何当前卡'});
        const cards=await Promise.all(entries.map(project));
        return send(200,{thread,activeId,cards,checkedAt:new Date().toISOString()});
      }
      if(url.pathname.startsWith('/api/source/')) {
        const entry=(await getEntries(thread)).find(e=>e.id===decodeURIComponent(url.pathname.slice(12)));
        if(!entry?.source) return send(404,{error:'此项目尚未登记状态卡'});
        await requireIdentity(entry);
        return send(200,await fs.readFile(entry.source,'utf8'),'text/plain; charset=utf-8');
      }
      const route={'/app.js':'app.js','/style.css':'style.css','/reader.js':'reader.js','/marked.js':'vendor/marked.umd.js'};
      const filename = route[url.pathname] || ((url.pathname==='/' || /^\/t\/[a-f0-9-]{36}$/.test(url.pathname))?'index.html':null);
      if(!filename) return send(404,{error:'页面不存在'});
      const type=filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html';
      return send(200,await fs.readFile(path.join(root,'assets','web',filename)),type+'; charset=utf-8');
    } catch(e) { send(e.status || (e.code==='ENOENT'?404:500),{error:e.code==='ENOENT'?'原文件已不存在或路径发生变化':e.message}); }
  });
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=servicePort();
  if(!Number.isInteger(port) || port<1024 || port>65535) throw Error('端口无效');
  const server=createServer();
  server.on('error',e=>{console.error(e.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log('Progress card listening on http://127.0.0.1:'+port));
}
