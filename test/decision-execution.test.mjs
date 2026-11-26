// Real browser clicks -> HTTP -> WorkflowManager -> isolated filesystem effect.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CCBOARD_PLAYWRIGHT || 'playwright-core');
import { WorkflowManager } from '../workflows.mjs';
const root = fs.mkdtempSync('D:/ChatGPT-Temp/decision-execution-');
const marker = path.join(root, 'executed.txt');
let attempts = 0;
const manager = new WorkflowManager({ file: path.join(root, 'jobs.json'), runStage: async args => {
  attempts++;
  if (attempts === 1) throw new Error('item/commandExecution/requestApproval：旧连接已结束');
  const threadId = args.resumeThreadId || crypto.randomUUID(), turnId = crypto.randomUUID();
  args.onIdentity({ threadId, turnId });
  const decision = await args.onApproval({ threadId, turnId, command: 'write isolated executed.txt', reason: '测试请求：写入隔离临时文件以验证点击确实执行。', cwd: root, availableDecisions: ['accept', 'cancel'] }, args.signal);
  if (decision === 'cancel') throw Object.assign(new Error('用户取消本次执行'), {name:'AbortError'});
  if (decision === 'accept') fs.appendFileSync(marker, 'executed\n');
  return { outcome: decision === 'accept' ? 'completed' : 'needs_input', summary: decision, evidence: [marker], blockers: [] };
}});
const job = manager.create({ cwd: root, mode: 'once', prompt: '隔离决策执行验收', requestId: crypto.randomUUID() });
const wait = async test => { for (let i=0;i<200;i++) { if(test())return; await new Promise(r=>setTimeout(r,25)); } throw new Error('Timed out'); };
await wait(()=>!manager.controls.has(job.id));
// This fixture runner threw before starting any process; its stop is known.
manager.acknowledgeStop(job.id, { requestId: crypto.randomUUID() });
const server = http.createServer(async(req,res)=>{
  let result;
  try {
    if(req.url==='/') { res.setHeader('Content-Type','text/html; charset=utf-8'); return res.end(fs.readFileSync(new URL('../ui.html',import.meta.url),'utf8').replace('__TOKEN__','fixture')); }
    if(req.url.startsWith('/api/state')) result={now:Date.now(),sessions:[],pending:[],others:0,home:root,notices:[],providers:{},archived:0,lost:[],limits:{},processed:{},workflows:{enabled:true,jobs:manager.list()}};
    else if(req.url==='/api/workflows') result={ok:true,jobs:manager.list()};
    else if(req.url==='/api/workflows/action') {
      let raw='';for await(const part of req)raw+=part;const b=JSON.parse(raw);
      const changed=b.action==='resume'?manager.resume(b.id,{requestId:b.requestId,expectedStage:b.expectedStage,note:b.text||''}):manager.approve(b.id,b.approvalId,b.decision,b.text);
      result={ok:true,job:changed};
    } else result={ok:true};
  }catch(e){result={ok:false,error:e.message};}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,env:{...process.env,TEMP:root,TMP:root,TMPDIR:root}});
try {
  const page=await browser.newPage({viewport:{width:1200,height:900}});
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(id=>openWorkflows(id),job.id);
  await page.getByText('旧授权请求已失效，需要重新发起',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-decision="accept"]').count(),0);
  await page.locator('#workflowDecisionReply').fill('仅允许隔离临时文件，保留我的要求');
  await page.locator('[data-workflow-action="resume"]').click();
  try { await wait(()=>!!manager.get(job.id).stages.at(-1)?.pendingApproval); } catch(e) { console.log(await page.locator('#workflowBody').innerText()); throw e; }
  await page.evaluate(()=>loadWorkflows());
  assert.ok(manager.get(job.id).discussion.some(d=>d.text.includes('保留我的要求')));
  assert.equal(fs.existsSync(marker),false);
  await page.locator('#workflowDecisionReply').fill('拒绝这一次，下一次再决定');
  await page.locator('[data-decision="cancel"]').click();
  await wait(()=>!manager.controls.has(job.id));
  assert.equal(fs.existsSync(marker),false);
  assert.equal(manager.get(job.id).status,'interrupted');
  assert.equal(attempts,2);
  manager.acknowledgeStop(job.id,{requestId:crypto.randomUUID()});
  assert.ok(manager.get(job.id).discussion.some(d=>d.text.includes('拒绝这一次')));
  await page.evaluate(()=>loadWorkflows());
  await page.locator('[data-workflow-action="resume"]').click();
  await wait(()=>!!manager.get(job.id).stages.at(-1)?.pendingApproval);
  await page.evaluate(()=>loadWorkflows());
  const pending=manager.get(job.id).stages.at(-1).pendingApproval;
  await page.screenshot({path:path.join(root,'decision.png'),fullPage:true});
  await page.locator('[data-decision="accept"]').click();
  await wait(()=>!manager.controls.has(job.id));
  assert.equal(fs.readFileSync(marker,'utf8'),'executed\n');
  assert.equal(manager.get(job.id).status,'completed');
  assert.throws(()=>manager.approve(job.id,pending.id,'accept'),/失效/);
  console.log('PASS: stale request -> typed requirements -> actual resume -> decline prevents write -> retry -> allow writes exactly once -> stale approval rejected. '+root);
} finally { await browser.close(); await new Promise(r=>server.close(r)); }
