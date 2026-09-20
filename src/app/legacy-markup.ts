export const LEGACY_MARKUP = `
<div class="topbar">
  <div class="tb-inner">
    <div class="brand">
      <span class="logo">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M21.5 2.5 2.8 10.2c-.7.3-.7 1.3.03 1.5l6.1 1.9 1.9 6.1c.22.73 1.22.73 1.5.03L21.5 2.5Z" fill="#fff"/>
          <path d="M21.5 2.5 8.93 13.6l1.9 6.1c.22.73 1.22.73 1.5.03L21.5 2.5Z" fill="#D8F36D"/>
        </svg>
      </span>
      <span class="bname"><b>Proposal</b> <span>Studio</span></span>
    </div>

    <div class="nav">
      <button class="nb" onclick="openFloating()" title="A small window that stays on top of Upwork">
        <svg class="nbi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="14" rx="2"/><rect x="12.5" y="10.5" width="7.5" height="5.5" rx="1" fill="currentColor" stroke="none"/></svg>
        Float on top
      </button>
      <button class="nb auto" id="autoPill" onclick="toggleAutoMode()">
        <span class="sw"><i></i></span><span id="autoText">Autopilot</span>
      </button>
      <button class="nb on" id="tabWork" onclick="showTab('work')">
        <svg class="nbi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
        Your work
      </button>
      <button class="nb" id="tabRecent" onclick="showTab('recent')">
        <svg class="nbi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>
        Recent
      </button>
      <button class="nb ic" id="themeBtn" onclick="toggleTheme()" aria-label="Dark mode"></button>
    </div>
  </div>
</div>

<div class="page">

  <section class="mobile-hero" aria-label="How Proposal Studio works">
    <div class="mobile-ready"><span aria-hidden="true"></span><b id="mobileAutoText">Autopilot ready</b></div>
    <h1>Copy the job.<br><strong>We do the rest.</strong></h1>
    <p>Autopilot pastes it, writes your proposal, and copies it. You only paste it back on Upwork.</p>
  </section>

  <div class="bias">
    <span class="bias-bolt">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg>
    </span>
    <span class="bias-chip" id="biasChip">Illusory superiority</span>
    <span class="bias-sep"></span>
    <span class="bias-text" id="biasText">Everyone thinks their proposal is different. Test it: does your first line only work for this client?</span>
    <button class="bias-x" onclick="closeBias()" aria-label="Dismiss tip">&#10005;</button>
    <span class="bias-bar" id="biasBar"></span>
  </div>

  <div class="jobctx hide" id="jobCtx" onclick="openJobCard()">
    <svg class="jobctx-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
    <span id="jobCtxText"></span>
  </div>

  <div class="grid" id="workView">

    <div class="card" id="jobCard">
      <div class="chead">
        <h2>Job post</h2>
        <div class="chead-actions">
          <button class="x jobcard-x" id="jobCardClose" onclick="closeJobCard()" aria-label="Close job post">&#10005;</button>
          <button class="link" onclick="clearJob()">Clear</button>
        </div>
      </div>
      <button class="link paste-job" type="button" onclick="tryAutoFillFromClipboard(0,true)">Paste job</button>
<textarea class="box" id="jobPost" autofocus spellcheck="false" placeholder="COPY THE UPWORK JOB - IT AUTO-PASTES HERE"></textarea>
      <div class="worth hide" id="worthRow"></div>
      <div class="genrow">
        <button class="btn btn-ghost" id="floatBtnJob" onclick="openFloating()" title="A small window that stays on top of Upwork">
          <svg class="btn-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="14" rx="2"/><rect x="12.5" y="10.5" width="7.5" height="5.5" rx="1" fill="currentColor" stroke="none"/></svg>
          Add proposal
        </button>
        <button class="btn" id="genBtn" onclick="generate()">
          <svg class="btn-ic btn-ic-left" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 3 11 7l4 1.5L11 10l-1.5 4L8 10l-4-1.5L8 7z"/><path d="M18 13l.9 2.1L21 16l-2.1.9L18 19l-.9-2.1L15 16l2.1-.9z"/></svg>
          <span id="genLabel">Paste & generate proposal</span>
          <svg class="btn-ic btn-ic-right" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </button>
      </div>
      <div class="hintwrap">
        <div class="status" id="status" role="status" aria-live="polite"></div>
        <div class="hint">Cmd or Ctrl + Enter writes it</div>
      </div>
    </div>

    <div class="card">
      <div class="chead">
        <h2>Your proposal</h2>
        <span class="wc hide" id="wordPill"></span>
      </div>

      <div class="empty" id="outEmpty">
        <div class="ring">
          <svg class="doc" viewBox="0 0 64 72" fill="none">
            <path d="M8 4a4 4 0 0 1 4-4h30l18 18v46a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V4Z" fill="#ffffff" stroke="#17915A" stroke-width="2.4"/>
            <path d="M42 0v14a4 4 0 0 0 4 4h14" fill="#E3F1E5" stroke="#17915A" stroke-width="2.4" stroke-linejoin="round"/>
            <path d="M18 32h20M18 42h28M18 52h22" stroke="#17915A" stroke-width="2.6" stroke-linecap="round"/>
          </svg>
          <svg class="spark spark-a" viewBox="0 0 24 24" fill="#17915A"><path d="M12 1.5 14 9.5 22 12l-8 2.5L12 22.5 10 14.5 2 12l8-2.5z"/></svg>
          <svg class="spark spark-b" viewBox="0 0 24 24" fill="#17915A"><path d="M12 1.5 14 9.5 22 12l-8 2.5L12 22.5 10 14.5 2 12l8-2.5z"/></svg>
          <svg class="spark spark-c" viewBox="0 0 24 24" fill="#17915A"><path d="M12 1.5 14 9.5 22 12l-8 2.5L12 22.5 10 14.5 2 12l8-2.5z"/></svg>
          <svg class="spark spark-d" viewBox="0 0 24 24" fill="#17915A"><path d="M12 1.5 14 9.5 22 12l-8 2.5L12 22.5 10 14.5 2 12l8-2.5z"/></svg>
        </div>
        <div class="emsg">Paste a job post and your proposal<br>lands here in about two seconds.</div>
      </div>

      <div class="skel hide" id="outLoading">
        <div class="loadpct">
          <span>Writing your proposal</span>
          <span id="loadPctNum" style="font-size:12px;opacity:.8;font-weight:600">Reading the job post…</span>
        </div>
        <div class="loadbar"><div class="loadbar-fill" id="loadBarFill"></div></div>
        <div class="skl" style="width:22%"></div>
        <div class="skl" style="width:94%"></div>
        <div class="skl" style="width:78%"></div>
        <div class="skl" style="width:40%;margin-top:20px"></div>
        <div class="skl" style="width:88%"></div>
        <div class="skl" style="width:62%;margin-top:20px"></div>
        <div class="skl" style="width:46%"></div>
        <div class="loadhint" id="loadHint"></div>
      </div>

      <div id="outReady" class="hide">
        <textarea class="box" id="output" spellcheck="true"></textarea>
        <div class="fix hide" id="fixRow"></div>
        <div class="actions">
          <button class="btn" id="copyBtn" onclick="copyOut()">Copy proposal</button>
          <button class="link" onclick="generate()">Rewrite</button>
        </div>
        <div class="status" id="copyStatus" role="status" aria-live="polite"></div>
      </div>
    </div>

  </div>

  <div id="recentView" class="hide">
    <div class="card">
      <button class="back" onclick="showTab('work')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        Back to your work
      </button>
      <div class="chead"><h2>Recent proposals</h2></div>
      <div class="stats" id="statChips"></div>
      <div class="rlist" id="recentList"></div>
    </div>
  </div>

</div>

<!-- PORTFOLIO MODAL -->
<div class="overlay hide" id="pfOverlay" onclick="if(event.target===this)closePf()">
  <div class="modal" role="dialog" aria-modal="true" aria-label="Your portfolio">
    <div class="mhead">
      <div>
        <h3>Your portfolio</h3>
        <p>Add it once. Every proposal picks the piece that fits the job.</p>
      </div>
      <button class="x" onclick="closePf()" aria-label="Close">&#10005;</button>
    </div>
    <div class="mbody">
      <div class="sect">Add a link</div>
      <div class="frow">
        <div style="flex:1.3">
          <label class="lbl" for="lnkUrl">URL</label>
          <input class="inp" id="lnkUrl" type="url" placeholder="https://behance.net/yourwork" onkeydown="if(event.key==='Enter')addLink()">
        </div>
        <div style="flex:1">
          <label class="lbl" for="lnkTitle">What is it?</label>
          <input class="inp" id="lnkTitle" type="text" placeholder="Logo &amp; brand work" onkeydown="if(event.key==='Enter')addLink()">
        </div>
        <div style="display:flex;align-items:flex-end">
          <button class="addbtn" onclick="addLink()">Add</button>
        </div>
      </div>
      <div class="sect">Or add files</div>
      <div class="drop" id="drop" onclick="document.getElementById('fileInput').click()">
        <b>Drop images or PDFs here</b>
        <span>or click to browse - they stay on this device</span>
      </div>
      <input type="file" id="fileInput" class="hide" multiple accept="image/*,application/pdf">
      <div class="sect">Saved</div>
      <div id="itemList" class="items"></div>
    </div>
    <div class="mfoot">
      <span class="count" id="pfCount"></span>
      <button class="btn" onclick="closePf()">Done</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>
`;
