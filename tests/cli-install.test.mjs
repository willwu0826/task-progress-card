import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const scripts=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../scripts');
const runRoot=path.join(path.dirname(fileURLToPath(import.meta.url)),'.runs',`cli-install-${Date.now()}-${process.pid}`);
const threadA='11111111-1111-4111-8111-111111111111';
const threadB='22222222-2222-4222-8222-222222222222';
const port='45231';

async function workspace(name){
  const cwd=path.join(runRoot,name);
  await fs.mkdir(cwd,{recursive:true});
  return cwd;
}

function invoke(cwd,script,args=[],overrides={}){
  // Do not inherit real conversation identity, data routing, or Node hooks.
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>
    !/^(PROGRESS_CARD_HOME|PROGRESS_CARD_PORT|CODEX_THREAD_ID|NODE_OPTIONS|NODE_V8_COVERAGE)$/i.test(key)));
  Object.assign(env,{TEMP:cwd,TMP:cwd,TMPDIR:cwd},overrides);
  return spawnSync(process.execPath,[path.join(scripts,script),...args],{
    cwd,env,encoding:'utf8',timeout:10000,windowsHide:true,shell:false,
  });
}

function succeeded(result){
  assert.ifError(result.error);
  assert.equal(result.status,0,result.stderr);
  return result.stdout;
}

function rejected(result,pattern){
  assert.ifError(result.error);
  assert.equal(result.status,1,result.stderr);
  assert.equal(result.stdout,'');
  assert.match(result.stderr,pattern);
}

async function installed(name){
  const cwd=await workspace(name);
  const data=path.join(cwd,'data home with spaces');
  const project=path.join(cwd,'project files with spaces');
  await fs.mkdir(project,{recursive:true});
  const env={PROGRESS_CARD_HOME:data,PROGRESS_CARD_PORT:port,CODEX_THREAD_ID:threadA};
  succeeded(invoke(cwd,'setup.mjs',[],env));
  const source=path.join(project,'original progress.md');
  const seedFile=path.join(cwd,'card seed.json');
  await fs.writeFile(seedFile,JSON.stringify({
    id:'install-smoke',threadId:threadA,title:'Synthetic CLI installation',goal:'Restore the same original card',
    steps:[{id:'verify',title:'Verify the isolated installation',done:false}],
    mainlineStepId:'verify',acceptance:['The invoking conversation owns the original card'],
  }));
  const initialized=JSON.parse(succeeded(invoke(cwd,'cli.mjs',['init',source,seedFile],env)));
  const bindingFile=path.join(cwd,'binding input.json');
  const binding={kind:'card',id:initialized.id,title:initialized.title,source,projectRoot:project};
  await fs.writeFile(bindingFile,JSON.stringify(binding));
  const cardBefore=await fs.readFile(source,'utf8');
  const bindUrl=succeeded(invoke(cwd,'bind.mjs',[bindingFile],env)).trim();
  return {cwd,data,project,env,source,initialized,bindingFile,binding,cardBefore,bindUrl,registry:path.join(data,'registry.json')};
}

test('setup rejects a missing data home without inferring or writing a default directory',async()=>{
  const cwd=await workspace('missing data home');
  rejected(invoke(cwd,'setup.mjs'),/Set PROGRESS_CARD_HOME to an authorized absolute data directory/);
  assert.deepEqual(await fs.readdir(cwd),[]);
});

test('setup is idempotent and preserves an existing populated registry byte for byte',async()=>{
  const cwd=await workspace('idempotent setup');
  const data=path.join(cwd,'independent data with spaces');
  const env={PROGRESS_CARD_HOME:data};
  succeeded(invoke(cwd,'setup.mjs',[],env));
  const registry=path.join(data,'registry.json');
  assert.deepEqual(JSON.parse(await fs.readFile(registry,'utf8')),{version:1,active:{},entries:[]});
  const existing=JSON.stringify({version:1,active:{[threadA]:'kept-record'},entries:[{
    id:'kept-record',threadId:threadA,kind:'legacy',source:path.join(cwd,'synthetic existing card.md'),
  }]},null,4)+'\n';
  await fs.writeFile(registry,existing);
  assert.match(succeeded(invoke(cwd,'setup.mjs',[],env)),/Existing registry preserved/);
  assert.equal(await fs.readFile(registry,'utf8'),existing);
  assert.deepEqual(await fs.readdir(data),['registry.json']);
});

test('CLI init, bind, and entry work from an independent working directory with spaces',async()=>{
  const fixture=await installed('standalone CLI flow');
  const {cwd,env,source,initialized,cardBefore,registry,bindUrl,data}=fixture;
  assert.equal(bindUrl,`http://127.0.0.1:${port}/t/${threadA}`);
  const registryBefore=await fs.readFile(registry,'utf8');
  const entry=JSON.parse(succeeded(invoke(cwd,'entry.mjs',[],env)));
  assert.equal(entry.binding,'active');
  assert.equal(entry.threadId,threadA);
  assert.equal(entry.activeId,initialized.id);
  assert.equal(entry.mainlineStepId,'verify');
  assert.equal(entry.source,await fs.realpath(source));
  assert.equal(entry.url,`${bindUrl}#current`);
  assert.deepEqual(entry.records.map(record=>record.id),[initialized.id]);
  assert.deepEqual(JSON.parse(succeeded(invoke(cwd,'cli.mjs',['read',source],env))),initialized);
  assert.equal(await fs.readFile(source,'utf8'),cardBefore);
  assert.equal(await fs.readFile(registry,'utf8'),registryBefore);
  assert.deepEqual(await fs.readdir(data),['registry.json']);
});

test('CLI binding and entry reject missing, malformed, or conflicting runtime identities without changing data',async()=>{
  const fixture=await installed('runtime identity guards');
  const {cwd,env,source,registry,bindingFile,binding}=fixture;
  const registryBefore=await fs.readFile(registry,'utf8');
  const sourceBefore=await fs.readFile(source,'utf8');
  for(const runtimeId of [undefined,'not-a-conversation-id']){
    const invalidEnv={...env};
    if(runtimeId===undefined)delete invalidEnv.CODEX_THREAD_ID;
    else invalidEnv.CODEX_THREAD_ID=runtimeId;
    rejected(invoke(cwd,'bind.mjs',[bindingFile],invalidEnv),/No reliable runtime conversation ID/);
    rejected(invoke(cwd,'entry.mjs',[],invalidEnv),/缺少可信的当前对话ID/);
  }
  const conflictingInput=path.join(cwd,'conflicting identity.json');
  await fs.writeFile(conflictingInput,JSON.stringify({...binding,threadId:threadB}));
  rejected(invoke(cwd,'bind.mjs',[conflictingInput],env),/Input does not belong to the calling conversation/);
  rejected(invoke(cwd,'bind.mjs',[bindingFile],{...env,CODEX_THREAD_ID:threadB}),/Binding and original card identities differ/);
  rejected(invoke(cwd,'entry.mjs',[threadB],env),/不接受其他对话参数/);
  const other=JSON.parse(succeeded(invoke(cwd,'entry.mjs',[],{...env,CODEX_THREAD_ID:threadB})));
  assert.equal(other.binding,'unregistered');
  assert.equal(other.activeId,null);
  assert.equal(other.url,null);
  assert.deepEqual(other.records,[]);
  assert.equal(await fs.readFile(registry,'utf8'),registryBefore);
  assert.equal(await fs.readFile(source,'utf8'),sourceBefore);
});
