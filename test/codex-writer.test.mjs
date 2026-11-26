// Real installed Codex, two isolated app-server instances, synthetic history only.
// Never starts a turn: this reproduces a loaded writer lock without any model inference.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { codexRequest } from '../codex-rpc.mjs';

const base = 'D:/ChatGPT-Temp/ccboard-writer-20261125';
fs.mkdirSync(base, { recursive: true });
const root = fs.mkdtempSync(path.join(base, 'test-'));
const home = path.join(root, 'home');
const codexHome = path.join(home, '.codex');
const directory = path.join(codexHome, 'sessions/2026/11/25');
fs.mkdirSync(directory, { recursive: true });
const bin = execFileSync('where.exe', ['codex.exe'], {encoding:'utf8'}).trim().split(/\r?\n/)[0];
const env = {...process.env,HOME:home,USERPROFILE:home,CODEX_HOME:codexHome,TEMP:root,TMP:root,TMPDIR:root};
delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY;
fs.writeFileSync(path.join(codexHome,'config.toml'),'[features]\napps = false\nplugins = false\nhooks = false\n');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const makeFixture = id => {
  const file = path.join(directory, `rollout-2026-11-25T00-00-00-${id}.jsonl`);
  const meta = {type:'session_meta',timestamp:'2026-11-25T00:00:00Z',payload:{id,timestamp:'2026-11-25T00:00:00Z',cwd:home,originator:'codex_cli_rs',cli_version:'0.0.0',source:'cli',model_provider:'openai'}};
  fs.writeFileSync(file,JSON.stringify(meta)+'\n');
  return {id,file,archived:path.join(codexHome,'archived_sessions',path.basename(file))};
};
const ownerFixture = makeFixture('019abcde-0000-7000-8000-000000000051');
const releaseFixture = makeFixture('019abcde-0000-7000-8000-000000000052');
const evidence = {root,syntheticOnly:true,turnsStarted:0,steps:[]};

