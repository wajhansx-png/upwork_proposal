const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, filename);
const now = Date.now();
let db = {settings:{teammateName:'Areeba',timezone:'Asia/Karachi',checkinMinutes:5,requireProof:true,workEndHour:23},agent:{},tasks:[],donors:[],messages:[],subs:[{role:'teammate',sub:{endpoint:'test',keys:{p256dh:'a',auth:'b'}}}],hashes:{}};
let vision = {is_chat:false,message_sent:false,summary:'A promotional poster'};
const pushes=[];
const original = Module._load;
Module._load = function(request,parent,...rest){
  const from = parent?.filename ?? '';
  if(from.endsWith(path.join('lib','agent.ts'))){
    if(request === './db') return {readDb:async()=>structuredClone(db),withDb:async fn=>fn(db),newId:()=>crypto.randomUUID(),kvGetImage:async()=>null};
    if(request === './push') return {notify:async(...args)=>pushes.push(args)};
    if(request === './llm') return {visionEnabled:()=>true};
    if(request === './vision') return {readScreenshot:async()=>({seen:vision,status:'ok'}),nameMatches:()=>false,checkProof:async()=>null};
  }
  // No AI here: the rules read the messages, so this test is deterministic.
  if(from.endsWith(path.join('lib','understand.ts')) && request === './llm') return {llm:async()=>({text:null,status:'off'}),parseJson:()=>null};
  return original.call(this,request,parent,...rest);
};
const {handleTeammateMessage,runAgent,setProgress}=require('../src/lib/agent.ts');
const {liveUpdate}=require('../src/lib/task-state.ts');
const MIN=60000;
const makeTask=()=>({id:'test',title:'Send 10 DMs',kind:'dms',target:10,status:'open',createdAt:new Date(now).toISOString(),deadlineAt:new Date(now+3*3600000).toISOString(),unanswered:0});
const toHer=()=>pushes.filter(p=>p[0]==='teammate').length;
const toMe=()=>pushes.filter(p=>p[0]==='manager').length;
const myChat=()=>db.messages.filter(m=>m.owner==='manager');
(async()=>{
  db.tasks=[makeTask()];
  // First check-in after 3 minutes, never twice in the same tick.
  await runAgent(now+179000); assert.equal(pushes.length,0);
  await runAgent(now+181000); assert.equal(db.tasks[0].unanswered,1); assert.match(db.messages.at(-1).text,/can you start/);
  const before=pushes.length; await runAgent(now+181000); assert.equal(pushes.length,before,'same tick must not send twice');

  // She is silent: a push to her every 4 minutes, no limit. No push to the manager, one "No update" line that updates.
  const her0=toHer(), me0=toMe();
  let t=now+181000;
  await runAgent(t+3*MIN); assert.equal(toHer(),her0,'not before 4 minutes');
  for(let i=1;i<=10;i++){ t+=4*MIN; await runAgent(t); }
  assert.equal(toHer()-her0,10,'10 silent rounds = 10 pushes to her');
  assert.equal(toMe(),me0,'manager is not pushed while she is silent');
  const noUpd=myChat().filter(m=>/^No update from Areeba/.test(m.text));
  assert.equal(noUpd.length,1,'one "No update" line, updated in place');
  assert.match(noUpd[0].text,/Asked 11 times/);
  assert.match(db.messages.filter(m=>m.owner==='teammate').at(-1).text,/asked 11 times/);

  // The moment she replies, the manager gets a push.
  await handleTeammateMessage('I have not started'); assert.equal(db.tasks[0].startedAt,undefined);
  assert.equal(toMe(),me0+1,'her reply alerts the manager');
  assert.equal(db.tasks[0].unanswered,0);
  await handleTeammateMessage('I started'); assert.ok(db.tasks[0].startedAt);
  await handleTeammateMessage('I will send 10 DMs'); assert.equal(db.tasks[0].reportedDone,undefined,'a plan is not progress');
  await handleTeammateMessage('I sent 3'); assert.equal(db.tasks[0].reportedDone,3,'her word is the count');
  assert.doesNotMatch(db.messages.filter(m=>m.owner==='teammate').at(-1).text,/screenshot/i,'never asks for a screenshot');
  assert.match(myChat().at(-1).text,/3 of 10 sent/);
  const lastMe=pushes.filter(p=>p[0]==='manager').at(-1); assert.match(lastMe[2],/3 of 10 sent/);

  // A picture is just saved for the manager.
  await handleTeammateMessage('',{id:'pic',hash:'pic',dataUrl:'test'});
  assert.match(db.messages.filter(m=>m.owner==='teammate').at(-1).text,/Saved/);
  assert.equal(myChat().at(-1).img,'pic');

  // + and − buttons: quiet, one progress line for the manager that updates, one collapsing alert.
  const chat0=db.messages.length;
  await setProgress(5); await setProgress(6); await setProgress(4);
  assert.equal(db.tasks[0].reportedDone,4);
  assert.equal(db.messages.length,chat0+1,'button taps add one line, not one per tap');
  assert.match(myChat().at(-1).text,/4 of 10 sent/);
  assert.equal(pushes.filter(p=>p[0]==='manager').at(-1)[3].tag,'progress-test','progress alerts replace each other');
  await setProgress(10);
  assert.equal(db.tasks[0].status,'review','all sent moves the task to review');
  assert.match(liveUpdate(db.tasks[0]).detail,/10 of 10 DMs sent/);
  console.log('PASS: start check-in, 4-minute nudges with no limit, manager silent until she replies, her count counts, no screenshot asks, pictures saved, quiet +/- progress, completion.');
})().catch(e=>{console.error(e);process.exitCode=1;});
