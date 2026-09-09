export const threadA='11111111-1111-4111-8111-111111111111';
export const threadB='22222222-2222-4222-8222-222222222222';
export const sampleCard={
  schemaVersion:1,id:'sample-card',threadId:threadA,title:'示例长任务',goal:'记录主线与回补',
  revision:3,status:'RUNNING',updatedAt:'2026-09-01T10:00:00+08:00',
  steps:[{id:'discover',title:'找到旧方案，确认显示方式',done:true,evidence:'示例材料已核对'},
    {id:'build',title:'实现进度卡与历史查询',done:true,evidence:'示例实现已检查'},
    {id:'verify',title:'验证回补恢复和页面显示',done:false},
    {id:'deliver',title:'接入当前对话并交付',done:false}],
  mainlineStepId:'verify',currentAction:'第三步核对',nextAction:'记录结果',detours:[],
  acceptance:['回补后准确返回'],evidence:[],history:[],budget:{total:0,used:0,remaining:0}
};