class Owner {
  constructor() {
    this.id=0;this.pending=new Map();this.notifications=[];this.sent=[];this.closed=false;
    this.child=spawn(bin,['app-server','--stdio'],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.exited=new Promise(resolve=>this.child.once('exit',resolve));
    this.child.stdout.setEncoding('utf8');this.child.stderr.resume();let buffer='';
    const fail=error=>{this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();};
    this.child.on('error',fail);this.child.on('exit',()=>fail(new Error('Synthetic owner service exited')));this.child.stdin.on('error',fail);
    this.child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let m;try{m=JSON.parse(line);}catch{continue;}if(m.method){this.notifications.push(m);if(m.id!==undefined)this.child.stdin.write(JSON.stringify({id:m.id,error:{code:-32601,message:'No interactive requests permitted in writer test'}})+'\n');continue;}const p=this.pending.get(m.id);if(!p)continue;this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Object.assign(new Error(m.error.message),{rpcCode:m.error.code})):p.resolve(m.result);}});
  }
  request(method,params={}) {
    assert.ok(['initialize','thread/resume','thread/archive','thread/unsubscribe','thread/loaded/list'].includes(method),'Test forbids inference or unrelated mutations: '+method);
    assert.equal(this.closed,false);this.sent.push(method);
    return new Promise((resolve,reject)=>{const id=++this.id;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Synthetic owner request timeout: '+method));},15000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,method,params})+'\n');});
  }
  async init() {await this.request('initialize',{clientInfo:{name:'ccboard_writer_test',version:'1'},capabilities:null});this.child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');}
  async close() {if(!this.closed){this.child.stdin.end();this.child.kill();}await this.exited;}
}
const owner = new Owner();
const archiveFromB = id => codexRequest(bin,home,'thread/archive',{threadId:id},{spawnProcess:(command,args,options)=>spawn(command,args,{...options,env})});
const expectConflict = async fixture => {
  let error;
  try {await archiveFromB(fixture.id);}catch(e){error=e;}
  assert.ok(error,'Independent service unexpectedly archived a thread held by owner A');
  evidence.steps.push({operation:'B archive while A owns writer',threadId:fixture.id,error:error.message});
  console.log('Observed B failure: '+error.message);
  assert.match(error.message,/active\s+writer/i,'Expected an explicit active-writer failure');
  assert.ok(fs.existsSync(fixture.file),'Failed archive must retain active transcript');
  assert.equal(fs.existsSync(fixture.archived),false);
  return error;
};
try {
  await owner.init();
  for(const fixture of [ownerFixture,releaseFixture]) {
    const resumed=await owner.request('thread/resume',{threadId:fixture.id,cwd:home,approvalPolicy:'never',sandbox:'read-only',excludeTurns:true});
    assert.equal(resumed.thread.id,fixture.id);
    assert.ok((await owner.request('thread/loaded/list')).data.includes(fixture.id));
    evidence.steps.push({operation:'A resume without turn',threadId:fixture.id,status:resumed.thread.status});
    const conflict = await expectConflict(fixture);
    if(fixture===ownerFixture) {
      // Exercise the actual CCBoard handler with the error returned by real service B.
      const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
      const handler=source.slice(source.indexOf('async function archiveWindowsSession(sid)'),source.indexOf('function windowsSessions(seen)'));
      assert.ok(handler.includes('CODEX_WRITER_OWNED'),'Current CCBoard handler must map writer ownership');
      const leaving=new Map(),windowsArchiving=new Set();
      const context=vm.createContext({fs,windowsCatalogAt:0,windowsArchiving,scanSessions(){},sessions:[{sid:fixture.id,provider:'codex',status:'idle',file:fixture.file}],workflows:null,codexBin:bin,HOME:home,leaving,
        codexRequest:async(_bin,_home,method,params)=>{assert.equal(method,'thread/archive');assert.equal(params.threadId,fixture.id);throw conflict;}});
      vm.runInContext(handler,context);
      const mapped=await context.archiveWindowsSession(fixture.id);
      assert.equal(mapped.ok,false);assert.equal(mapped.code,'CODEX_WRITER_OWNED');assert.match(mapped.error,/尚未归档/);
      assert.equal(windowsArchiving.size,0);assert.equal(leaving.has(fixture.id),false);assert.ok(fs.existsSync(fixture.file));
      evidence.steps.push({operation:'actual CCBoard handler maps real CLI conflict',result:JSON.parse(JSON.stringify(mapped))});
      const archived=await owner.request('thread/archive',{threadId:fixture.id});
      assert.ok(fs.existsSync(fixture.archived));assert.equal(fs.existsSync(fixture.file),false);
      evidence.steps.push({operation:'same owner A archive',threadId:fixture.id,result:archived});
      console.log('Verified: same owner A archives its idle loaded thread successfully.');
    } else {
      const released=await owner.request('thread/unsubscribe',{threadId:fixture.id});
      evidence.steps.push({operation:'A unsubscribe',threadId:fixture.id,result:released});
      await delay(150);
      const loaded=await owner.request('thread/loaded/list');
      evidence.steps.push({operation:'A loaded threads after unsubscribe',result:loaded});
      await expectConflict(fixture);
      assert.equal(owner.closed,false,'Unsubscribe does not stop the owner process');
      evidence.steps.push({operation:'unsubscribe does not release active writer',threadId:fixture.id});
      console.log('Verified: unsubscribe removes the subscription but B still encounters the active writer.');
      await owner.close();
      await archiveFromB(fixture.id);
      assert.ok(fs.existsSync(fixture.archived));assert.equal(fs.existsSync(fixture.file),false);
      evidence.steps.push({operation:'B archive after synthetic owner A exits',threadId:fixture.id});
      console.log('Verified: B archives successfully after only the synthetic owner A exits.');
    }
  }
  assert.equal(owner.sent.includes('turn/start'),false);
  assert.equal(owner.notifications.some(m=>m.method==='turn/started'),false,'No model turn may run');
  evidence.ok=true;
  console.log('PASS: active-writer reproduction and release mechanisms. Evidence: '+path.join(root,'evidence.json'));
} catch(error) {evidence.ok=false;evidence.failure=error.message;throw error;}
finally {fs.writeFileSync(path.join(root,'evidence.json'),JSON.stringify(evidence,null,2));await owner.close();}
