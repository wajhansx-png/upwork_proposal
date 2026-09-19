/* ---------- opened as a downloaded file? the AI lives on the server ---------- */
const LIVE_URL='https://proposal-studio-mauve.vercel.app';
if(location.protocol==='file:'){
  const b=document.createElement('div');
  b.className='filewarn';
  b.innerHTML='<b>This is a downloaded copy - it cannot write proposals.</b>'+
    '<span>The AI lives on the server, not inside this file. Open the real app here:</span><br>'+
    '<a href="'+LIVE_URL+'">Open Proposal Studio</a>';
  document.body.insertBefore(b,document.body.firstChild);
}

const KEY='ps_portfolio_v1';
let portfolio=[];
function load(){
  try{ portfolio=JSON.parse(localStorage.getItem(KEY)||'[]'); }catch(e){ portfolio=[]; }
  if(!Array.isArray(portfolio)) portfolio=[];
}
function save(){
  try{ localStorage.setItem(KEY,JSON.stringify(portfolio)); }
  catch(e){ toast('Storage is full - remove a file to add more'); }
}

let toastTimer;
function toast(msg){
  const t=document.getElementById('toast');
  if(!t) return;
  t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'),2200);
}
function setStatus(msg,kind){
  const el=document.getElementById('status');
  if(!el) return;
  el.textContent=msg||'';
  el.className='status'+(kind?' '+kind:'');
}
function esc(s){
  return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ---------- bias tip rotator: rotates a bidding tip per page load to avoid banner-blindness ---------- */
const BIAS_TIPS=[
  ['One good bid','Ten fast bids do less than one careful one. Pick the job that really fits you. Skip the rest.'],
  ['First line matters most','The client reads your first line and decides in 3 seconds. Make it about their job, not your skills.'],
  ['Use their own words','Copy some words from their post into your reply. Their own words feel safe to them.'],
  ['Skip the greeting','No "Dear Hiring Manager". No "I hope this finds you well". Start with their problem.'],
  ['Bid early, not late','The first few bids are read the most. Send a short one fast. You can always add detail later.'],
  ['Ask one small thing','End with one small easy question. Even a one-line reply is how the door opens.'],
  ['Show, do not tell','"5 years experience" is boring. "I built this same checkout last month" wins the reply.'],
  ['No fancy words','"Leverage" and "seasoned" sound like a robot. Clients skip them. Say it plain.'],
  ['One link is enough','One project link with one line about it beats five links with none.'],
  ['This is normal','You may need 20 or 30 bids for one reply. It is not you. It is the math. Keep going.'],
  ['Match their length','A short post wants a short bid. A long detailed post wants a longer, careful reply.'],
  ['Numbers beat adjectives','"48 hours" beats "quickly". "$400" beats "affordable". Numbers feel real to the client.'],
  ['Do not brag','Do not call yourself expert. Show one real thing you built. Proof is louder than promises.'],
  ['Free test is a trap','If they ask for a free test task, offer a small paid one instead. Your time is not free.'],
  ['Read it out loud','Before you send, read your bid out loud. If it sounds like a robot, fix one line first.'],
  ['Their goal first','Open with what THEY want to reach, not with what YOU know how to do.'],
  ['"Long-term" is not money','"Long-term project" is a wish, not a rate. Price the first task on its own.'],
  ['Answer every question','If they asked 3 questions, answer 3. One line each. Missing one looks careless.'],
  ['Say the first step','Not "I can do everything". Say "day one I would start with X". Motion feels real.'],
  ['A clean bid wins','A tidy, well-spaced proposal makes them trust your work too. Take 20 seconds to check.'],
  ['Their pain is fresh','They posted today because something broke today. Speak to that fresh pain, not the whole plan.'],
  ['You are not late','Even bids sent hours after the post get read. Do not skip a good match because it is not new.'],
  ['One real detail','Mention one real thing from their post. It proves you actually read it.'],
  ['Cheap is not a plan','Do not go too low on price. Cheap clients bring the most stress. Aim higher, bid less often.'],
  ['Urgent + cheap = lie','"Urgent and cheap" always ends in stress. Quote your real rate or skip this one.'],
  ['Two lines decide it','The first two lines decide if they read the rest. Spend most of your time on those two.'],
  ['Use their name','If they signed the post "- Sara", start with "Hi Sara,". It changes the whole feel.'],
  ['Stand tall, not small','"I would love the chance" sounds small. "Here is how I would start" sounds like a pro.'],
  ['Short is respect','110 to 150 words is the sweet spot. Longer than that and they scroll away.'],
  ['Best lines at the ends','The middle gets skimmed. Put your strongest line first and your ask last.'],
  ['Do not compare up','Do not compare your bid to a top freelancer. Compare it to yours from last week.'],
  ['Their fears in the post','A long list of "must have" means they got burned before. Say you understand that.'],
  ['Fixed price feels safer','For small jobs, offer a fixed price. Clients get scared of hourly meters they cannot see.'],
  ['End with one clear step','End with "want the 20 minute plan?" not "let me know". Give them one small yes to say.'],
  ['Sound like a person','Change two lines to sound like real you. Warm and honest beats perfect and cold.'],
  ['Skip the bad jobs','Passing on a low-budget job is a skill. Your connects are worth more than any one bid.'],
  ['You need one client','You are not chasing 100 clients. You need one good one this week. Slow down and pick.'],
  ['Rest matters too','Ten careful bids beat forty tired ones. Take a break. Come back with clear eyes.'],
  ['Monday morning bids','Bids sent Monday morning get more reads. Save your best jobs for a fresh week.'],
  ['You already know enough','You have the skill. You have the app. Now just send the next honest bid.'],
];
const BIAS_MS=14000;
let biasIdx=-1, biasTimer;
function renderBias(i){
  const el=document.getElementById('biasChip'), tx=document.getElementById('biasText');
  if(!el||!tx) return;
  el.textContent=BIAS_TIPS[i][0];
  tx.textContent=BIAS_TIPS[i][1];
}
/* snap to 0 with no transition, force a reflow, then kick off the 14s linear fill */
function restartBiasBar(){
  const bar=document.getElementById('biasBar');
  if(!bar) return;
  bar.classList.remove('filling');
  bar.style.width='0%';
  void bar.offsetWidth;
  bar.classList.add('filling');
  bar.style.width='100%';
}
/* Pick a new tip that is not the one already showing, so the rotation never
   stalls on a repeat. With ~40 tips the pool feels effectively unlimited. */
function nextBias(){
  const el=document.getElementById('biasChip');
  if(!el) return;
  const wrap=el.closest('.bias');
  let n; do{ n=Math.floor(Math.random()*BIAS_TIPS.length); }while(n===biasIdx&&BIAS_TIPS.length>1);
  biasIdx=n;
  restartBiasBar();
  /* Cross-fade: fade the current tip out, swap the text while invisible, fade
     the new one in. Honors prefers-reduced-motion via the CSS transition. */
  if(wrap){
    wrap.classList.add('swapping');
    setTimeout(()=>{ renderBias(n); wrap.classList.remove('swapping'); },300);
  }else{
    renderBias(n);
  }
}
function startBiasRotation(){
  clearInterval(biasTimer);
  /* 14s per tip - fast rotation reads as a nagging ad, this gives one idea room to land */
  biasTimer=setInterval(nextBias,BIAS_MS);
}
function pickBias(){
  const i=Math.floor(Math.random()*BIAS_TIPS.length);
  biasIdx=i; renderBias(i);
  restartBiasBar();
  startBiasRotation();
}
function closeBias(){
  const el=document.querySelector('.bias');
  if(el) el.classList.add('hide');
  clearInterval(biasTimer);
}

/* ---------- loader hint rotator: labor-illusion lines cut perceived wait vs. a silent skeleton ---------- */
const LOAD_HINTS=[
  'Reading the post the way a client would skim it…',
  'Pulling out what they actually care about…',
  'Finding your closest piece of work…',
  'Cutting anything that sounds like a template…',
  'Making the first line worth the click…',
];
let loadHintTimer;
function startLoaderHints(){
  const el=document.getElementById('loadHint');
  if(!el) return;
  let i=Math.floor(Math.random()*LOAD_HINTS.length);
  el.textContent=LOAD_HINTS[i];
  clearInterval(loadHintTimer);
  loadHintTimer=setInterval(()=>{
    i=(i+1)%LOAD_HINTS.length;
    el.style.opacity='0';
    setTimeout(()=>{ el.textContent=LOAD_HINTS[i]; el.style.opacity='1'; },160);
  },1400);
}
function stopLoaderHints(){
  clearInterval(loadHintTimer);
  const el=document.getElementById('loadHint');
  if(el) el.textContent='';
}

/* ---------- fake-but-honest progress readout: climbs toward 92%, never
   promises a finish time it can't back up, snaps to 100% only on success ---------- */
let loadPctTimer;
function startLoadPct(){
  const numEl=document.getElementById('loadPctNum');
  const fillEl=document.getElementById('loadBarFill');
  if(!numEl||!fillEl) return;
  let pct=0;
  numEl.textContent='0%';
  fillEl.style.width='0%';
  clearInterval(loadPctTimer);
  loadPctTimer=setInterval(()=>{
    pct+=Math.max(0.4,(92-pct)*0.09);
    if(pct>92) pct=92;
    numEl.textContent=Math.round(pct)+'%';
    fillEl.style.width=pct+'%';
  },180);
}
function finishLoadPct(){
  return new Promise(resolve=>{
    clearInterval(loadPctTimer);
    const numEl=document.getElementById('loadPctNum');
    const fillEl=document.getElementById('loadBarFill');
    if(!numEl||!fillEl){ resolve(); return; }
    numEl.textContent='100%';
    fillEl.style.width='100%';
    setTimeout(resolve,220);
  });
}
function stopLoadPct(){
  clearInterval(loadPctTimer);
}
function clearJob(){
  jobEl.value='';
  document.getElementById('worthRow').classList.add('hide');
  document.getElementById('outReady').classList.add('hide');
  document.getElementById('outLoading').classList.add('hide');
  document.getElementById('outEmpty').classList.remove('hide');
  document.getElementById('wordPill').classList.add('hide');
  document.getElementById('output').value='';
  document.getElementById('genLabel').textContent='Write my proposal';
  setStatus('');
  jobEl.focus();
  syncJobCtx();
}

/* ---------- mobile: one screen at a time ----------
   #jobCard is a normal card on desktop; on mobile it's a full-screen sheet
   (see legacy.css) that collapses to the #jobCtx first-line bar when closed,
   so Your proposal gets the whole screen instead of a cramped half. The
   .mobclosed class only has a visual effect inside that mobile breakpoint,
   so these need no viewport checks - harmless no-ops on desktop. */
function syncJobCtx(){
  const ctx=document.getElementById('jobCtx'), ctxText=document.getElementById('jobCtxText');
  const card=document.getElementById('jobCard');
  if(!ctx||!ctxText||!card) return;
  const val=jobEl.value.trim();
  const cardOpen=!card.classList.contains('mobclosed');
  const onWork=!document.getElementById('workView').classList.contains('hide');
  if(cardOpen||!val||!onWork){
    ctx.classList.add('hide');
  }else{
    ctxText.textContent=val.split('\n')[0].slice(0,80);
    ctx.classList.remove('hide');
  }
}
function openJobCard(){
  document.getElementById('jobCard').classList.remove('mobclosed');
  syncJobCtx();
}
function closeJobCard(){
  document.getElementById('jobCard').classList.add('mobclosed');
  syncJobCtx();
}

/* ---------- portfolio ---------- */
function avatar(it,cls){
  if(it.thumb) return '<img class="'+cls+'" src="'+esc(it.thumb)+'" alt="">';
  const tag=it.kind==='pdf'?'PDF':(it.kind==='link'?'WEB':'IMG');
  return '<div class="'+cls+'">'+tag+'</div>';
}
function renderItems(){
  const list=document.getElementById('itemList');
  if(!list) return;
  const c=document.getElementById('pfCount');
  if(c) c.textContent=portfolio.length? portfolio.length+(portfolio.length===1?' item saved':' items saved'):'';
  if(!portfolio.length){
    list.innerHTML='<div class="eitems">Nothing saved yet. Add a link or a file above.</div>';
    return;
  }
  list.innerHTML=portfolio.map((it,i)=>
    '<div class="item">'+avatar(it,'av')+
    '<div class="meta"><div class="t">'+esc(it.title)+'</div>'+
    '<div class="s">'+esc(it.url||it.fileName||'')+'</div></div>'+
    '<button class="del" onclick="removeItem('+i+')" aria-label="Remove">&#10005;</button></div>'
  ).join('');
}
function refresh(){ renderItems(); }
function addLink(){
  const u=document.getElementById('lnkUrl'), t=document.getElementById('lnkTitle');
  let url=u.value.trim();
  if(!url){ u.focus(); return; }
  if(!/^https?:\/\//i.test(url)) url='https://'+url;
  const title=t.value.trim()||url.replace(/^https?:\/\//,'').split('/')[0];
  portfolio.push({kind:'link',title:title,url:url});
  save(); refresh();
  u.value=''; t.value=''; u.focus();
  toast('Link added');
}
function removeItem(i){ portfolio.splice(i,1); save(); refresh(); toast('Removed'); }
function thumbFromImage(file){
  return new Promise(resolve=>{
    const fr=new FileReader();
    fr.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        const max=180, scale=Math.min(max/img.width,max/img.height,1);
        const c=document.createElement('canvas');
        c.width=Math.round(img.width*scale); c.height=Math.round(img.height*scale);
        c.getContext('2d').drawImage(img,0,0,c.width,c.height);
        try{ resolve(c.toDataURL('image/jpeg',0.7)); }catch(e){ resolve(null); }
      };
      img.onerror=()=>resolve(null);
      img.src=fr.result;
    };
    fr.onerror=()=>resolve(null);
    fr.readAsDataURL(file);
  });
}
async function addFiles(files){
  let added=0;
  for(const f of files){
    const isPdf=f.type==='application/pdf'||/\.pdf$/i.test(f.name);
    const isImg=/^image\//.test(f.type);
    if(!isPdf&&!isImg) continue;
    const thumb=isImg? await thumbFromImage(f): null;
    portfolio.push({kind:isPdf?'pdf':'image',title:f.name.replace(/\.[^.]+$/,''),fileName:f.name,thumb:thumb||null});
    added++;
  }
  if(added){ save(); refresh(); toast(added+(added===1?' file added':' files added')); }
}
function openPf(){
  document.getElementById('pfOverlay').classList.remove('hide');
  renderItems();
  setTimeout(()=>document.getElementById('lnkUrl').focus(),60);
}
function closePf(){
  document.getElementById('pfOverlay').classList.add('hide');
  jobEl.focus();
}

/* ---------- words ---------- */
function wordCount(t){ return (t.trim().match(/\S+/g)||[]).length; }
function showWords(){
  const n=wordCount(document.getElementById('output').value);
  const p=document.getElementById('wordPill');
  p.classList.remove('hide');
  /* sweet spot 110-150 words - ✓ inside the range, amber warn above it, neutral below */
  const inSweet=n>=110&&n<=150;
  p.classList.toggle('ok',inSweet);
  p.classList.toggle('warn',n>160);
  p.textContent=(inSweet?'✓ ':'')+n+' words';
  const cb=document.getElementById('copyBtn');
  if(cb) cb.textContent='Copy '+n+'-word proposal';
}

/* ---------- streak & lifetime count ---------- */
const STATS_KEY='ps_stats_v1';
function loadStats(){ try{ return JSON.parse(localStorage.getItem(STATS_KEY)||'{}')||{}; }catch(e){ return {}; } }
function saveStats(s){ try{ localStorage.setItem(STATS_KEY,JSON.stringify(s)); }catch(e){} }
function todayStr(){ return new Date().toISOString().slice(0,10); }
function bumpStats(){
  const s=loadStats(), today=todayStr();
  s.total=(s.total||0)+1;
  if(s.lastDate!==today){
    const y=new Date(); y.setDate(y.getDate()-1);
    s.streak=(s.lastDate===y.toISOString().slice(0,10))?(s.streak||0)+1:1;
    s.lastDate=today;
  }
  saveStats(s); renderStats(s);
}
function renderStats(s){
  s=s||loadStats();
  const el=document.getElementById('statChips');
  if(!el) return;
  const streak=s.streak||0, total=s.total||0;
  let html='';
  if(streak>0) html+='<span>\u{1F525} '+streak+' day'+(streak===1?'':'s')+' streak</span>';
  html+='<span>✍️ '+total+' proposal'+(total===1?'':'s')+' written</span>';
  el.innerHTML=html;
}

/* ---------- momentum meter: a draining bar (loss aversion), snaps back full the instant a proposal is written ---------- */
const MOMENTUM_KEY='ps_momentum_ts_v1';
const MOMENTUM_DECAY_MS=40*60*1000;
const MOMENTUM_FLOOR=15;
function setMomentumNow(){ try{ localStorage.setItem(MOMENTUM_KEY,String(Date.now())); }catch(e){} }
function momentumPercent(){
  let ts=0;
  try{ ts=parseInt(localStorage.getItem(MOMENTUM_KEY)||'0',10)||0; }catch(e){}
  if(!ts) return 100;
  const elapsed=Date.now()-ts;
  const pct=100-Math.min(100-MOMENTUM_FLOOR,(elapsed/MOMENTUM_DECAY_MS)*(100-MOMENTUM_FLOOR));
  return Math.max(MOMENTUM_FLOOR,Math.round(pct));
}

/* ---------- dark mode ---------- */
const DARK_KEY='ps_dark_v1';
const MOON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const SUN='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/></svg>';
function renderThemeBtn(){
  const b=document.getElementById('themeBtn');
  if(!b) return;
  const on=document.documentElement.classList.contains('dark');
  b.innerHTML=on?SUN:MOON;
  b.title=on?'Switch to light mode':'Switch to dark mode';
}
function toggleTheme(){
  const on=document.documentElement.classList.toggle('dark');
  try{ localStorage.setItem(DARK_KEY,on?'1':'0'); }catch(e){}
  renderThemeBtn();
}
function initTheme(){
  let on=false;
  try{ on=localStorage.getItem(DARK_KEY)==='1'; }catch(e){}
  if(on) document.documentElement.classList.add('dark');
  renderThemeBtn();
}

/* ---------- Your work / Recent ---------- */
function showTab(name){
  const w=document.getElementById('tabWork'), r=document.getElementById('tabRecent');
  if(w) w.classList.toggle('on',name==='work');
  if(r) r.classList.toggle('on',name==='recent');
  document.getElementById('workView').classList.toggle('hide',name!=='work');
  document.getElementById('recentView').classList.toggle('hide',name!=='recent');
  if(name==='recent'){ renderStats(); renderRecentPanel(); }
  syncJobCtx();
}
function renderRecentPanel(){
  const list=document.getElementById('recentList');
  if(!list) return;
  const h=loadHist();
  if(!h.length){
    list.innerHTML='<div class="rempty">Nothing written yet - your last 6 proposals show up here.</div>';
    return;
  }
  list.innerHTML=h.map((it,i)=>
    '<div class="ritem" onclick="restoreHist('+i+');showTab(\'work\')">'+
    '<div class="rj">'+esc(it.j||'Proposal')+'</div>'+
    '<div class="rp">'+esc((it.t||'').replace(/\s+/g,' ').trim().slice(0,110))+'</div></div>'
  ).join('');
}

/* ---------- worth your connects ---------- */
const SKILLS=['Shopify','WordPress','WooCommerce','Wix','Webflow','Squarespace','React','Vue',
 'Angular','Next.js','Node.js','Python','Django','Flask','PHP','Laravel','Figma','Photoshop',
 'Illustrator','Canva','SEO','Copywriting','Video editing','Excel','Zapier','Airtable',
 'Salesforce','HubSpot','Klaviyo','Mailchimp','iOS','Android','Flutter','API integration',
 'Data entry','Bookkeeping','Virtual assistant'];
function detectSkill(text){
  const lower=text.toLowerCase();
  for(const k of SKILLS){ if(lower.indexOf(k.toLowerCase())!==-1) return k; }
  return null;
}
function renderWorth(job){
  const wrap=document.getElementById('worthRow');
  if(!wrap) return;
  job=(job||'').trim();
  if(job.length<25){ wrap.classList.add('hide'); wrap.innerHTML=''; return; }
  const skill=detectSkill(job);
  wrap.classList.remove('hide');
  wrap.innerHTML='<b>Worth your connects</b> · '+(skill?'asks for '+esc(skill):'matches your skills');
}

/* ---------- autopilot ---------- */
const AUTO_KEY='ps_automode_v1';
let autoMode=false;
function renderAutoMode(){
  const p=document.getElementById('autoPill');
  if(!p) return;
  p.classList.toggle('on',autoMode);
  p.setAttribute('aria-pressed',String(autoMode));
  document.getElementById('autoText').textContent='Autopilot '+(autoMode?'on':'off');
  const mobileLabel=document.getElementById('mobileAutoText');
  if(mobileLabel) mobileLabel.textContent=autoMode?'Autopilot ready':'Autopilot off';
  p.title=autoMode?'Copy a job and return here. Tap Paste job if your browser asks.':'Turn on automatic job pasting and proposal writing.';
}
async function toggleAutoMode(){
  autoMode=!autoMode;
  clearTimeout(autoTimer);
  clearTimeout(focusWait);
  try{localStorage.setItem(AUTO_KEY,autoMode?'1':'0');}catch(e){}
  renderAutoMode();
  toast(autoMode?'Autopilot on':'Autopilot off');
  if(autoMode) await tryAutoFillFromClipboard(0,true);
}
async function initAutoMode(){
  let saved=false;
  try{ saved=localStorage.getItem(AUTO_KEY)==='1'; }catch(e){}
  let granted=false;
  try{
    if(navigator.permissions){
      const st=await navigator.permissions.query({name:'clipboard-read'});
      granted=(st.state==='granted');
    }
  }catch(e){}
  autoMode=granted||saved;
  renderAutoMode();
  if(granted) tryAutoFillFromClipboard();
}

/* ---------- recent history ---------- */
const HIST_KEY='ps_recent_v1';
function loadHist(){
  try{ const a=JSON.parse(localStorage.getItem(HIST_KEY)||'[]'); return Array.isArray(a)?a:[]; }
  catch(e){ return []; }
}
function pushHist(job,text){
  const h=loadHist();
  h.unshift({t:text, j:job.replace(/\s+/g,' ').trim().slice(0,58)});
  try{ localStorage.setItem(HIST_KEY,JSON.stringify(h.slice(0,6))); }catch(e){}
  renderRecentPanel();
}
function restoreHist(i){
  const it=loadHist()[i];
  if(!it) return;
  document.getElementById('outEmpty').classList.add('hide');
  document.getElementById('outLoading').classList.add('hide');
  document.getElementById('outReady').classList.remove('hide');
  document.getElementById('output').value=it.t;
  showWords(); renderQuality(it.t); autoCopy(it.t);
  closeJobCard();
}

/* ---------- floating box: sits over Upwork. idle -> drafting -> ready. alt-tab back auto-detects the clipboard ---------- */
let MINI=false;
const MINI_LOAD_LINES=[
  'Reading the way a client would skim it…',
  'Pulling out what they actually care about…',
  'Finding your closest piece of work…',
  'Cutting anything that sounds like a template…',
];
const MINI_CSS=`
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  *{box-sizing:border-box;}
  html,body{margin:0;height:100%;}
  body{
    font-family:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    background:#E6ECE0;
    background-image:radial-gradient(60% 55% at 0% 0%, rgba(196,232,120,.35) 0%, rgba(196,232,120,0) 70%),
                     radial-gradient(50% 40% at 100% 100%, rgba(232,203,158,.20) 0%, rgba(232,203,158,0) 70%);
    color:#1E3227;font-size:14px;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
  }
  .m-wrap{display:flex;flex-direction:column;height:100vh;padding:16px;gap:14px;}

  /* ---- header: pulse dot + status ---- */
  .m-head{display:flex;align-items:center;gap:9px;font-size:12.5px;line-height:1;}
  .m-dot{width:9px;height:9px;border-radius:50%;background:#17915A;flex-shrink:0;
    animation:mp-pulse 2.4s ease-in-out infinite;
    box-shadow:0 0 0 0 rgba(23,145,90,.35);}
  @keyframes mp-pulse{
    0%,100%{opacity:1;transform:scale(1);box-shadow:0 0 0 0 rgba(23,145,90,.35);}
    50%{opacity:.85;transform:scale(1.06);box-shadow:0 0 0 5px rgba(23,145,90,0);}
  }
  .m-label{font-weight:700;color:#0E6F44;letter-spacing:-.005em;}

  /* momentum meter: drains over time, snaps back full the instant a proposal is written */
  .m-meter-track{height:6px;background:#EEF3E7;border-radius:99px;overflow:hidden;}
  .m-meter-fill{height:100%;border-radius:99px;background:#17915A;
    transition:width .5s ease,background .3s ease;}
  .m-meter-cap{font-size:11.5px;line-height:1.5;margin:7px 0 0;}

  /* ---- shared box: job goes in, proposal replaces it in place - one
     box, one view, nothing stacks below it. ---- */
  .m-box{
    flex:1;width:100%;resize:none;border:1px solid #D3DDCD;border-radius:12px;
    padding:14px 15px;background:#FAFCF4;outline:none;
    font-family:"Inter",sans-serif;
    font-size:13.5px;line-height:21px;color:#1B2E22;letter-spacing:.005em;
    transition:border-color .14s,box-shadow .14s;min-height:0;
  }
  .m-box::placeholder{color:#9AA79D;}
  .m-box:focus{border-color:#17915A;box-shadow:0 0 0 3px rgba(23,145,90,.12);}

  /* ---- skeleton, same shape as the box, so drafting feels like the
     box itself is thinking rather than a different element appearing ---- */
  .m-skel{flex:1;border-radius:12px;background:#FAFCF4;border:1px solid #D3DDCD;padding:16px;min-height:0;}
  .m-skl{height:11px;border-radius:6px;margin:0 auto 9px;
    background:linear-gradient(90deg,#E8EEE2 25%,#F2F6EC 50%,#E8EEE2 75%);
    background-size:200% 100%;animation:mp-sheen 1.2s infinite;}
  @keyframes mp-sheen{0%{background-position:200% 0}100%{background-position:-200% 0}}
  .m-loadline{font-size:12.5px;color:#77857B;line-height:1.5;margin:14px 0 0;font-style:italic;text-align:center;}

  /* ---- primary action + rotating tip ---- */
  .m-primary{
    background:linear-gradient(180deg,#1FAE6E 0%,#0E6F44 100%);
    color:#fff;border:none;border-radius:12px;
    padding:12px 16px;font-size:13.5px;font-weight:700;letter-spacing:.005em;
    cursor:pointer;font-family:inherit;width:100%;
    display:flex;align-items:center;justify-content:center;gap:8px;
    box-shadow:0 1px 0 rgba(0,0,0,.03),0 8px 20px rgba(23,145,90,.26);
    transition:transform .14s ease,box-shadow .14s ease,opacity .14s;
  }
  .m-primary:hover:not(:disabled){transform:translateY(-1px);
    box-shadow:0 1px 0 rgba(0,0,0,.03),0 12px 26px rgba(23,145,90,.32);}
  .m-primary:active:not(:disabled){transform:translateY(0);}
  .m-primary:disabled{opacity:.6;cursor:default;box-shadow:none;}
  .m-spin{width:14px;height:14px;border-radius:50%;
    border:2px solid rgba(255,255,255,.45);border-top-color:#fff;
    animation:mp-spin .7s linear infinite;flex-shrink:0;}
  @keyframes mp-spin{to{transform:rotate(360deg);}}
  .m-tip{font-size:12.5px;font-weight:700;color:#0E6F44;line-height:1.45;margin:0;padding:10px 12px;border-radius:10px;background:#FFFFFF;border:1px solid #BEE0C5;box-shadow:0 4px 14px rgba(23,145,90,.10);
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
    transition:opacity .3s ease;}

  /* ---- ready row: word count chip + hint + secondary actions ---- */
  .m-ready-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12.5px;color:#77857B;}
  .m-wc{background:#EEF3E7;border:1px solid rgba(211,221,205,.7);
    padding:3px 10px;border-radius:999px;font-weight:600;color:#77857B;line-height:1;letter-spacing:.01em;}
  .m-wc.ok{background:#E3F1E5;border-color:#BEE0C5;color:#0E6F44;font-weight:700;}
  .m-wc.warn{background:#FBF1E0;border-color:#F0D5A8;color:#9A6A24;}
  .m-actions{display:flex;gap:8px;}
  .m-copy{background:#0E6F44;color:#fff;border:none;border-radius:12px;
    padding:10px 16px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;
    flex:1;
    box-shadow:0 1px 0 rgba(0,0,0,.03),0 6px 14px rgba(23,145,90,.22);
    transition:transform .14s ease,box-shadow .14s ease;}
  .m-copy:hover{transform:translateY(-1px);box-shadow:0 1px 0 rgba(0,0,0,.03),0 10px 20px rgba(23,145,90,.28);}
  .m-link{background:none;border:none;color:#0E6F44;font-size:12.5px;font-weight:700;
    cursor:pointer;font-family:inherit;padding:6px 12px;border-radius:8px;}
  .m-link:hover{background:rgba(14,111,68,.06);}

  /* ---- error/success flash on status label ---- */
  .m-label.warn{color:#9A6A24;} .m-dot.warn{background:#9A6A24;box-shadow:0 0 0 0 rgba(154,106,36,.35);}
  .m-label.busy{color:#0E6F44;}
  .m-label.ok{color:#0E6F44;}

  .m-hide{display:none !important;}

  @media (prefers-reduced-motion: reduce){
    .m-dot{animation:none;box-shadow:none;}
    .m-primary,.m-copy,.m-meter-fill,.m-tip{transition:none;}
    .m-primary:hover:not(:disabled),.m-copy:hover{transform:none;}
    .m-skl{animation:none;background:#EEF3E7;}
    .m-spin{animation:none;border-top-color:rgba(255,255,255,.85);}
  }
`;

function miniMarkup(){
  return '<div class="m-wrap">'+
    '<div class="m-head">'+
      '<span class="m-dot" id="mDot"></span>'+
      '<span class="m-label" id="mLabel">Listening for a job</span>'+
    '</div>'+

    '<div>'+
      '<div class="m-meter-track"><div class="m-meter-fill" id="mMeterFill"></div></div>'+
      '<p class="m-meter-cap" id="mMeterCap"></p>'+
    '</div>'+

    '<textarea class="m-box" id="mBox" placeholder="Copy a job on Upwork. Click Write once. We write and copy your proposal." spellcheck="false"></textarea>'+
    '<div class="m-skel m-hide" id="mSkel">'+
      '<div class="m-skl" style="width:80%"></div>'+
      '<div class="m-skl" style="width:94%"></div>'+
      '<div class="m-skl" style="width:62%"></div>'+
      '<p class="m-loadline" id="mLoadLine"></p>'+
    '</div>'+

    '<div class="m-ready-row m-hide" id="mReadyRow">'+
      '<span class="m-wc" id="mWc"></span>'+
      '<span>Copied — switch to Upwork and paste</span>'+
    '</div>'+

    '<button class="m-primary" id="mGen">Write my proposal</button>'+
    '<div class="m-actions m-hide" id="mActions">'+
      '<button class="m-copy" id="mCopy">Copy again</button>'+
      '<button class="m-link" id="mRewrite">Rewrite</button>'+
    '</div>'+

    '<p class="m-tip" id="mTip"></p>'+
  '</div>';
}

function wireMini(doc,win){
  const $=id=>doc.getElementById(id);
  const dot=$('mDot'), label=$('mLabel');
  const meterFill=$('mMeterFill'), meterCap=$('mMeterCap');
  const box=$('mBox'), skel=$('mSkel'), gen=$('mGen');
  const readyRow=$('mReadyRow'), wc=$('mWc');
  const actions=$('mActions'), cp=$('mCopy'), rewrite=$('mRewrite'), tip=$('mTip');
  /* the popup has its own navigator; documentPictureInPicture shares this one */
  const nav=(win||window).navigator;

  let lastJob='', lastClip='', busy=false, loadHintTimer, meterTimer, tipTimer, autoTimer;

  function setStatus(text,kind){
    label.textContent=text;
    label.className='m-label'+(kind?' '+kind:'');
    dot.className='m-dot'+(kind==='warn'?' warn':'');
  }

  /* ---- momentum meter: honest signal built from real bid history, not a
     decorative bar - see momentumPercent() above. ---- */
  function updateMeter(){
    if(!meterFill||!meterCap) return;
    const pct=momentumPercent();
    meterFill.style.width=pct+'%';
    let color,text;
    if(pct>=70){ color='#17915A'; text='Fresh — your bidding energy is high.'; }
    else if(pct>=30){ color='#D9A73E'; text='Momentum is dropping — a bid brings it back up.'; }
    else{ color='#B4402F'; text='Your momentum is fading — one bid brings it right back.'; }
    meterFill.style.background=color;
    meterCap.textContent=text;
    meterCap.style.color=color;
  }
  function startMeterTimer(){
    clearInterval(meterTimer);
    meterTimer=setInterval(updateMeter,5000);
  }

  /* reuses the same BIAS_TIPS as the main page so the box never feels empty between jobs */
  function startTips(){
    clearInterval(tipTimer);
    let i=Math.floor(Math.random()*BIAS_TIPS.length);
    tip.textContent=BIAS_TIPS[i][1];
    tipTimer=setInterval(()=>{
      i=(i+1)%BIAS_TIPS.length;
      tip.style.opacity='0';
      setTimeout(()=>{ tip.textContent=BIAS_TIPS[i][1]; tip.style.opacity='1'; },300);
    },14000);
  }
  function stopTips(){ clearInterval(tipTimer); }

  function showState(name){
    /* States: idle | drafting | ready */
    if(name==='idle'){
      box.classList.remove('m-hide','ready'); box.readOnly=false;
      skel.classList.add('m-hide'); readyRow.classList.add('m-hide'); actions.classList.add('m-hide');
      gen.classList.remove('m-hide'); gen.disabled=false; gen.textContent='Write my proposal';
      setStatus('Listening for a job');
      updateMeter(); startTips();
    }else if(name==='drafting'){
      box.classList.add('m-hide'); skel.classList.remove('m-hide');
      readyRow.classList.add('m-hide'); actions.classList.add('m-hide');
      gen.disabled=true; gen.innerHTML='<span class="m-spin"></span>Writing…';
      const line=$('mLoadLine'); if(line) line.textContent=MINI_LOAD_LINES[0];
      setStatus('Drafting…','busy');
      startLoadLines(doc); stopTips();
    }else if(name==='ready'){
      box.classList.remove('m-hide'); box.classList.add('ready'); box.readOnly=false;
      skel.classList.add('m-hide'); readyRow.classList.remove('m-hide'); actions.classList.remove('m-hide');
      gen.classList.add('m-hide');
      setStatus('Proposal copied to clipboard ✓','ok');
      stopLoadLines(); updateMeter(); startTips();
    }
  }
  function updateWc(text){
    const n=wordCount(text);
    const inSweet=n>=110&&n<=150;
    wc.className='m-wc'+(inSweet?' ok':(n>160?' warn':''));
    wc.textContent=(inSweet?'✓ ':'')+n+' words';
  }

  /* ---- rotating labor-illusion line during drafting ---- */
  function startLoadLines(d){
    let i=1;
    clearInterval(loadHintTimer);
    loadHintTimer=setInterval(()=>{
      const el=d.getElementById('mLoadLine'); if(!el){ return; }
      el.textContent=MINI_LOAD_LINES[i%MINI_LOAD_LINES.length]; i++;
    },1300);
  }
  function stopLoadLines(){ clearInterval(loadHintTimer); }

  async function draft(job){
    if(busy) return;
    job=(job||'').trim();
    if(job.length<12){ setStatus('Paste the job first','warn'); return; }
    busy=true; lastJob=job;
    showState('drafting');
    try{
      const {ok,status,data}=await generateRequest(job);
      if(!ok){
        setStatus((data.error||('Server error '+status)).slice(0,60),'warn');
        showState('idle'); box.value=job;
        return;
      }
      const text=(data.text||'').trim();
      showState('ready');
      box.value=text; updateWc(text);
      bumpStats(); setMomentumNow(); pushHist(job,text);
      try{ await nav.clipboard.writeText(text); }
      catch(e){ setStatus('Draft ready — tap Copy again','ok'); }
    }catch(e){
      setStatus('No connection','warn'); showState('idle'); box.value=job;
    }finally{ busy=false; }
  }

  /* ---- Primary button: writes from whatever is already in the box, or
     falls back to reading the clipboard if the box is empty. ---- */
  gen.addEventListener('click',async()=>{
    const typed=box.value.trim();
    if(typed.length>=12){ await draft(typed); return; }
    let job='';
    try{ job=await nav.clipboard.readText(); }
    catch(e){ setStatus('Paste the job in the box, then tap Write once.','warn'); box.focus(); return; }
    await draft(job);
  });

  /* ---- Paste or type into the box: auto-write, same as the main page. ---- */
  box.addEventListener('paste',e=>{
    clearTimeout(autoTimer);
    const pasted=e.clipboardData&&e.clipboardData.getData('text'); if(pasted&&pasted.trim().length>=25){e.preventDefault();box.value=pasted;draft(pasted);return;} setTimeout(()=>{ if(box.value.trim().length>=25) draft(box.value); },80);
  });
  box.addEventListener('input',()=>{
    if(box.classList.contains('ready')) return;
    clearTimeout(autoTimer);
    if(box.value.trim().length<25) return;
    autoTimer=setTimeout(()=>{ if(!busy) draft(box.value); },1400);
  });

  /* ---- Copy again: reload clipboard with the current draft ---- */
  cp.addEventListener('click',async()=>{
    if(!box.value) return;
    try{ await nav.clipboard.writeText(box.value); setStatus('Proposal copied to clipboard ✓','ok'); }
    catch(e){ box.select(); setStatus('Select and copy manually','warn'); }
  });

  /* ---- Rewrite: same job, different phrasing (uses history) ---- */
  rewrite.addEventListener('click',()=>{ if(lastJob) draft(lastJob); });

  /* ---- Live word count while editing the ready proposal ---- */
  box.addEventListener('input',()=>{ if(box.classList.contains('ready')) updateWc(box.value); });

  /* on focus, peek the clipboard - new job-shaped text runs generate with no click needed */
  async function pollClipboard(){
    if(busy) return;
    try{
      const text=await nav.clipboard.readText();
      if(!text) return;
      const trimmed=text.trim();
      /* Filter noise: skip anything too short, a URL, or the same text
         we already have on our clipboard (would restart the same job). */
      if(trimmed.length<60) return;
      if(trimmed===lastClip || loadHist().some(item=>psNormalizeClipboard(item.t)===psNormalizeClipboard(trimmed))) return;
      if(/^https?:\/\/\S+$/.test(trimmed)) return;
      lastClip=trimmed;
      draft(trimmed);
    }catch(e){ /* no permission - keep quiet */ }
  }
  (win||window).addEventListener('focus',pollClipboard);
  doc.addEventListener('visibilitychange',()=>{ if(!doc.hidden) pollClipboard(); });

  /* stop every timer on close, or a closed popup leaves its intervals ticking forever */
  (win||window).addEventListener('pagehide',()=>{
    clearInterval(meterTimer); clearInterval(tipTimer);
    clearInterval(loadHintTimer); clearTimeout(autoTimer);
  });

  /* Initial paint */
  showState('idle');
  startMeterTimer();
  /* Give focus a beat, then try the clipboard once - if the user opened the
     floating box while a job was already copied, draft it immediately. */
  pollClipboard(); setTimeout(pollClipboard,220);
}
async function openFloating(){
  if(window.documentPictureInPicture){
    try{
      const w=await documentPictureInPicture.requestWindow({width:400,height:540});
      const s=w.document.createElement('style'); s.textContent=MINI_CSS; w.document.head.appendChild(s);
      w.document.body.innerHTML=miniMarkup();
      wireMini(w.document,w);
      toast('Floating box open - leave this tab open behind Upwork');
      return;
    }catch(e){}
  }
  /* Bottom-left by default - out of the way of the page, but still an easy
     glance down without covering the job feed itself. */
  const mw=400, mh=560;
  const left=16;
  const top=Math.max(16,(window.screen.availHeight||window.innerHeight)-mh-70);
  const w=window.open(location.pathname+'?mini=1','ps_mini',
    'width='+mw+',height='+mh+',left='+left+',top='+top+',menubar=no,toolbar=no,location=no,status=no');
  if(!w) toast('Allow pop-ups for this site to use the floating box');
  else toast('Floating box open - drag it beside Upwork');
}

/* ---------- proposal quality checks ---------- */
/* Phrases that scream "AI wrote this" to a skimming client. */
const AI_TELLS=['passionate','dedicated','leverage','synergy','seasoned','i hope this message finds you well'];
/* Weak, form-letter closers that lose replies. A specific question or a real
   sign-off ("— <name>") wins over "Sincerely,". */
const WEAK_CLOSERS=[
  'sincerely','best regards','kind regards','looking forward to hearing',
  'thanks in advance','warm regards','yours truly'
];
function computeQuality(text){
  const n=wordCount(text), lower=text.toLowerCase();
  const trimmed=text.trim();
  const hasLink=/https?:\/\//i.test(text) || portfolio.some(it=>
    (it.url&&text.indexOf(it.url)!==-1)||(it.fileName&&text.indexOf(it.fileName)!==-1));
  const tail=trimmed.slice(-160).toLowerCase();
  /* the proof line's "https://link\n[description]" bracket is filled-in, not a placeholder - strip it first */
  const withoutProofTags=text.replace(/https?:\/\/\S+[ \t]*\n[ \t]*\[[^\]]+\]/g,'');
  return {checks:[
    {label:'add a project link', pass:hasLink},
    {label:'replace the [brackets]', pass:!/\[[^\]]+\]/.test(withoutProofTags)},
    {label:'trim under 165 words', pass:n<=165},
    {label:'cut AI-sounding phrases', pass:!AI_TELLS.some(w=>lower.indexOf(w)!==-1)},
    {label:'drop the form-letter closer', pass:!WEAK_CLOSERS.some(w=>tail.indexOf(w)!==-1)}
  ]};
}
function renderQuality(text){
  const wrap=document.getElementById('fixRow');
  if(!wrap) return;
  const checks=computeQuality(text).checks;
  const failing=checks.filter(c=>!c.pass);
  wrap.classList.remove('hide');
  if(!failing.length){
    /* Peak-end affirmation: rewarding "all clear" beats silently hiding.
       Brains that just fixed something want the acknowledgement. */
    wrap.innerHTML='<span class="allclear"><span class="g yes">✓</span>Looks clean. Send it.</span>';
    return;
  }
  const needsLink=failing.some(c=>/project link/i.test(c.label));
  /* Glyphs beat prose: eye scans ✓/× in ~150ms vs. 400ms for words. Zeigarnik
     effect (open loops nag until closed) does the persuading, not the copy. */
  const glyphs=failing.map(c=>
    '<span class="item"><span class="g no">✕</span>'+esc(c.label)+'</span>'
  ).join('');
  wrap.innerHTML=glyphs+(needsLink?'<button class="add" onclick="openPf()">Add one now</button>':'');
}

