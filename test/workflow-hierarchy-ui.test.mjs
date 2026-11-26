// Full hierarchy UI with synthetic API responses in Chromium. No live chats or model turns.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const base='D:/ChatGPT-Temp/ccboard-hierarchy-20261125';fs.mkdirSync(base,{recursive:true});
const root=fs.mkdtempSync(path.join(base,'ui-'));
let html=fs.readFileSync(new URL('../ui.html',import.meta.url),'utf8');
const stages=[
 {index:0,role:'chief',threadId:'chief-root',turnId:'turn-0',parentIndex:null,parentThreadId:null,actualModel:'fixture-strong-model',status:'completed',report:{decision:'delegate',role:'research',task:'查清兼容性约束',summary:'先安排研究，再选择实施负责人。',evidence:[{kind:'static',detail:'读取了合成项目说明。'}],blockers:[]}},
 {index:1,role:'research',threadId:'research-thread',turnId:'turn-1',parentIndex:0,parentThreadId:'chief-root',actualModel:'fixture-research-model',status:'completed',report:{outcome:'completed',summary:'整理了两种方案的兼容性。',evidence:[{kind:'isolated',detail:'合成环境中对比了方案 A 与方案 B。'}],blockers:[]}},
 {index:2,role:'chief',threadId:'chief-decision-2',turnId:'turn-2',parentIndex:0,parentThreadId:'chief-root',actualModel:'fixture-strong-model',status:'completed',report:{decision:'delegate',role:'coding',task:'实现方案 A',summary:'根据研究结果派发实现工作。',evidence:[],blockers:[]}},
 {index:3,role:'coding',threadId:'coding-thread',turnId:'turn-3',parentIndex:2,parentThreadId:'chief-decision-2',actualModel:'fixture-coding-model',status:'completed',report:{outcome:'completed',summary:'完成合成实现与测试。',evidence:[{kind:'real_environment',detail:'合成演示证据：测试命令返回 0；不是对真实项目执行的声明。'}],blockers:[]}},
 {index:4,role:'chief',threadId:'chief-decision-4',turnId:'turn-4',parentIndex:0,parentThreadId:'chief-root',actualModel:'fixture-strong-model',status:'completed',report:{decision:'delegate',role:'qa',task:'独立验收写入版本 1',summary:'将已实现版本交给独立验收。',evidence:[],blockers:[]}},
 {index:5,role:'qa',threadId:'qa-thread',turnId:'turn-5',parentIndex:4,parentThreadId:'chief-decision-4',actualModel:'fixture-qa-model',status:'blocked',report:{verdict:'blocked',summary:'静态检查通过，但未独立运行真实环境测试。',evidence:[{kind:'static',detail:'核对了宿主提供的文件快照与函数边界。'}],findings:['缺少本次写入版本的独立运行证据。'],verifiedWriteRevision:1}},
];
stages[4].report.role='tester';
stages[4].report.task='在隔离副本运行独立测试';
const qa=stages.pop();
stages.push({index:5,role:'tester',threadId:'tester-thread',turnId:'turn-5',parentIndex:4,parentThreadId:'chief-decision-4',actualModel:'fixture-test-model',status:'completed',executionEvidence:[{kind:'isolated',id:'host-test-1',command:'node test/import.test.mjs',exitCode:0,output:'PASS synthetic import checks\n<script>window.unsafeOutput=true</script>',cwd:'D:/ChatGPT-Temp/synthetic-test-copy',manifestHash:'fixture-manifest-hash',limitations:['只覆盖隔离副本，未操作真实桌面聊天。']}],report:{outcome:'completed',summary:'测试命令完成。',evidence:[]}});
stages.push({index:6,role:'chief',threadId:'chief-decision-6',turnId:'turn-6',parentIndex:0,parentThreadId:'chief-root',actualModel:'fixture-strong-model',status:'completed',report:{decision:'delegate',role:'qa',task:'核查独立测试证据',summary:'派发最终核查。'}});
Object.assign(qa,{index:7,parentIndex:6,parentThreadId:'chief-decision-6'});qa.report.evidence.push({kind:'isolated',detail:'参考隔离命令结果；真实桌面行为未验证。',reference:'host-test-1'});stages.push(qa);
stages[5].validationEvidence={complete:false,files:[{name:'import.test.mjs',path:'test/import.test.mjs',sha256:'fixture-script-sha256',content:'assert.equal(importResult.ok, true);',size:36,truncated:true}]};
const job={id:'hierarchy-fixture',prompt:'为合成项目设计并实现可靠的导入流程',cwd:'D:/synthetic-workspace',mode:'complex',status:'blocked',phase:'qa',hierarchyVersion:2,hierarchyStageLimit:12,reworkLimit:2,reworkCount:1,writeRevision:1,lastQa:{stageIndex:5,writeRevision:1,verdict:'blocked'},rootChiefIndex:0,rootChiefThreadId:'chief-root',chiefModel:{model:'fixture-strong-model',effort:'high',reason:'用户配置的首选负责人模型，可用性已由合成接口确认。'},writeSafetyHold:true,planRevision:1,stages,result:null,error:'停止确认缺失，目录继续保持占用。'};
const serial=value=>JSON.stringify(value).replace(/</g,'\\u003c');
const bootstrap=`<script>
window.testErrors=[];addEventListener('error',e=>testErrors.push(e.message));addEventListener('unhandledrejection',e=>testErrors.push(String(e.reason)));
localStorage.clear();localStorage.setItem('ccb_lang',JSON.stringify('zh'));localStorage.setItem('ccb_mode',JSON.stringify('org'));localStorage.setItem('ccb_orgshape',JSON.stringify('map'));
window.testCalls=[];window.testJobs=[${serial(job)}];
const session=(sid,title)=>({sid,title,provider:'codex',status:'idle',cwd:'D:/synthetic-workspace',startedAt:1,done:true,result:'合成结果',resultAt:Date.now(),digest:{need:'review'},project:{key:'fixture',name:'合成项目'}});
window.fetch=async(url,opt={})=>{const body=opt.body?JSON.parse(opt.body):null;testCalls.push({url,body,method:opt.method||'GET'});let data={ok:true};
if(url.startsWith('/api/state')){const j=testJobs[0];data={now:Date.now(),sessions:[...j.stages.filter(s=>s.threadId).map(s=>session(s.threadId,s.role+' 合成助手')),session('unrelated-thread','未绑定的外部桌面聊天')],pending:[],others:0,home:'D:/fixture',notices:[],providers:{codex:{ok:true,label:'Codex',models:[],efforts:[],defaultModel:'',defaultEffort:''}},archived:0,lost:[],crash:null,limits:{claude:[],codex:null},processed:{},workflows:{enabled:true,jobs:[{id:j.id,status:j.status,updatedAt:j.updatedAt||1,writeSafetyHold:j.writeSafetyHold}]},org:{chief:null,nodes:Object.fromEntries([...j.stages.filter(s=>s.threadId).map(s=>[s.threadId,{role:s.index===0?'lead':s.role==='chief'?'member':'head',boss:s.parentThreadId,via:'workflow',workflowId:j.id,workflowRole:s.role,workflowStageStatus:s.status,actualModel:s.actualModel}]),['unrelated-thread',{role:'member',boss:null}]])}};}
if(url==='/api/workflows')data={ok:true,jobs:JSON.parse(JSON.stringify(testJobs))};
if(url==='/api/workflows/action'){if(body.action!=='acknowledgeStop')throw new Error('Unexpected workflow action');testJobs[0].writeSafetyHold=false;testJobs[0].updatedAt=2;data={ok:true,job:testJobs[0]};}
return{ok:true,status:200,json:async()=>data};};</script>`;
const tests=`<script>
const tick=()=>new Promise(r=>setTimeout(r,50)),check=(ok,text)=>{if(!ok)throw new Error(text)};
(async()=>{try{
await tick();await tick();check(!testErrors.length,testErrors.join(';'));
await openWorkflows('hierarchy-fixture');await tick();
let body=document.querySelector('#workflowBody');
check(body.textContent.includes('YOU（你／当前对话）')&&body.textContent.includes('外部桌面对话未绑定、未接管'),'YOU entry must not claim control of external chat');
check(!body.textContent.includes('unrelated-thread')&&!body.textContent.includes('未绑定的外部桌面聊天'),'unrelated chats must not become workflow children');
check(body.querySelectorAll('[data-tree-stage]').length===8,'all actual stages shown');
check(body.querySelector('[data-tree-stage="3"]').parentElement.closest('[data-tree-stage]').dataset.treeStage==='2','coding must nest under its actual delegating chief');
check(body.querySelector('[data-tree-stage="7"]').parentElement.closest('[data-tree-stage]').dataset.treeStage==='6','QA must nest under its actual delegating chief');
check(body.textContent.includes('独立测试执行')&&body.textContent.includes('node test/import.test.mjs')&&body.textContent.includes('fixture-manifest-hash')&&body.textContent.includes('PASS synthetic import checks'),'host command evidence visible');
check(!window.unsafeOutput,'host output must be escaped');
check(body.textContent.includes('fixture-script-sha256')&&body.textContent.includes('assert.equal(importResult.ok, true);')&&body.textContent.includes('测试脚本证据不完整，尚未完整核验'),'test script content/hash and incomplete evidence warning visible');
body.querySelector('[data-workflow-stage="7"]').open=true;
const beforeEvidenceCalls=testCalls.length;
body.querySelector('[data-workflow-evidence="host-test-1"]').click();
check(body.querySelector('[data-workflow-stage="5"]').open,'QA reference opens actual tester evidence');
check(testCalls.length===beforeEvidenceCalls,'evidence navigation is read only');
check(body.textContent.includes('fixture-coding-model')&&body.textContent.includes('fixture-qa-model')&&body.textContent.includes('选择理由'),'actual models and chief reason visible');
check(body.textContent.includes('真实环境（助手报告）')&&body.textContent.includes('隔离环境（助手报告）')&&body.textContent.includes('静态检查（助手报告）')&&!body.textContent.includes('[object Object]'),'typed evidence must remain readable and qualified');
check(body.textContent.includes('8 / 12')&&body.textContent.includes('1 / 2')&&body.textContent.includes('写入版本：1'),'stage/rework bounds and write revision visible');
check(body.textContent.includes('受阻')&&body.querySelector('.workflow-hold'),'blocked state and workspace hold visible');
check(orgWhy('coding-thread',orgM,sv).includes('chief-decision-2'),'organization explanation identifies actual parent thread');
check(orgMeta(cards.get('coding-thread').s,cards.get('coding-thread').v,orgM).includes('代码实现'),'organization metadata uses workflow responsibility');
check(!orgM.boss('unrelated-thread'),'unrelated organization node stays independent');
testJobs[0].stages.push({index:8,role:'documentation',status:'queued',threadId:null,requestedModel:'requested-is-not-actual',parentIndex:0,parentThreadId:'chief-root'});
testJobs[0].stages.push({index:9,role:'decomposition',status:'completed',threadId:'orphan-thread',turnId:'orphan-turn',requestedModel:'requested-is-not-actual',parentIndex:0,parentThreadId:'wrong-parent',report:{summary:'只有实际父线程对上才连边。'}});
await loadWorkflows();body=document.querySelector('#workflowBody');
check(!body.querySelector('[data-tree-stage="8"]')&&body.textContent.includes('尚未创建真实线程'),'queued phase must not masquerade as a real thread');
check(!body.querySelector('[data-tree-stage="9"]').hasAttribute('data-parent-stage')&&body.textContent.includes('父线程尚未核验'),'mismatched parent identity must not create false edge');
check(body.textContent.includes('未报告实际模型')&&!body.textContent.includes('requested-is-not-actual'),'requested model must not masquerade as actual');
testJobs[0].stages.splice(8);await loadWorkflows();
document.querySelector('[data-workflow-action="acknowledgeStop"]').click();await tick();
check(document.querySelector('#askDlg').open&&!testCalls.some(c=>c.url==='/api/workflows/action'),'hold acknowledgement requires explicit confirmation');
check(document.querySelector('#qText').textContent.includes('不会继续或重放任务'),'confirmation explains release-only behavior');
document.querySelector('#qNo').click();await tick();check(testJobs[0].writeSafetyHold&&!testCalls.some(c=>c.url==='/api/workflows/action'),'decline keeps the hold');
document.querySelector('[data-workflow-action="acknowledgeStop"]').click();await tick();document.querySelector('#qYes').click();for(let wait=0;wait<10&&testJobs[0].writeSafetyHold;wait++)await tick();await tick();
const actions=testCalls.filter(c=>c.url==='/api/workflows/action');check(actions.length===1&&actions[0].body.action==='acknowledgeStop','only explicit acknowledgement sent');
check(testJobs[0].status==='blocked'&&!testJobs[0].writeSafetyHold&&!document.querySelector('[data-workflow-action=acknowledgeStop]'),'acknowledgement releases lock without restarting');
check(!testCalls.some(c=>c.url==='/api/new'||['confirm','discuss'].includes(c.body?.action)),'hold release never creates or resumes work');
document.querySelector('#workflowDlg').close();window.ccbNew();document.querySelector('#nLaunch').dispatchEvent(new PointerEvent('pointerenter'));check(document.querySelectorAll('[data-task-mode]').length===3&&!document.querySelector('#nModes').hidden,'three-mode hover menu preserved');
check(document.querySelector('[data-task-mode="complex"] small').textContent==='负责人按需分工，再独立验收','complex description reflects hierarchy');
document.querySelector('#newDlg').close();await tick();
if(new URL(location.href).searchParams.has('blocked')){testJobs[0].writeSafetyHold=true;testJobs[0].updatedAt=3;}
await openWorkflows('hierarchy-fixture');await tick();
document.querySelector('[data-workflow-stage="5"]').open=true;document.querySelector('#workflowBody').scrollTop=0;
check(document.querySelector('#workflowBody').scrollWidth<=document.querySelector('#workflowBody').clientWidth+2,'hierarchy must not overflow horizontally');
check(!testErrors.length,testErrors.join(';'));document.body.dataset.testResult='PASS';
}catch(e){document.body.dataset.testResult='FAIL';document.body.dataset.testError=e.stack||String(e);}})();</script>`;
html=html.replace('<head>','<head>'+bootstrap).replace('</body>',tests+'</body>');
const file=path.join(root,'hierarchy.html');fs.writeFileSync(file,html);
const browser=[process.env.CCBOARD_TEST_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(p=>fs.existsSync(p));assert.ok(browser,'Chromium required');
for(const blocked of [false,true]){
 const name=blocked?'hierarchy-blocked':'hierarchy';
 const run=spawnSync(browser,['--headless','--disable-gpu','--no-first-run','--disable-extensions','--user-data-dir='+path.join(root,name+'-profile'),'--window-size=1180,1400','--virtual-time-budget=3500','--screenshot='+path.join(root,name+'.png'),'--dump-dom',pathToFileURL(file).href+(blocked?'?blocked=1':'')],{encoding:'utf8',timeout:30000,windowsHide:true,env:{...process.env,TEMP:root,TMP:root,TMPDIR:root}});
 fs.writeFileSync(path.join(root,name+'.rendered.html'),run.stdout||'');
 assert.ok(/data-test-result="PASS"/.test(run.stdout||''),(run.stdout||'').match(/data-test-error="([^"]*)/)?.[1]||run.error?.message||run.stderr||'Browser did not complete');
}
console.log('PASS: actual hierarchy/model/evidence, YOU boundary, blocked hold confirmation and no replay, three modes. Screenshots: '+path.join(root,'hierarchy.png')+' ; '+path.join(root,'hierarchy-blocked.png'));
