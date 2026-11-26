// Full-page recap regression in Chromium with a synthetic, GET-only recap API.
// Optional CCBOARD_RECAP_FIXTURE renders an explicitly supplied local JSON response
// after the synthetic assertions. Its contents stay only in the temporary QA folder.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const temporary = 'D:/ChatGPT-Temp/ccboard-recap-20261125';
fs.mkdirSync(temporary, { recursive: true });
const root = fs.mkdtempSync(path.join(temporary, 'recap-ui-'));
let html = fs.readFileSync(new URL('../ui.html', import.meta.url), 'utf8');
const at = '2026-11-25T18:00:00Z';
const messages = [
  { id: 'm1', role: 'user', at, text: '我们要做房价预测项目。features 包括面积、卧室数、房龄和地段；需要清洗数据、划分训练集和测试集、比较 OLS 与梯度下降，并用 MSE 评价。' },
  { id: 'm2', role: 'assistant', at, final: true, text: '已经梳理了任务结构：先明确 features 与房价目标，再做清洗和标准化。接下来比较两种求解方式。这里是方案梳理，不是已经完成代码或实验。' },
  { id: 'm3', role: 'user', at, text: '既然 OLS 可以直接算出系数，为什么还要用 GD？它对这个房价项目有什么用？' },
  { id: 'm4', role: 'assistant', at, final: true, text: 'OLS 是最小二乘目标；在条件合适时可以直接求解系数。GD 是迭代优化方法，同样可以最小化平方误差。\n\n那它对你们有什么用？主要展示模型怎么学习：从初始参数开始，每一步沿损失下降方向更新，观察学习率与收敛曲线。\n\n建议：把直接求解的 OLS 当作基准，再用 GD 展示迭代过程；比较最终 MSE 和收敛表现，不要把 GD 写成另一种预测模型。' },
];
const ref = m => ({ messageId: m.id, text: m.text, at: m.at });
const house = { ok: true, sid: 'house', title: '房价预测：OLS 与梯度下降', version: 'fixture-v1', messages,
  coverage: { complete: true, truncated: false, malformedLines: 0, incompleteTail: false },
  current: { question: '那它对你们有什么用？' },
  recap: { goal: ref(messages[0]), background: [ref(messages[2])], reportedWork: [ref(messages[1]), ref(messages[3])], recentContext: messages.map(ref) } };