function portfolioPayload(){
  return portfolio.map(it=>({kind:it.kind,title:it.title,url:it.url||'',fileName:it.fileName||''}));
}

/* your last few sent proposals, so the writer learns your voice and stops
   repeating its own opening lines across jobs */
function historyPayload(){
  return loadHist().slice(0,3).map(it=>it.t).filter(Boolean);
}

/* server budget is ~10s (route.ts) - 20s headroom so a hung request always resolves */
async function generateRequest(job){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  try{
    const res=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({jobPost:job,portfolio:portfolioPayload(),history:historyPayload()}),signal:controller.signal});
    let data={}; try{ data=await res.json(); }catch(e){}
    return {ok:res.ok,status:res.status,data};
  }catch(e){
    if(e && e.name==='AbortError') return {ok:false,status:0,data:{error:'That took too long. Check your connection and try again.'}};
    return {ok:false,status:0,data:{}};
  }finally{
    clearTimeout(timer);
  }
}

let busy=false;
async function generate(){
  if(busy||MINI) return;
  const job=document.getElementById('jobPost').value.trim();
  if(!job){
    setStatus('Paste the job post first.','err');
    document.getElementById('jobPost').focus();
    return;
  }
  if(job.length>20000){
    setStatus('That post is too long ('+job.length.toLocaleString()+' characters). Trim it and try again.','err');
    document.getElementById('jobPost').focus();
    return;
  }
  busy=true;
  clearTimeout(autoTimer);
  openJobCard();
  showTab('work');
  const copyStatus=document.getElementById('copyStatus');
  if(copyStatus) copyStatus.textContent='';
  const btn=document.getElementById('genBtn');
  btn.disabled=true;
  document.getElementById('genLabel').textContent='Writing...';
  btn.insertBefore(Object.assign(document.createElement('span'),{className:'spinner'}),btn.firstChild);

  document.getElementById('outEmpty').classList.add('hide');
  document.getElementById('outReady').classList.add('hide');
  document.getElementById('outLoading').classList.remove('hide');
  document.getElementById('wordPill').classList.add('hide');
  document.getElementById('fixRow').classList.add('hide');
  setStatus('');
  startLoaderHints();
  startLoadPct();

  /* hold the loading state a minimum beat so a fast response doesn't flicker */
  const loadStart=Date.now();
  const MIN_LOAD_MS=550;

  try{
    const {ok,status,data}=await generateRequest(job);
    const elapsed=Date.now()-loadStart;
    if(elapsed<MIN_LOAD_MS) await new Promise(r=>setTimeout(r,MIN_LOAD_MS-elapsed));
    if(!ok){
      stopLoaderHints();
      stopLoadPct();
      document.getElementById('outLoading').classList.add('hide');
      document.getElementById('outEmpty').classList.remove('hide');
      setStatus(data.error||('Something went wrong ('+status+').'),'err');
      openJobCard(); /* the status line lives in #jobCard - reopen it so the error is visible */
      return;
    }
    const text=(data.text||'').trim();
    stopLoaderHints();
    await finishLoadPct();
    document.getElementById('outLoading').classList.add('hide');
    document.getElementById('outReady').classList.remove('hide');
    document.getElementById('output').value=text;
    showWords(); renderQuality(text); bumpStats(); setMomentumNow(); pushHist(job,text);
    document.getElementById('workView').classList.add('ps-result');
    document.querySelector('.page').classList.add('ps-result');
    psFitProposal();
    if(window.matchMedia('(max-width:1000px)').matches){
      document.getElementById('outReady').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'});
    }
    await autoCopy(text);
  }catch(err){
    stopLoaderHints();
    stopLoadPct();
    document.getElementById('outLoading').classList.add('hide');
    document.getElementById('outEmpty').classList.remove('hide');
    setStatus('Could not reach the server. Check your connection.','err');
    openJobCard();
  }finally{
    busy=false; btn.disabled=false;
    const sp=btn.querySelector('.spinner'); if(sp) sp.remove();
    /* only say "again" once there's actually something to rewrite */
    document.getElementById('genLabel').textContent=
      document.getElementById('output').value.trim() ? 'Write it again' : 'Write my proposal';
  }
}

