import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WorkflowManager } from '../workflows.mjs';
import { radialJob, workflowExecution } from '../workflow-org.mjs';
const root=fs.mkdtempSync('D:/ChatGPT-Temp/parallel-tests-');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const assignments=[{role:'coding',task:'独立代码'},{role:'decomposition',task:'独立分析'},{role:'documentation',task:'独立文档'}];
const batch={decision:'delegate_parallel',role:null,task:'',assignments,summary:'并行',evidence:[],blockers:[]};
const lead={outcome:'completed',summary:'finished',evidence:[{kind:'static',detail:'fixture',reference:null}],blockers:[]};
async function run(name,fail=false,cancel=false) {
 let chief=0,active=0,writers=0,max=0,maxW=0;const snapshots=[];let m;
 m=new WorkflowManager({file:path.join(root,name+'.json'),resolveChiefModel:async()=>({model:'fixture'}),verifySource:async()=>true,
 runStage:async args=>{
  args.onIdentity({threadId:crypto.randomUUID(),turnId:crypto.randomUUID(),model:'fixture'});
  if(args.role==='chief')return ++chief===1?batch:{decision:'needs_input',role:null,task:'',summary:'test boundary',evidence:[],blockers:['fixture pause']};
  active++;max=Math.max(max,active);const write=['coding','documentation'].includes(args.role);if(write)writers++;maxW=Math.max(maxW,writers);
  try{await delay(args.role==='coding'?80:35);if(args.signal.aborted)throw Object.assign(new Error('cancel'),{name:'AbortError'});if(fail&&args.role==='decomposition')throw Object.assign(new Error('fixture input'),{code:'needs_input'});return lead;}
  finally{active--;if(write)writers--;}
 }});
 const j=m.create({cwd:root,prompt:'fixture',mode:'complex',requestId:crypto.randomUUID()});
 let cancelled=false;
 for(let i=0;i<200;i++){const job=m.get(j.id);snapshots.push(radialJob(job));if(cancel&&!cancelled&&job.stages.length===4){m.cancel(j.id);cancelled=true;}if(!['queued','running'].includes(job.status)&&!m.controls.has(j.id))break;await delay(3);}
 const job=m.get(j.id);assert.equal(active,0);assert.equal(max,2);assert.equal(maxW,1);
 assert.ok(snapshots.some(s=>s.stages.filter(t=>t.status==='running').length===2&&s.stages.some(t=>t.status==='queued')));
 assert.ok(!radialJob(job).stages.some(s=>s.status==='running'||s.status==='queued'));
 if(!fail&&!cancel){assert.equal(job.stages[1].status,'completed');assert.equal(job.stages[2].status,'completed');assert.equal(job.stages[3].status,'completed');assert.equal(chief,2);}
 if(fail){assert.equal(job.status,'needs_input');assert.equal(job.stages[1].status,'completed');assert.equal(job.stages[2].status,'needs_input');assert.equal(job.stages[3].threadId,null);}
 if(cancel)assert.equal(job.status,'cancelled');
 m.testDisableFailure=()=>{fail=false;};return {job,m};
}
await run('success');const failed=await run('failure',true);await run('cancel',false,true);
const originalCoder=failed.job.stages[1].threadId;failed.m.testDisableFailure();
failed.m.resume(failed.job.id,{requestId:crypto.randomUUID(),expectedStage:3});
for(let i=0;i<200&&failed.m.controls.has(failed.job.id);i++)await delay(5);
const resumed=failed.m.get(failed.job.id);
assert.equal(resumed.stages[1].threadId,originalCoder,'completed sibling must not replay');
assert.equal(resumed.stages[2].status,'completed');assert.equal(resumed.stages[3].status,'completed');
assert.equal(resumed.stages[2].attempts[0].status,'needs_input');
assert.equal(workflowExecution({sid:'x',status:'busy'},[{stages:[{threadId:'x',status:'completed',turnId:'t'}]}]).status,'idle');
assert.equal(workflowExecution({sid:'x',status:'busy'},[{stages:[{threadId:'x',status:'running',turnId:null}]}]).status,'idle');
console.log('PASS: real asynchronous overlap, two slots, one writer, queued lane, independent completion, sibling failure drain, cancellation, authoritative lights. '+root);
