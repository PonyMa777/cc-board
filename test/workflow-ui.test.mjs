// Full UI with a fake API in a real Chromium browser; no real user tasks or chats.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const root = fs.mkdtempSync('D:/ChatGPT-Temp/ccboard-workflows-20261125/workflow-ui-');
let html = fs.readFileSync(new URL('../ui.html', import.meta.url), 'utf8');
const bootstrap = `<script>
window.testErrors=[];addEventListener('error',e=>testErrors.push(e.message));addEventListener('unhandledrejection',e=>testErrors.push(String(e.reason)));
localStorage.setItem('ccb_lang','zh');localStorage.setItem('ccb_mode','wall');
window.testCalls=[];window.testJobs=[];
window.fetch=async(url,opt={})=>{
 const body=opt.body?JSON.parse(opt.body):null;testCalls.push({url,body});let data={ok:true};
 if(url.startsWith('/api/state'))data={now:Date.now(),sessions:[],pending:[],others:0,home:'D:/fixture',notices:[],providers:{codex:{ok:true,label:'Codex',models:[],efforts:['medium'],defaultModel:'',defaultEffort:'medium'}},archived:0,lost:[],crash:null,limits:{claude:[],codex:null},processed:{},workflows:{enabled:true,jobs:testJobs.map(j=>({id:j.id,status:j.status,updatedAt:j.planRevision}))}};
 if(url==='/api/new'){testJobs=[{id:'fixture-job',prompt:body.prompt,cwd:body.cwd,mode:body.taskMode,status:'awaiting_confirmation',planRevision:1,result:{summary:'先读取，再比较两个方案',questions:[],steps:['只读检查'],risks:[]},stages:[]}];data={ok:true,workflowId:'fixture-job'};}
 if(url==='/api/workflows'){data={ok:true,jobs:JSON.parse(JSON.stringify(testJobs))};if(window.holdNextWorkflow){window.holdNextWorkflow=false;await new Promise(r=>window.releaseWorkflow=r);}}
 if(url==='/api/workflows/action'){const j=testJobs[0];if(body.action==='discuss'){j.planRevision++;j.result.summary='方案已加入补充要求';}if(body.action==='confirm'){j.mode=body.mode;j.status='running';}data={ok:true,job:j};}
 return{ok:true,status:200,json:async()=>data};
};</script>`;
const tests = `<script>
const waitTest=()=>new Promise(r=>setTimeout(r,60));
const checkTest=(ok,msg)=>{if(!ok)throw new Error(msg)};
(async()=>{try{
 await waitTest();checkTest(!testErrors.length,testErrors.join(';'));
 window.ccbNew();document.querySelector('#nLaunch').dispatchEvent(new PointerEvent('pointerenter'));
 checkTest(!document.querySelector('#nModes').hidden,'hover must reveal modes');
 checkTest(document.querySelectorAll('[data-task-mode]').length===3,'exactly three modes');
 checkTest(!testCalls.some(c=>c.url==='/api/new'),'hover must never submit');
 document.querySelector('[data-task-mode="discuss"]').click();
 checkTest(!testCalls.some(c=>c.url==='/api/new'),'selection must never submit');
 document.querySelector('#nPrompt').value='请先讨论方案';document.querySelector('#nGo').click();await waitTest();
 checkTest(testCalls.filter(c=>c.url==='/api/new').length===1,'one explicit submission');
 checkTest(testCalls.find(c=>c.url==='/api/new').body.taskMode==='discuss','mode included in request');
 checkTest(document.querySelector('#workflowDlg').open,'workflow result visible');
 const reply=document.querySelector('#workflowReply');reply.value='还需要考虑兼容性';reply.dispatchEvent(new Event('input'));
 document.querySelector('[data-execution-mode="complex"]').click();await waitTest();
 checkTest(!testCalls.some(c=>c.url==='/api/workflows/action'),'unsubmitted additions must block execution');
 document.querySelector('[data-workflow-action="discuss"]').click();await waitTest();
 checkTest(testCalls.find(c=>c.url==='/api/workflows/action').body.expectedRevision===1,'discussion bound to shown plan');
 document.querySelector('[data-execution-mode="complex"]').click();await waitTest();
 const confirmations=testCalls.filter(c=>c.body?.action==='confirm');checkTest(confirmations.length===1,'only explicit button confirms');
 checkTest(confirmations[0].body.expectedRevision===2&&confirmations[0].body.mode==='complex','confirm exact updated plan and mode');
 window.holdNextWorkflow=true;loadWorkflows();await waitTest();
 testJobs[0].status='completed';paintWorkflowStatus({enabled:true,jobs:[{id:'fixture-job',status:'completed',updatedAt:999}]});
 window.releaseWorkflow();await waitTest();
 checkTest(document.querySelector('#workflowBody [role="status"]').textContent.includes('已完成'),'overlapping refresh must not lose final state');
 document.querySelector('#workflowDlg').close();window.ccbNew();document.querySelector('#nGo').focus();
 document.querySelector('#nGo').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
 checkTest(!document.querySelector('#nModes').hidden&&document.activeElement.dataset.taskMode==='discuss','keyboard opens same menu');
 document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 checkTest(document.querySelector('#nModes').hidden,'escape closes menu');
 document.querySelector('#nModeToggle').click();checkTest(!document.querySelector('#nModes').hidden,'click opens same menu');
 testJobs[0].status='running';testJobs[0].stages=[{index:0,role:'coding',status:'waiting_approval',threadId:'fixture-thread',turnId:'fixture-turn',pendingApproval:{id:'approval-fixture',command:'node synthetic.mjs <unsafe>',reason:'需要运行隔离浏览器',cwd:'D:/synthetic',availableDecisions:['accept','decline']}}];
 await openWorkflows('fixture-job');await waitTest();
 checkTest(document.querySelector('#workflowBody').textContent.includes('node synthetic.mjs <unsafe>'),'full escaped command is reviewable');
 checkTest(!testCalls.some(c=>c.body?.action==='approve'),'approval must never happen on render');
 document.querySelector('[data-decision="accept"]').click();await waitTest();
 const approval=testCalls.find(c=>c.body?.action==='approve');checkTest(approval?.body.approvalId==='approval-fixture'&&approval.body.decision==='accept','explicit one-time response targets shown request');
 checkTest(!testErrors.length,testErrors.join(';'));
 document.body.dataset.testResult='PASS';
 }catch(e){document.body.dataset.testResult='FAIL';document.body.dataset.testError=e.stack||String(e);}})();
</script>`;
html = html.replace('<head>', '<head>' + bootstrap).replace('</body>', tests + '</body>');
const fixture = path.join(root, 'workflow.html'); fs.writeFileSync(fixture, html);
const browser = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
assert.ok(browser);
const run = spawnSync(browser, ['--headless','--disable-gpu','--no-first-run','--disable-extensions','--user-data-dir='+path.join(root,'profile'),'--window-size=1000,800','--virtual-time-budget=2500','--screenshot='+path.join(root,'workflow.png'),'--dump-dom',pathToFileURL(fixture).href], {encoding:'utf8',timeout:30000,windowsHide:true,env:{...process.env,TEMP:root,TMP:root,TMPDIR:root}});
fs.writeFileSync(path.join(root,'rendered.html'),run.stdout||'');
assert.match(run.stdout||'', /data-test-result="PASS"/, (run.stdout||'').match(/data-test-error="([^"]*)/)?.[1] || run.stderr);
console.log('PASS: full UI, hover/keyboard/click modes, explicit submit, discussion, revision-bound confirmation. Screenshot: '+path.join(root,'workflow.png'));