async function copyOut(){
  const el=document.getElementById('output'),text=el.value;
  if(!text.trim()) return;
  let copied=false;
  try{await navigator.clipboard.writeText(text);copied=true;}catch(e){
    el.focus();el.select();
    try{copied=document.execCommand('copy')===true;}catch(e2){}
  }
  if(copied){
    lastClip=text.trim();
    psCopyStatus('Proposal copied to clipboard. Paste it on Upwork.',true);
    showCopyToast();
  }else{
    psCopyStatus('Not copied yet. Hold the proposal text and tap Copy.',false);
  }
}
async function autoCopy(text){
  if(!text.trim()) return;
  try{
    await navigator.clipboard.writeText(text);
    lastClip=text.trim();
    psCopyStatus('Proposal copied to clipboard. Paste it on Upwork.',true);
    showCopyToast();
  }catch(e){
    psCopyStatus('Proposal ready. Tap Copy proposal below.',false);
  }
}


function psNormalizeClipboard(text){return String(text||'').replace(/\s+/g,' ').trim();}
function psIsOwnProposal(text){
  const normalized=psNormalizeClipboard(text);
  const output=document.getElementById('output');
  return !!normalized && ((output&&normalized===psNormalizeClipboard(output.value)) ||
    loadHist().some(item=>normalized===psNormalizeClipboard(item.t)));
}
function psCopyStatus(message,copied){
  const el=document.getElementById('copyStatus');
  if(el){el.textContent=message;el.className='status '+(copied?'ok':'');}
  setStatus(message,copied?'ok':'');
}
function showCopyToast(){
  toast('✓ Proposal copied to clipboard');
}


