import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import { WorkflowManager } from '../workflows.mjs';
import { radialJob } from '../workflow-org.mjs';
const root=fs.mkdtempSync('D:/ChatGPT-Temp/approval-test-');const wait=()=>new Promise(r=>setTimeout(r,5));
for(const choice of ['accept','decline','cancel']){
 let executions=0;
 const manager=new WorkflowManager({file:path.join(root,choice+'.json'),runStage:async args=>{
  const threadId=crypto.randomUUID(),turnId=crypto.randomUUID();args.onIdentity({threadId,turnId});
  const control=new AbortController();args.signal.addEventListener('abort',()=>control.abort());
  const decision=await args.onApproval({threadId,turnId,command:'synthetic-only',reason:'test request',cwd:root,availableDecisions:['accept','decline']},control.signal);
  if(decision==='accept')executions++;
  if(decision==='cancel')throw Object.assign(new Error('cancelled'),{name:'AbortError'});
  return {outcome:decision==='accept'?'completed':'needs_input',summary:'fixture',evidence:['fixture report'],blockers:[]};
 }});
 const job=manager.create({cwd:root,mode:'once',prompt:'fixture',requestId:crypto.randomUUID()});
 while(!manager.get(job.id).stages[0]?.pendingApproval)await wait();
 const pending=manager.get(job.id).stages[0].pendingApproval;
 assert.equal(executions,0);assert.equal(radialJob(manager.get(job.id)).stages[0].status,'waiting');
 assert.throws(()=>manager.approve('wrong',pending.id,'accept'),/失效/);
 if(choice==='cancel')manager.cancel(job.id);else manager.approve(job.id,pending.id,choice);
 while(manager.controls.has(job.id))await wait();
 assert.equal(executions,choice==='accept'?1:0);assert.equal(manager.approvals.size,0);
 assert.throws(()=>manager.approve(job.id,pending.id,'accept'),/失效/);
 const saved=manager.get(job.id);assert.equal(saved.stages[0].pendingApproval,null);assert.equal(saved.stages[0].approvalHistory.length,1);
}
console.log('PASS: explicit one-time approval, refusal, cancellation, stale identity, no auto execution, waiting node.');
