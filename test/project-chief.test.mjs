import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ProjectChief, chiefCommand } from '../project-chief.mjs';
import { WorkflowManager } from '../workflows.mjs';
const root = fs.mkdtempSync('D:/ChatGPT-Temp/project-chief-test-');
const roles = Object.fromEntries(['decision','planner','engineer','evidence','reviewer'].map(role => {
  const dir = path.join(root, role); fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'Original '+role); return [role,dir];
}));
const cwd = path.join(root,'source');fs.mkdirSync(cwd);
const configFile=path.join(root,'config.json'),file=path.join(root,'chats.json');
fs.writeFileSync(configFile,JSON.stringify({teams:[{id:'fixture',name:'Fixture',cwd,roles}]}));
let calls=0, chief;
const workflows=new WorkflowManager({file:path.join(root,'jobs.json'), resolveChiefModel:async()=>({model:'fixture-chief'}), verifySource:async()=>true,
  stageContext:(job,role)=>chief.context(job,role),onStage:(job,stage)=>chief.record(job,stage),onJob:job=>chief.record(job),
  runStage:async args=>{calls++;args.onIdentity({threadId:crypto.randomUUID(),turnId:crypto.randomUUID(),model:'fixture-chief'});assert.match(args.prompt,/Original decision/);return {decision:'needs_input',role:null,task:'',summary:'fixture question',evidence:[],blockers:['fixture question']};}});
const runStage=async()=>({summary:'Fixture plan',questions:[],steps:[],risks:[]});
chief=new ProjectChief({file,configFile,workflows,runStage});
const send=text=>chief.send({teamId:'fixture',text,requestId:crypto.randomUUID()});
for(const text of ['不要开始干','他说“开始干”是什么意思？','先讨论，不要执行','如果我说开始干会怎样']) assert.equal(chiefCommand(text),false);
for(const text of ['开始干','开始干吧！','按这个做','开始执行','那你就开始干吧，兄弟。']) assert.equal(chiefCommand(text),true);
await assert.rejects(send('开始干'),/先告诉/);
await send('讨论一个隔离测试任务');assert.equal(calls,0);assert.equal(workflows.list().length,0);
await send('记住：此项目报告使用中文');
for(const dir of Object.values(roles)) assert.match(fs.readFileSync(path.join(dir,'CCBoard/fixture/MEMORY.md'),'utf8'),/此项目报告使用中文/);
const request={teamId:'fixture',text:'开始干',requestId:crypto.randomUUID()};
const dispatched=await chief.send(request);await chief.send(request);
assert.ok(dispatched.jobId);assert.equal(workflows.list().length,1);
for(let i=0;i<100&&['running','queued'].includes(workflows.get(dispatched.jobId).status);i++)await new Promise(r=>setTimeout(r,10));
assert.equal(calls,1);assert.equal(workflows.get(dispatched.jobId).input.teamId,'fixture');
for(const [role,dir] of Object.entries(roles)) {
  assert.equal(fs.readFileSync(path.join(dir,'AGENTS.md'),'utf8'),'Original '+role);
  assert.match(fs.readFileSync(path.join(dir,'CCBoard/fixture/HANDOFF.md'),'utf8'),/fixture question/);
  assert.ok(fs.existsSync(path.join(dir,'CCBoard/fixture',dispatched.jobId+'.json')));
}
const restarted=new ProjectChief({file,configFile,workflows,runStage});
assert.throws(()=>workflows.attachTeam(dispatched.jobId,'other',cwd),/其他团队/);
workflows.attachTeam(dispatched.jobId,'fixture',cwd);
assert.equal(restarted.list()[0].chat.preferences.length,1);
assert.equal((await restarted.send(request)).jobId,dispatched.jobId);assert.equal(workflows.list().length,1);
await restarted.send({teamId:'fixture',text:'补充：范围只包括这个夹具',requestId:crypto.randomUUID()});
await restarted.send({teamId:'fixture',text:'继续执行',requestId:crypto.randomUUID()});
assert.equal(workflows.list().length,1,'follow-up resumes original task instead of creating a conflicting writer');
assert.match(workflows.get(dispatched.jobId).discussion.at(-1).text,/范围只包括/);
const legacy={...structuredClone(workflows.jobs[0]),id:crypto.randomUUID(),cwd:root,status:'needs_input',stages:[],actions:[]};
legacy.input={...legacy.input,cwd:root};delete legacy.input.teamId;workflows.jobs.push(legacy);
assert.throws(()=>workflows.attachTeam(legacy.id,'fixture',cwd),/不匹配/);
workflows.attachTeam(legacy.id,'fixture',cwd,{narrowWorkspace:true});
assert.equal(legacy.cwd,cwd);assert.equal(legacy.status,'needs_input');
assert.throws(()=>workflows.attachTeam(legacy.id,'fixture',root,{narrowWorkspace:true}),/不匹配/);
console.log('PASS: dedicated-channel dispatch, discussion isolation, explicit memory, five role bindings, durable handoffs, restart and idempotency; '+root);