/* ---------- wiring ---------- */
document.getElementById('output').addEventListener('input',showWords);
document.addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){ e.preventDefault(); generate(); }
  if(e.key==='Escape'&&!document.getElementById('pfOverlay').classList.contains('hide')) closePf();
});

const jobEl=document.getElementById('jobPost');
let autoTimer;
jobEl.addEventListener('paste',()=>{
  clearTimeout(autoTimer);
  setTimeout(()=>{ renderWorth(jobEl.value); if(autoMode&&jobEl.value.trim().length>=25&&!psIsOwnProposal(jobEl.value)) generate(); },80);
});
jobEl.addEventListener('input',()=>{
  clearTimeout(autoTimer);
  renderWorth(jobEl.value);
  syncJobCtx();
  if(!autoMode||jobEl.value.trim().length<25||psIsOwnProposal(jobEl.value)) return;
  autoTimer=setTimeout(()=>{ if(autoMode&&!busy) generate(); },1400);
});
jobEl.addEventListener('focus',()=>{ if(jobEl.value.trim()) jobEl.select(); });

document.addEventListener('paste',e=>{
  const t=e.target;
  if(t===jobEl) return;
  if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA')) return;
  const cd=e.clipboardData||window.clipboardData;
  const text=cd?cd.getData('text'):'';
  if(!text||text.trim().length<25) return;
  e.preventDefault();
  if(psIsOwnProposal(text)) return;
  jobEl.value=text; lastClip=text.trim(); renderWorth(text); openJobCard();
  if(autoMode) generate();
});

