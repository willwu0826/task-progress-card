import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readCard} from './card.mjs';
import {readSmallText,legacyFields} from './catalog.mjs';

import {registryFile, servicePort, readRegistry} from './paths.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

// Resolve one explicit conversation. No discovery, rebinding, service launch or panel opening.
export async function resolveEntry({threadId,registryPath=registryFile(),port=servicePort()}={}){
  if(typeof threadId!=='string'||!uuid.test(threadId))throw Error('缺少可信的当前对话ID，未推断或绑定任何卡片');
  const registry=await readRegistry(registryPath);
  if(!Array.isArray(registry.entries)||!registry.active||typeof registry.active!=='object')throw Error('登记表结构无效');
  const entries=registry.entries.filter(e=>e.threadId===threadId);
  if(new Set(entries.map(e=>e.id)).size!==entries.length)throw Error('本对话存在重复记录ID，请核对登记');
  const activeId=registry.active[threadId]||null;
  const active=entries.find(e=>e.id===activeId);
  if(activeId&&!active)throw Error('当前任务指针不属于本对话，未提供打开请求');
  const url='http://127.0.0.1:'+servicePort(port)+'/t/'+threadId;
  const result={threadId,binding:active?'active':entries.length?'history-only':'unregistered',activeId,
    records:entries.map(({id,title,kind})=>({id,title,kind})),url:null};
  if(active){
    if(!active.source||!path.isAbsolute(active.source))throw Error('当前状态卡必须登记绝对路径');
    if(active.kind==='card'){
      const card=await readCard(active.source);
      if(card.threadId!==threadId||card.id!==activeId)throw Error('登记与原状态卡身份不一致');
      result.status=card.status;result.mainlineStepId=card.mainlineStepId;
    }else if(active.kind==='legacy'){
      result.status=legacyFields((await readSmallText(active.source)).text).status;
    }else throw Error('不支持的当前卡片类型');
    result.source=active.source;result.url=url+'#current';
  }else if(entries.length){
    result.url=url+'#history';
  }
  return result;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length>2)throw Error('本命令只读取运行时CODEX_THREAD_ID，不接受其他对话参数');
    console.log(JSON.stringify(await resolveEntry({threadId:process.env.CODEX_THREAD_ID}),null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
