import fs from 'node:fs/promises';
import path from 'node:path';

const texts=new Map();
export async function readSmallText(filename){
  const stat=await fs.stat(filename);
  if(!stat.isFile()||stat.size>512*1024)throw Error('该记录不是小型文本文件，请在项目目录查看');
  const key=path.resolve(filename),stamp=stat.mtimeMs+':'+stat.ctimeMs+':'+stat.size;
  if(texts.get(key)?.stamp===stamp)return {text:texts.get(key).text,stat};
  const text=await fs.readFile(filename,'utf8');
  if(texts.size>200)texts.clear();
  texts.set(key,{stamp,text});return {text,stat};
}
export function legacyFields(raw){
  const field=(...names)=>{
    for(const name of names){
      const line=raw.split(/\r?\n/).find(l=>l.startsWith('|')&&l.split('|')[1]?.trim()===name);
      if(line)return line.split('|').slice(2,-1).join('|').trim();
    }return '';
  };
  const statusText=field('当前状态','状态');
  const status=statusText.replace(/^[\s`*]+/,'').match(/^(READY|RUNNING|REVIEW|BLOCKED|DONE)\b/)?.[1]||'UNKNOWN';
  return {status,statusText,goal:field('当前目标','任务名称','任务'),currentAction:field('已完成到哪里','已完成','当前动作','最早待补门禁'),nextAction:field('下一步','续接点'),mainlineLabel:field('主线位置','当前步骤'),detourTitle:field('当前回补'),detourReason:field('回补原因'),detourDoneWhen:field('回补完成条件'),returnLabel:field('补完返回点')};
}
