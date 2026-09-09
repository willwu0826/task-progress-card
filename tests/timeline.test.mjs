import test from 'node:test';
import assert from 'node:assert/strict';
import {calendar,cardTimeline,legacyTimeline} from '../scripts/timeline.mjs';
test('北京时间跨日跨年，日期边界与无时区数据不会被猜测',()=>{
 assert.equal(calendar('2026-12-31T16:30:00Z').day,'2027-01-01');
 assert.equal(calendar('2026-07-31T23:59:00+08:00').day,'2026-07-31');
 assert.equal(calendar('2026-07-31T16:00:00Z').day,'2026-08-01');
 assert.equal(calendar('2028-02-29').day,'2028-02-29');
 for(const value of ['2026-02-29','2026-02-30T01:00:00Z','2026-07-01 09:00','2026-07-01T09:00:00','not-a-date',null])assert.equal(calendar(value),null);
});
test('保留各月事件日期，不把最新更新当成任务开始或完结时间',()=>{
 const c={status:'DONE',updatedAt:'2026-09-09T00:00:00Z',history:[
  {at:'2026-07-01T01:00:00Z',action:'advance',details:{evidence:'七月材料齐备'}},
  {at:'2026-08-08T01:00:00Z',action:'startDetour',details:{detour:{title:'八月回补'}}},
  {at:'bad',action:'complete',details:{evidence:'日期无效'}}]};
 const before=JSON.stringify(c),t=cardTimeline(c);
 assert.deepEqual(t.events.map(e=>e.day),['2026-07-01','2026-08-08']);assert.equal(t.undated,1);
 assert.equal(t.events[0].summary,'七月材料齐备');assert.equal(t.events[1].summary,'八月回补');
 assert.equal(JSON.stringify(c),before);assert.ok(t.events.every(e=>e.label!=='任务完结'));
});
test('旧卡只读取明确时间字段及变化表，不扫描路径、计划或文件修改时间作事件',()=>{
 const text='# 卡\n| 最后更新时间 | 2026-08-08 |\n| 下次检查 | 2026-09-09 |\n| 当前任务合同 | 2026-08-01_合同.md |\n## 最近三次变化\n| 时间 | 变化 |\n| 2026-08-07 | 完成来源核对 |\n## 下次计划\n| 2026-10-01 | 计划发布 |';
 const t=legacyTimeline(text,'old.md','2026-09-09T00:00:00Z');
 assert.deepEqual(t.events.map(e=>e.day),['2026-08-08','2026-08-07']);
 assert.equal(t.events[1].summary,'完成来源核对');assert.match(t.events[1].sourceLabel,/第 7 行/);
 assert.equal(t.fileUpdatedAt,'2026-09-09T00:00:00Z');
 assert.deepEqual(legacyTimeline('| 当前状态 | DONE |','old.md','2026-09-09T00:00:00Z').events,[]);
});
