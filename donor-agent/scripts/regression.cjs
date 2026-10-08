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
const {handleTeammateMessage,runAgent}=require('../src/lib/agent.ts');
const {evidenceCount,liveUpdate}=require('../src/lib/task-state.ts');
const makeTask=()=>({id:'test',title:'Send 10 DMs',kind:'dms',target:10,status:'open',createdAt:new Date(now).toISOString(),deadlineAt:new Date(now+3600000).toISOString(),unanswered:0});
(async()=>{
  db.tasks=[makeTask()];
  await runAgent(now+179000); assert.equal(pushes.length,0);
  await runAgent(now+181000); assert.equal(db.tasks[0].unanswered,1); assert.match(db.messages.at(-1).text,/can you start/);
  const before=pushes.length; await runAgent(now+181000); assert.equal(pushes.length,before,'same tick must not send twice');
  await handleTeammateMessage('I have not started'); assert.equal(db.tasks[0].startedAt,undefined);
  await handleTeammateMessage('I started'); assert.ok(db.tasks[0].startedAt);
  await handleTeammateMessage('I will send 10 DMs'); assert.equal(db.tasks[0].reportedDone,undefined);
  await handleTeammateMessage('I sent 4 DMs'); assert.equal(db.tasks[0].reportedDone,4); assert.equal(evidenceCount(db.tasks[0]),0);
  await handleTeammateMessage('I sent 3 DMs in total.'); assert.equal(db.tasks[0].reportedDone,3,'corrections must replace, not add to, the total');
  await handleTeammateMessage('',{id:'poster',hash:'poster',dataUrl:'test'}); assert.equal(evidenceCount(db.tasks[0]),0); assert.equal(db.tasks[0].evidence.at(-1).verdict,'rejected');
  vision={is_chat:true,message_sent:true,person_name:'Recipient A',message_text:'Hello',summary:'Outgoing sent message'};
  await handleTeammateMessage('',{id:'proof',hash:'proof',dataUrl:'test'}); assert.equal(evidenceCount(db.tasks[0]),1);
  await handleTeammateMessage('',{id:'proof2',hash:'proof',dataUrl:'test'}); assert.equal(evidenceCount(db.tasks[0]),1);
  await handleTeammateMessage('I sent 10 DMs'); assert.equal(db.tasks[0].status,'open','a claimed total stays open until proof covers the target');
  assert.match(liveUpdate(db.tasks[0]).detail,/10 of 10 DMs reported/);
  console.log('PASS: 2-minute start follow-up, duplicate tick suppression, negated start, future promise, reported progress, rejected poster, supported recipient, duplicate evidence, completion review.');
})().catch(e=>{console.error(e);process.exitCode=1;});
