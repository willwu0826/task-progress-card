// Calendar dates use the user's working timezone, independent of server/browser timezone.
const zone='Asia/Shanghai';
const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});
const clockFormat=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hour12:false});
export function calendar(value){
  if(typeof value!=='string')return null;
  if(/^\d{4}-\d{2}-\d{2}$/.test(value)){
    const d=new Date(value+'T00:00:00Z');
    return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value?{day:value,dateLabel:value,sort:value}:null;
  }
  // Reject ambiguous local timestamps instead of assuming a timezone.
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
  if(!calendar(value.slice(0,10)))return null;
  const d=new Date(value);if(!Number.isFinite(d.getTime()))return null;
  const parts=Object.fromEntries(dayFormat.formatToParts(d).map(p=>[p.type,p.value]));
  const day=parts.year+'-'+parts.month+'-'+parts.day;
  return {day,dateLabel:day+' '+clockFormat.format(d),sort:d.toISOString()};
}
const names={create:'建立任务卡',setAction:'更新当前动作',startDetour:'进入回补',reviseDetour:'纠正回补目标',finishDetour:'回补完成',advance:'主线推进',invalidate:'撤销失效验收',setStatus:'状态变化',complete:'任务完结'};
export function cardTimeline(card){
  const events=[];let undated=0;
  for(const [index,h] of (card.history||[]).entries()){
    const time=calendar(h.at);if(!time){undated++;continue;}
    const d=h.details||{};
    const summary=d.detour?.title||d.text||d.reason||d.evidence||(d.to?((d.from?d.from+' → ':'')+d.to):'')||card.steps?.find(s=>s.id===d.stepId)?.title||'';
    events.push({...time,id:'event-'+index,label:names[h.action]||'记录变化',summary,revision:h.revision,sourceLabel:'原状态卡事件',sourcePath:card.source||null});
  }
  return {zone,events,undated};
}
export function legacyTimeline(raw,sourcePath,fileUpdatedAt){
  const events=[];
  const dateFields=new Set(['开始时间','创建时间','最后更新时间','最后有效产物时间','更新时间','完结时间','完成时间']);
  const lines=raw.split(/\r?\n/);let inEvents=false;
  for(const [index,line] of lines.entries()){
    if(/^#{1,6}\s/.test(line))inEvents=/^#{1,6}\s+(?:最近.*变化|变化记录|历史记录|变更记录)\s*$/.test(line.trim());
    if(!line.startsWith('|'))continue;
    const cells=line.split('|').slice(1,-1).map(v=>v.trim().replace(/^`|`$/g,''));
    if(dateFields.has(cells[0])){
      const time=calendar(cells[1]);
      if(time)events.push({...time,id:'line-'+(index+1),label:'原卡'+cells[0],summary:'原状态卡明确登记的日期',sourceLabel:'原状态卡第 '+(index+1)+' 行',sourcePath});
    }else if(inEvents&&cells[1]){
      const time=calendar(cells[0]);
      if(time)events.push({...time,id:'line-'+(index+1),label:'进展记录',summary:cells[1],sourceLabel:'原状态卡第 '+(index+1)+' 行',sourcePath});
    }
  }
  return {zone,events,undated:0,fileUpdatedAt};
}
