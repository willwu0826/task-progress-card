import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readCard} from './card.mjs';
import {legacyFields,readSmallText} from './catalog.mjs';
import {registryFile,readRegistry,servicePort} from './paths.mjs';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export async function bindCard({kind,source,threadId,id,title,projectRoot,records,registryPath=registryFile()}) {
  if(!['card','legacy'].includes(kind)||!uuid.test(threadId||'')||!/^[a-z0-9_-]+$/.test(id||'')||!title) throw Error('Invalid binding identity.');
  if(!path.isAbsolute(source||'')) throw Error('Source must be an explicitly authorized absolute path.');
  if(projectRoot!==undefined&&!path.isAbsolute(projectRoot)) throw Error('Project root must be absolute.');
  if(records!==undefined&&(!Array.isArray(records)||records.some(r=>!r||!/^[a-z0-9_-]+$/.test(r.id||'')||!path.isAbsolute(r.path||'')))) throw Error('Invalid record links.');
  source=await fs.realpath(source);
  if(kind==='card') {
    const card=await readCard(source);
    if(card.id!==id||card.threadId!==threadId) throw Error('Binding and original card identities differ.');
  } else await readSmallText(source);
  const lock=await fs.open(registryPath+'.lock','wx');
  let temp;
  try {
    const registry=await readRegistry(registryPath);
    const before=await fs.readFile(registryPath,'utf8');
    for(const registered of registry.entries) {
      if(registered.id===id)continue;
      let existingSource;
      try {existingSource=await fs.realpath(registered.source);} catch(error) {if(error.code==='ENOENT')continue;throw error;}
      const key=p=>process.platform==='win32'?p.toLowerCase():p;
      if(key(existingSource)===key(source))throw Error('This original source is already bound under another record ID.');
    }
    const prior=registry.entries.find(e=>e.id===id);
    if(prior&&(await fs.realpath(prior.source)!==source||prior.threadId!==threadId||prior.kind!==kind)) throw Error('This record ID already belongs to another source.');
    const activeId=registry.active[threadId];
    if(activeId&&activeId!==id) {
      const active=registry.entries.find(e=>e.id===activeId&&e.threadId===threadId);
      if(!active) throw Error('Existing active pointer is inconsistent.');
      const status=active.kind==='card'?(await readCard(active.source)).status:legacyFields((await readSmallText(active.source)).text).status;
      if(status!=='DONE') throw Error('An unfinished task is already active. Restore it before binding a new task.');
    }
    const entry={...(prior||{}),id,threadId,title,source,kind};
    if(projectRoot!==undefined)entry.projectRoot=projectRoot;
    if(records!==undefined)entry.records=records;
    if(prior)Object.assign(prior,entry);else registry.entries.push(entry);
    registry.active[threadId]=id;
    const next=JSON.stringify(registry,null,2)+'\n';
    if(JSON.stringify(JSON.parse(before))===JSON.stringify(registry)) return entry;
    temp=registryPath+'.'+process.pid+'.tmp';
    await fs.writeFile(temp,next,{flag:'wx'});
    if(await fs.readFile(registryPath,'utf8')!==before)throw Error('Registry changed during binding; no replacement performed.');
    await fs.rename(temp,registryPath);temp=null;
    return entry;
  } finally {
    if(temp)await fs.unlink(temp).catch(()=>{});
    await lock.close();await fs.unlink(registryPath+'.lock');
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    if(process.argv.length!==3) throw Error('Usage: node scripts/bind.mjs binding-input.json');
    const input=JSON.parse((await fs.readFile(process.argv[2],'utf8')).replace(/^\uFEFF/,''));
    const runtimeId=process.env.CODEX_THREAD_ID;
    if(!uuid.test(runtimeId||''))throw Error('No reliable runtime conversation ID.');
    if(input.threadId&&input.threadId!==runtimeId)throw Error('Input does not belong to the calling conversation.');
    delete input.registryPath;
    const entry=await bindCard({...input,threadId:runtimeId});
    console.log('http://127.0.0.1:'+servicePort()+'/t/'+entry.threadId);
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