/* ---------- clipboard watch ---------- */
let lastClip='', focusWait;
var psReadingClipboard=false;
async function tryAutoFillFromClipboard(attempt,manual){
  if(MINI||(!autoMode&&!manual)||busy||document.hidden||psReadingClipboard) return;
  if(!document.hasFocus()&&!manual) return;
  psReadingClipboard=true;
  const enabledAtStart=autoMode;
  try{
    const text=await navigator.clipboard.readText();
    if(enabledAtStart&&!autoMode) return;
    const trimmed=psNormalizeClipboard(text);
    if(trimmed.length<25){
      if(manual) setStatus('Copy a full job post first, then tap Paste job.','err');
      return;
    }
    if(psIsOwnProposal(text)||trimmed===psNormalizeClipboard(lastClip)||trimmed===psNormalizeClipboard(jobEl.value)){
      if(manual) setStatus('Already here. Copy a new job to start another proposal.','ok');
      return;
    }
    lastClip=text.trim();
    jobEl.value=text;
    renderWorth(text);
    openJobCard();
    showTab('work');
    setStatus('Job pasted. Writing your proposal...','ok');
    await generate();
  }catch(e){
    setStatus('Tap Paste job. If asked, allow paste. You can also hold the job box and tap Paste.','');
  }finally{psReadingClipboard=false;}
}
/* only an explicit browser denial may switch autopilot off */
async function confirmStillAllowed(){
  try{
    if(!navigator.permissions) return;
    const st=await navigator.permissions.query({name:'clipboard-read'});
    if(st.state==='denied'){
      autoMode=false;
      try{ localStorage.setItem(AUTO_KEY,'0'); }catch(e){}
      renderAutoMode();
    }
  }catch(e){}
}
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) tryAutoFillFromClipboard(); });
window.addEventListener('focus',()=>tryAutoFillFromClipboard());

