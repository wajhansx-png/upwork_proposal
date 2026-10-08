const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
process.env.BLOB_STORE_ID='test';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.KV_REST_API_URL;
let data={messages:[],agent:{}},version=1,writes=0;
const load=Module._load;
Module._load=function(name,...args){
  if(name==='@vercel/blob')return {
    get:async(_p,options)=>{assert.equal(options.headers['Accept-Encoding'],'identity');return {stream:new Response(JSON.stringify(data)).body,blob:{etag:String(version)}};},
    put:async(_p,body,options)=>{
      writes++;
      if(writes===1){ data.messages.push({id:'concurrent',text:'preserve this'}); version++; throw new Error('Vercel Blob: Precondition failed: ETag mismatch.'); }
      assert.equal(options.ifMatch,String(version)); data=JSON.parse(body);version++;
    }
  };
  return load.call(this,name,...args);
};
(async()=>{
  const {withDb}=require('../src/lib/db.ts');
  await withDb(d=>{d.messages.push({id:'ours',text:'save this'});});
  assert.equal(writes,2);
  assert.deepEqual(data.messages.map(m=>m.id),['concurrent','ours']);
  console.log('PASS: storage conflict retried, concurrent message preserved, new message saved exactly once.');
})().catch(e=>{console.error(e);process.exitCode=1;});
