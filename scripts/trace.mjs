import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';

const TEXT_EXTENSIONS = new Set(['.md','.txt','.json','.log']);
const LIMIT = 512 * 1024;
function fail(status,message){const e=new Error(message);e.status=status;throw e;}
function inside(base,target){const r=path.relative(base,target);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));}
async function projectRoot(entry){
  if(!entry.projectRoot)fail(404,'此记录尚未登记项目位置');
  const location=path.resolve(entry.projectRoot);
  if(!path.isAbsolute(entry.projectRoot)||location.startsWith('\\\\'))fail(403,'项目位置必须是已登记的本地目录');
  const real=await fs.realpath(location);
  if(!(await fs.stat(real)).isDirectory())fail(404,'项目目录不存在');
  return real;
}
function records(entry){
  const list=[...(entry.source?[{id:'state',title:'原始状态卡',path:entry.source}]:[]),...(entry.records||[])];
  const ids=new Set();
  return list.filter(r=>{if(!/^[a-z0-9_-]+$/.test(r.id)||ids.has(r.id))return false;ids.add(r.id);return true;});
}
async function locate(entry,recordId){
  const record=records(entry).find(r=>r.id===recordId);
  if(!record)fail(404,'此文件未登记在项目档案中');
  if(!path.isAbsolute(record.path))fail(403,'记录路径必须是绝对地址');
  const real=await fs.realpath(record.path);
  // 状态卡可以是已明确登记的外部唯一来源；其他相关记录必须留在该项目内。
  if(record.id!=='state' && !inside(await projectRoot(entry),real))fail(403,'记录超出已登记项目范围');
  const stat=await fs.stat(real);
  if(!stat.isFile())fail(404,'该记录不是文件');
  return {record,real,stat};
}
export async function traceProject(entry){
  let location=null,locationError=null;
  try{location=await projectRoot(entry);}catch(e){locationError=e.code==='ENOENT'?'项目目录已不存在':e.message;}
  const related=await Promise.all(records(entry).map(async record=>{
    try{const found=await locate(entry,record.id);return {...record,exists:true,size:found.stat.size,updatedAt:found.stat.mtime.toISOString(),readable:TEXT_EXTENSIONS.has(path.extname(record.path).toLowerCase())&&found.stat.size<=LIMIT};}
    catch(e){return {...record,exists:false,readable:false,error:e.code==='ENOENT'?'文件已不存在或路径已变更':e.message};}
  }));
  return {id:entry.id,title:entry.title,projectRoot:location,locationError,records:related};
}
export async function readRecord(entry,recordId){
  const {record,real}=await locate(entry,recordId);
  if(!TEXT_EXTENSIONS.has(path.extname(real).toLowerCase()))fail(415,'该类型暂不支持页内阅读，请打开项目位置查看');
  const handle=await fs.open(real,'r');
  try{
    const stat=await handle.stat();if(stat.size>LIMIT)fail(413,'记录较大，请打开项目位置查看原文件');
    const buffer=Buffer.alloc(LIMIT+1);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
    if(bytesRead>LIMIT)fail(413,'记录较大，请打开项目位置查看原文件');
    return {id:record.id,title:record.title,path:record.path,updatedAt:stat.mtime.toISOString(),content:buffer.subarray(0,bytesRead).toString('utf8')};
  }finally{await handle.close();}
}
export async function openProject(entry,opener){
  const location=await projectRoot(entry);
  if(opener){await opener(location);return {opened:true,projectRoot:location};}
  if(process.platform!=='win32')fail(501,'打开项目位置仅支持本机Windows');
  const explorer=path.join(process.env.SystemRoot||'C:\\Windows','explorer.exe');
  await new Promise((resolve,reject)=>{
    const child=spawn(explorer,[location],{shell:false,detached:true,stdio:'ignore',windowsHide:false});
    child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});
  });
  return {opened:true,projectRoot:location};
}