document.getElementById('fileInput').addEventListener('change',e=>{
  addFiles(Array.from(e.target.files)); e.target.value='';
});
const drop=document.getElementById('drop');
['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{ e.preventDefault(); drop.classList.add('over'); }));
['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{ e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop',e=>{ addFiles(Array.from(e.dataTransfer.files)); });

load(); refresh(); renderStats(); initAutoMode(); initTheme(); pickBias(); syncJobCtx();

if(new URLSearchParams(location.search).get('mini')==='1'){
  MINI=true;
  const s=document.createElement('style'); s.textContent=MINI_CSS; document.head.appendChild(s);
  document.body.innerHTML=miniMarkup();
  wireMini(document,window);
  document.title='Proposal Studio';
}


/* First visit: Autopilot is off. Keep the whole flow visible and simple. */
const AUTO_GUIDE_KEY='ps_autoguide_seen_v2';
function showAutopilotGuide(){
  let seen=false; try{ seen=localStorage.getItem(AUTO_GUIDE_KEY)==='1'; }catch(e){}
  if(seen||document.getElementById('autoGuide')) return;
  const guide=document.createElement('div');
  guide.id='autoGuide';
  guide.style.cssText='position:fixed;inset:0;z-index:90;display:grid;place-items:center;padding:20px;background:rgba(20,35,27,.4)';
  guide.innerHTML='<div style="position:relative;width:min(370px,100%);padding:22px;border-radius:16px;background:#fff;color:#1e3227;box-shadow:0 24px 70px rgba(0,0,0,.25)"><button aria-label="Close" style="position:absolute;right:10px;top:10px;border:0;border-radius:50%;width:28px;height:28px;font-size:19px;cursor:pointer">×</button><b style="font-size:18px;color:#0e6f44">Autopilot is on</b><p style="margin:12px 0 18px;font-size:14px;line-height:1.6">1. Copy a job on Upwork.<br>2. Come back here.<br>3. We paste it, write your proposal, and copy it for you.</p><button style="width:100%;height:42px;border:0;border-radius:11px;background:#17915a;color:#fff;font-weight:700;cursor:pointer">Got it</button></div>';
  const close=()=>{guide.remove();try{localStorage.setItem(AUTO_GUIDE_KEY,'1')}catch(e){}};
  guide.querySelectorAll('button').forEach(button=>button.onclick=close);
  document.body.appendChild(guide);
}
async function initAutoMode(){
  let saved=false; try{saved=localStorage.getItem(AUTO_KEY)==='1'}catch(e){}
  autoMode=saved; renderAutoMode(); if(saved) tryAutoFillFromClipboard();
}
async function toggleAutoMode(){
  autoMode=!autoMode;
  clearTimeout(autoTimer);
  clearTimeout(focusWait);
  try{localStorage.setItem(AUTO_KEY,autoMode?'1':'0');}catch(e){}
  renderAutoMode();
  toast(autoMode?'Autopilot on':'Autopilot off');
  if(autoMode) await tryAutoFillFromClipboard(0,true);
}
function showTab(name){
  const recentOpen=!document.getElementById('recentView').classList.contains('hide');
  if(name==='recent'&&recentOpen) name='work';
  const w=document.getElementById('tabWork'),r=document.getElementById('tabRecent');
  if(w) w.classList.toggle('on',name==='work'); if(r) r.classList.toggle('on',name==='recent');
  document.getElementById('workView').classList.toggle('hide',name!=='work');
  document.getElementById('recentView').classList.toggle('hide',name!=='recent');
  if(name==='recent'){renderStats();renderRecentPanel();} syncJobCtx();
}
function setButtonLabel(id,label){const button=document.getElementById(id);if(!button)return;const node=Array.from(button.childNodes).find(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim());if(node)node.textContent=' '+label;}
setButtonLabel('tabWork','Proposal screen');
const recentBack=document.querySelector('#recentView .back');
if(recentBack){const node=Array.from(recentBack.childNodes).find(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim());if(node)node.textContent=' Back to proposal screen';}
/* A pasted job in the main box now asks for the clipboard again immediately. */
if(typeof jobEl!=='undefined') jobEl.addEventListener('focus',()=>tryAutoFillFromClipboard());


/* Interface-only improvements: proposal writing instructions remain unchanged. */
const PS_ONBOARDING_KEY='ps_onboarding_v1';
const PS_LIGHT_DEFAULT_KEY='ps_light_default_v1';
(function psSetLightDefault(){
  try{
    if(localStorage.getItem(PS_LIGHT_DEFAULT_KEY)!=='1'){
      localStorage.setItem(DARK_KEY,'0');
      localStorage.setItem(PS_LIGHT_DEFAULT_KEY,'1');
    }
    document.documentElement.classList.toggle('dark',localStorage.getItem(DARK_KEY)==='1');
  }catch(e){}
  renderThemeBtn();
})();
async function initAutoMode(){
  let saved=false;
  try{ saved=localStorage.getItem(AUTO_KEY)==='1'; }catch(e){}
  autoMode=saved;
  renderAutoMode();
  if(saved) tryAutoFillFromClipboard();
}
function psFitProposal(){
  const field=document.getElementById('output');
  if(!field || !field.value.trim()) return;
  field.style.height='auto';
  field.style.height=(field.scrollHeight+2)+'px';
  field.style.overflowY='hidden';
}
function psWelcomeGuide(){
  if(typeof MINI!=='undefined' && MINI) return;
  try{ if(localStorage.getItem(PS_ONBOARDING_KEY)==='1') return; }catch(e){}
  const steps=[
    {tag:'Welcome',title:'COPY JOB POST',text:'Turn on Autopilot. Copy a job on Upwork, then come back here. We paste the job, write your proposal, and copy it. You paste it on Upwork.',button:'Next'},
    {tag:'Autopilot',title:'Let us do the copying.',text:'Allow clipboard access when asked. On phones, you may need to tap Paste or Copy. Read your proposal before sending it.',button:'Next'},
    {tag:'Float on top',title:'Keep the small box beside Upwork.',text:'Click Float on top. Copy a job, then click Write in the small box. Check your proposal and paste it on Upwork.',button:'Start writing'}
  ];
  let step=0;
  const shade=document.createElement('div');
  shade.setAttribute('role','dialog');
  shade.setAttribute('aria-modal','true');
  shade.style.cssText='position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:20px;background:rgba(18,32,25,.35);backdrop-filter:blur(5px)';
  function finish(){ try{localStorage.setItem(PS_ONBOARDING_KEY,'1');}catch(e){} shade.remove(); }
  function draw(){
    const item=steps[step];
    shade.innerHTML='<section class="ps-welcome-panel" style="width:min(430px,100%);background:#fff;color:#183228;border-radius:22px;padding:28px;box-shadow:0 24px 70px rgba(11,35,22,.25);font-family:inherit"><div style="display:flex;align-items:center;justify-content:space-between;gap:16px"><span style="font-size:12px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:#087746">'+item.tag+'</span><button type="button" data-skip style="border:0;background:none;color:#5c6d63;font:inherit;cursor:pointer">Skip</button></div><h2 style="margin:18px 0 10px;font-size:27px;line-height:1.12;letter-spacing:-.04em">'+item.title+'</h2><p style="margin:0;color:#506158;font-size:16px;line-height:1.55">'+item.text+'</p><div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:26px"><span style="color:#76877c;font-size:13px">'+(step+1)+' of '+steps.length+'</span><button type="button" data-next style="border:0;border-radius:12px;background:#11995b;color:white;padding:12px 19px;font:inherit;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 7px 16px rgba(17,153,91,.22)">'+item.button+'</button></div></section>';
    shade.querySelector('[data-skip]').onclick=finish;
    shade.querySelector('[data-next]').onclick=()=>{ if(step===steps.length-1) finish(); else {step++;draw();} };
  }
  draw();
  document.body.appendChild(shade);
}
(function psProposalDisplaySetup(){
  const ready=document.getElementById('outReady');
  const field=document.getElementById('output');
  function syncMobileResult(){
    const hasResult=!!ready&&!ready.classList.contains('hide');
    const grid=document.getElementById('workView');
    const page=document.querySelector('.page');
    if(grid) grid.classList.toggle('ps-result',hasResult);
    if(page) page.classList.toggle('ps-result',hasResult);
  }
  if(ready) new MutationObserver(syncMobileResult).observe(ready,{attributes:true,attributeFilter:['class']});
  syncMobileResult();
  if(field) field.addEventListener('input',psFitProposal);
  if(ready && window.MutationObserver) new MutationObserver(()=>setTimeout(psFitProposal,0)).observe(ready,{attributes:true,attributeFilter:['class']});
  window.addEventListener('resize',psFitProposal);
  setTimeout(psFitProposal,0);
  setTimeout(psWelcomeGuide,450);
})();