const optionalFixture = process.env.CCBOARD_RECAP_FIXTURE ? JSON.parse(fs.readFileSync(process.env.CCBOARD_RECAP_FIXTURE, 'utf8')) : null;
if (optionalFixture) assert.ok(optionalFixture.ok && Array.isArray(optionalFixture.messages), 'CCBOARD_RECAP_FIXTURE must contain a successful recap API JSON response');
const serial = value => JSON.stringify(value).replace(/</g, '\\u003c');
const bootstrap = `<script>
window.testErrors=[];addEventListener('error',e=>testErrors.push(e.message));addEventListener('unhandledrejection',e=>testErrors.push(String(e.reason)));
localStorage.clear();localStorage.setItem('ccb_lang','zh');localStorage.setItem('ccb_mode','wall');localStorage.setItem('ccb_orgshape','map');
window.testCalls=[];window.testHolds=new Set();window.testReleases={};window.testHouse=${serial(house)};window.testVisual=${serial(optionalFixture)};
window.testRecaps={house:testHouse,fast:{...testHouse,sid:'fast',title:'新会话',recap:{...testHouse.recap,goal:{...testHouse.recap.goal,text:'FAST 最新会话原始目标'}}},slow:{...testHouse,sid:'slow',recap:{...testHouse.recap,goal:{...testHouse.recap.goal,text:'SLOW 不应该覆盖'}}},missing:{ok:false,error:{code:'not_found',message:'找不到该聊天记录，但这不代表没有历史。'}},partial:{...testHouse,sid:'partial',coverage:{complete:false,truncated:true,malformedLines:2,incompleteTail:true,changedDuringRead:true}},visual:testVisual};
const session={sid:'house',title:testHouse.title,provider:'codex',cwd:'D:/fixture',status:'idle',startedAt:1,prompt:testHouse.messages[0].text,promptAt:Date.now(),result:testHouse.messages[3].text,resultAt:Date.now(),done:true,digest:{need:'reply',head:'OLS 与 GD 的区别',ask:'那它对你们有什么用？'},project:{key:'fixture',name:'房价项目'},nativeArchive:true};
window.fetch=async(url,opt={})=>{
 const body=opt.body?JSON.parse(opt.body):null;const method=opt.method||'GET';testCalls.push({url,body,method});let data={ok:true};
 if(url.startsWith('/api/state'))data={now:Date.now(),sessions:[session],pending:[],others:0,home:'D:/fixture',notices:[],providers:{codex:{ok:true,label:'Codex',models:[],efforts:['medium'],defaultModel:'',defaultEffort:'medium'}},archived:0,lost:[],crash:null,limits:{claude:[],codex:null},processed:{},workflows:{enabled:true,jobs:[]},org:{chief:null,nodes:{house:{role:'member'}}}};
 if(url.startsWith('/api/recap')){const p=new URL(url,'http://fixture').searchParams,sid=p.get('sid');if(method!=='GET')throw new Error('Recap requested a mutation');if(sid==='network')throw new Error('fixture network failure');data=p.get('check')?{ok:true,stale:false}:testRecaps[sid];if(testHolds.has(sid)){testHolds.delete(sid);await new Promise(r=>testReleases[sid]=r);}}
 if(url.startsWith('/api/turns'))data={turns:[]};
 return {ok:true,status:200,json:async()=>JSON.parse(JSON.stringify(data))};
};</script>`;
const tests = `<script>
const tick=()=>new Promise(r=>setTimeout(r,45));
const check=(ok,message)=>{if(!ok)throw new Error(message)};
const recapText=()=>document.querySelector('#recapBody').textContent;
const recapCount=sid=>testCalls.filter(c=>c.url==='/api/recap?sid='+sid).length;
const closeRecap=async()=>{document.querySelector('#recapDlg').close();await tick();};
(async()=>{try{
 await tick();await tick();check(!testErrors.length,testErrors.join(';'));
 const initialMutations=testCalls.filter(c=>c.method!=='GET').length;
 const card=document.querySelector('.card[data-sid="house"] [data-act="recap"]');check(card,'ordinary card recap entry exists');card.click();await tick();
 check(document.querySelector('#recapDlg').open,'card click opens recap');
 const text=recapText();
 for(const expected of ['最初想做什么','features 包括面积、卧室数、房龄和地段','已有回复与进展','已经梳理了任务结构','你最近问的是','既然 OLS 可以直接算出系数','助手最近的结论或建议','把直接求解的 OLS 当作基准','看板自动标记的句子（可能误判）','这句的原文上下文','主要展示模型怎么学习','反问、小标题也可能触发自动标记'])check(text.includes(expected),'missing explanatory context: '+expected);
 check(!document.querySelector('#recapHistory').open,'full transcript initially collapsed');
 document.querySelector('[data-recap-source="m4"]').click();await tick();
 check(document.querySelector('#recapHistory').open,'source link opens transcript');
 const source=document.querySelector('.recap-message[data-message-id="m4"]');check(source?.textContent.includes(testHouse.messages[3].text),'source link exposes complete exact assistant message');
 const sourceRect=source.getBoundingClientRect(),bodyRect=document.querySelector('#recapBody').getBoundingClientRect();check(sourceRect.bottom>bodyRect.top&&sourceRect.top<bodyRect.bottom,'source anchor is brought into view');
 await closeRecap();await openDetail('house',testHouse.title);document.querySelector('#detailRecap').click();await tick();check(document.querySelector('#recapDlg').open,'detail recap button opens recap');await closeRecap();document.querySelector('#detail').close();await tick();
 document.querySelector('[data-mode="org"]').click();await tick();const orgButton=document.querySelector('.onode[data-sid="house"] .orecap');check(orgButton,'organization node recap entry exists');orgButton.click();await tick();check(document.querySelector('#recapDlg').open,'organization recap click opens recap');await closeRecap();
 testHolds.add('house');const before=recapCount('house');const first=openRecap('house','first');await tick();await openRecap('house','duplicate');check(recapCount('house')===before+1,'repeated open must share in-flight request');testReleases.house();await first;await closeRecap();
 testHolds.add('slow');const slow=openRecap('slow','old');await tick();await openRecap('fast','latest');check(recapText().includes('FAST 最新会话原始目标'),'new chat response appears');testReleases.slow();await slow;check(recapText().includes('FAST 最新会话原始目标')&&!recapText().includes('SLOW 不应该覆盖'),'late old chat cannot replace latest response');await closeRecap();
 await openRecap('missing','缺失记录');check(recapText().includes('找不到该聊天记录，但这不代表没有历史。')&&!recapText().includes('[object Object]'),'error object message visible');await closeRecap();
 await openRecap('network','读取错误');check(recapText().includes('回顾读取失败，请重试；这不代表没有历史。'),'network error is not empty history');await closeRecap();
 await openRecap('partial','部分记录');for(const expected of ['这是部分可读记录','部分日志行损坏','记录仍在写入或读取时发生变化'])check(recapText().includes(expected),'coverage caveat: '+expected);check(!document.querySelector('#recapStale').hidden,'changed snapshot marked stale');await closeRecap();
 check(testCalls.filter(c=>c.method!=='GET').length===initialMutations,'recap interactions must not ack/send/process/archive or mutate');
 check(testCalls.filter(c=>c.url.startsWith('/api/recap')).every(c=>c.method==='GET'&&!c.body),'recap requests use GET only');
 document.querySelector('[data-mode="wall"]').click();await tick();await openRecap(testVisual?'visual':'house',testVisual?.title||testHouse.title);await tick();
 check(!testErrors.length,testErrors.join(';'));
 const dialog=document.querySelector('#recapDlg'),body=document.querySelector('#recapBody');check(dialog.getBoundingClientRect().width>500,'recap modal visibly laid out');check(body.scrollWidth<=body.clientWidth+2,'no horizontal overflow');
 body.scrollTop=0;document.body.dataset.testResult='PASS';
 }catch(e){document.body.dataset.testResult='FAIL';document.body.dataset.testError=e.stack||String(e);}})();
</script>`;
html = html.replace('<head>', '<head>' + bootstrap).replace('</body>', tests + '</body>');
const fixture = path.join(root, 'recap.html');fs.writeFileSync(fixture, html);
const browser = [process.env.CCBOARD_TEST_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(p=>fs.existsSync(p));
assert.ok(browser, 'A local Chromium browser is required.');
const screenshot = path.join(root, optionalFixture ? 'recap-local-fixture.png' : 'recap-house.png');
const run=spawnSync(browser,['--headless','--disable-gpu','--no-first-run','--disable-extensions','--user-data-dir='+path.join(root,'profile'),'--window-size=1180,1160','--virtual-time-budget=4000','--screenshot='+screenshot,'--dump-dom',pathToFileURL(fixture).href],{encoding:'utf8',timeout:30000,windowsHide:true,env:{...process.env,TEMP:root,TMP:root,TMPDIR:root}});
fs.writeFileSync(path.join(root,'rendered.html'),run.stdout||'');
assert.ok(/data-test-result="PASS"/.test(run.stdout||''),(run.stdout||'').match(/data-test-error="([^"]*)/)?.[1]||run.error?.message||run.stderr||'Browser did not finish');
console.log('PASS: recap content/source anchors, three entry points, GET-only behavior, duplicate/late requests, errors and partial coverage. Screenshot: '+screenshot);
