// Explicit real-model acceptance run. Isolated project/data/server; original role documents stay intact.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const root=fs.mkdtempSync('D:/ChatGPT-Temp/ccboard-chief-live-');
const parallel=process.argv.includes('--parallel'), snapshots=[];
const source=path.join(root,'source'),data=path.join(root,'data');fs.mkdirSync(source);fs.mkdirSync(data);
const roles={decision:'D:/quant agents/5quant coding decision',planner:'D:/quant agents/quant coding planner',engineer:'D:/quant agents/quant coding engineer',evidence:'D:/quant agents/3quant coding evidence',reviewer:'D:/quant agents/quant coding reviewer'};
const hashes=()=>Object.fromEntries(Object.entries(roles).map(([r,dir])=>[r,crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,'AGENTS.md'))).digest('hex')]));
const before=hashes(),teamId='trial-'+crypto.randomUUID();
fs.writeFileSync(path.join(source,'SPEC.md'),'Implement runningRoles(stages) in running-roles.mjs, named ES-module export. Input must be an array (else TypeError). Ignore null/non-object entries and roles that are not nonempty strings. Return distinct role names whose status is exactly running, in first qualifying occurrence order. Never mutate input. Node standard library only. No browser or financial task.');
fs.writeFileSync(path.join(data,'config.json'),JSON.stringify({codex:true,autoContinue:false,autoTidy:false}));
fs.writeFileSync(path.join(data,'chief-teams.json'),JSON.stringify({teams:[{id:teamId,name:'Chief 接单真实验收',cwd:source,roles}]}));
const port=4794,base='http://127.0.0.1:'+port;
const server=spawn(process.execPath,[path.resolve('server.mjs')],{windowsHide:true,env:{...process.env,CCBOARD_PORT:String(port),CCBOARD_DATA:data,TEMP:root,TMP:root,TMPDIR:root},stdio:['ignore','pipe','pipe']});
server.stdout.pipe(fs.createWriteStream(path.join(root,'server.log')));server.stderr.pipe(fs.createWriteStream(path.join(root,'error.log')));
console.log('TRIAL '+root);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let token;
const api=async(route,body)=>{const response=await fetch(base+route,{method:body?'POST':'GET',headers:{'x-ccboard':token,Origin:base,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();if(value.ok===false||!response.ok)throw new Error(JSON.stringify(value));return value;};
try {
  let ready=false;
  for(let i=0;i<60;i++){try{const h=await (await fetch(base+'/health')).json();if(h.data!==data)throw new Error('Another service owns trial port');ready=true;break;}catch(e){if(e.message.includes('Another service'))throw e;await delay(500);}}
  assert.ok(ready,'trial server ready');token=fs.readFileSync(path.join(data,'.token'),'utf8').trim();await delay(2500);
  const request=text=>({teamId,text,requestId:crypto.randomUUID()});
  console.log('DISCUSS');
  const discussion=await api('/api/chief/send',request(parallel
    ? '本次验证真实并行派工。只在当前合成目录工作。开始后Chief第一轮必须delegate_parallel，assignments按顺序包含三个独立任务：coding按SPEC.md实现runningRoles；decomposition仅对SPEC做完整边界分析，不读实现、不写文件；documentation仅根据SPEC写README.md说明契约，不读实现或分析报告。三者只依赖已有SPEC，互不依赖。不要先另派规划。宿主最多两条运行且一个写入，因此文档会排队。全部完成后单独tester实际测试代码及README契约，再qa引用宿主证据，最后chief汇报。验收仅为代码与隔离测试，不要求桌面，不访问网络、不改业务项目。现在先讨论，稍后我发送开始干。'
    : '本次仅在当前合成目录按SPEC.md实现runningRoles。请先给简短计划，不执行。执行时需要decomposition简短规划、coding实际写代码、tester独立运行含重复项/混合状态/非法输入/输入不变的测试、qa引用宿主测试证据，最后chief汇报。验收仅为代码和隔离测试，不要求桌面验证；不要改任何业务项目。'));
  assert.equal(discussion.message.state,'completed',discussion.message.error);
  assert.equal((await api('/api/workflows')).jobs.length,0,'discussion must not dispatch');
  await api('/api/chief/send',request('记住：本验收项目的结论用中文，保留实际测试命令和限制。'));
  console.log('DISPATCH 开始干');const start=request('开始干');
  const dispatched=await api('/api/chief/send',start);const repeated=await api('/api/chief/send',start);
  assert.equal(dispatched.message.jobId,repeated.message.jobId);assert.equal((await api('/api/workflows')).jobs.length,1);
  let job,stamp='';
  const deadline=Date.now()+25*60000;
  while(Date.now()<deadline){job=(await api('/api/workflows')).jobs.find(j=>j.id===dispatched.message.jobId);if(parallel){const state=await api('/api/state');snapshots.push({at:Date.now(),job:structuredClone(job),projection:state.org?.radialJobs?.find(j=>j.id===job.id)});fs.writeFileSync(path.join(root,'snapshots.json'),JSON.stringify(snapshots));}const next=job.status+':'+job.phase+':'+job.stages.length;if(next!==stamp){console.log(next);stamp=next;}if(!['queued','running'].includes(job.status))break;await delay(2000);}
  assert.equal(job.status,'completed',job.error||JSON.stringify(job.result));
  assert.ok(fs.existsSync(path.join(source,'running-roles.mjs')));
  assert.equal(job.lastQa.verdict,'pass');assert.equal(job.lastTester.qualified,true);
  assert.deepEqual(hashes(),before);
  let overlapMs=null;
  if(parallel){
    const coder=job.stages.find(s=>s.role==='coding'),planner=job.stages.find(s=>s.role==='decomposition'),docs=job.stages.find(s=>s.role==='documentation');
    overlapMs=Math.min(coder.finishedAt,planner.finishedAt)-Math.max(coder.executionStartedAt,planner.executionStartedAt);
    assert.ok(overlapMs>0,'two independent real model turns overlapped');
    assert.ok(docs.executionStartedAt>=coder.finishedAt,'writers serialized');
    assert.ok(snapshots.some(s=>s.projection?.stages.filter(t=>t.status==='running').length===2&&s.projection.stages.some(t=>t.status==='queued')),'real API exposed two running and one queued');
    assert.ok(snapshots.every(s=>(s.projection?.stages.filter(t=>t.status==='running').length||0)<=2));
    assert.ok(!snapshots.at(-1).projection.stages.some(t=>t.status==='running'),'final nodes stop');
  }
  for(const dir of Object.values(roles)) {
    const saved=path.join(dir,'CCBoard',teamId);
    assert.match(fs.readFileSync(path.join(saved,'MEMORY.md'),'utf8'),/结论用中文/);
    assert.match(fs.readFileSync(path.join(saved,'HANDOFF.md'),'utf8'),/completed/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(saved,job.id+'.json'),'utf8')).status,'completed');
  }
  fs.writeFileSync(path.join(root,'acceptance.json'),JSON.stringify({ok:true,parallel,overlapMs,teamId,root,job,originalRoleFilesUnchanged:true,discussionDispatched:false,idempotent:true,allFiveHandoffsSaved:true},null,2));
  console.log('PASS '+path.join(root,'acceptance.json'));
} catch(error){fs.writeFileSync(path.join(root,'failure.json'),JSON.stringify({error:error.message,root},null,2));console.error('FAIL '+error.message);process.exitCode=1;}
finally{server.kill();}
