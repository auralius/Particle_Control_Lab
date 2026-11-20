/* ParticleLab UI. All physics and student controller execution lives in worker.js. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  // Use a separate save key so an instructor's worked PD/PID examples
  // from the same localhost origin never appear in the student edition.
  // New key makes this version's P-controller starter visible on first launch;
  // earlier localStorage entries are kept separately.
  const savedKey = 'particlelab.student.controller.v1_5_2';
  const starterCode = `function P(){
  const Kp = 10.0;
  
  // Position errors
  const ex = state.target.x - state.x;
  const ey = state.target.y - state.y;

  // Control forces
  const fx = Kp * ex;
  const fy = Kp * ey;
  
  return {fx, fy}
}
 
// Main controller
function controller() {
  const p = P();

  // Access the returned forces
  const fx = p.fx;
  const fy = p.fy;

  return { fx, fy };
}`;  // Safe fallback for recovering from an unresponsive student controller.
  const noControlCode = 'function controller() { return { fx: 0, fy: 0 }; }';
  const world = $('world'), worldCtx = world.getContext('2d');
  const chart = $('errorChart'), chartCtx = chart.getContext('2d');
  let worker = null;
  let current = { t: 0, x: -3.2, y: -2, vx: 0, vy: 0, fx: 0, fy: 0 };
  let target = { x: 2.5, y: 1.6 };
  let disturbance = { fx: 0, fy: 0 };
  let metrics = {};
  let history = [];
  let dirty = false;
  let pendingAction = null;
  let status = 'ready';
  let lastWorkerMessage = Date.now();
  let lastDpr = 1;

  function displayStatus(label, type = 'ready') {
    status = type;
    const el = $('statusLabel');
    el.className = 'live-indicator ' + (type === 'error' ? 'error' : type === 'running' ? 'running' : '');
    el.innerHTML = '<i></i> ' + label.replaceAll('<', '&lt;');
  }
  function message(text, type) {
    const el = $('message'); el.textContent = text;
    el.className = 'editor-helper' + (type ? ' ' + type : '');
  }
  function send(kind, data = {}) {
    if (worker) worker.postMessage({ kind, ...data });
  }
  function showLocalServerHelp() {
    pendingAction = null;
    displayStatus('Local server required', 'error');
    message('This page was opened as file://. Browsers block worker.js in this mode. In this folder run: python3 -m http.server 8000  •  Then open http://localhost:8000/', 'error');
  }
  function createWorker() {
    if (worker) { worker.terminate(); worker = null; }
    if (location.protocol === 'file:') {
      showLocalServerHelp();
      return false;
    }
    try {
      worker = new Worker('./worker.js?v=1.5.2');
    } catch (err) {
      displayStatus('Worker unavailable', 'error');
      message('Could not start the controller worker: ' + (err.message || err) + '. Try serving the project via python3 -m http.server 8000.', 'error');
      return false;
    }
    lastWorkerMessage = Date.now();
    worker.onmessage = evt => {
      lastWorkerMessage = Date.now();
      const info = evt.data || {};
      if (info.kind === 'frame') {
        if (info.reason === 'reset') { history = []; $('testResults').innerHTML = '<div class="empty-tests">Run the four challenges to see your results here.</div>'; }
        current = info.state; target = info.target; disturbance = info.disturbance;
        metrics = info.metrics;
        if (info.reason !== 'target') {
          const error = Math.hypot(target.x - current.x, target.y - current.y);
          history.push({ ...current, tx: target.x, ty: target.y, error });
        }
        updateMetrics(); requestDraw();
      } else if (info.kind === 'ready') {
        dirty = false;
        message('Controller loaded. Press Run, Step, or run the challenges.', 'success');
        displayStatus('Ready');
        if (pendingAction) { const action = pendingAction; pendingAction = null; send(action); }
      } else if (info.kind === 'running') displayStatus('Simulating', 'running');
      else if (info.kind === 'paused') displayStatus('Paused');
      else if (info.kind === 'done') { displayStatus('Completed'); message('Run complete. Export your measurements as CSV.', 'success'); }
      else if (info.kind === 'error') {
        pendingAction = null; displayStatus('Error', 'error'); message(info.message || 'Unknown controller error', 'error');
      } else if (info.kind === 'test-start') {
        displayStatus('Testing', 'running');
        $('testResults').innerHTML = '<div class="empty-tests">Running four offline challenges…</div>';
      } else if (info.kind === 'test-results') {
        displayStatus('Ready'); renderTests(info.results);
      }
    };
    worker.onerror = evt => {
      pendingAction = null;
      displayStatus('Worker error', 'error');
      message('Controller worker failed: ' + (evt.message || 'Could not load worker.js') + '. Make sure worker.js and physics.js are in the same folder and the page is served over http://localhost.', 'error');
    };
    return true;
  }
  function readConfig() {
    return { m: +$('massInput').value, b: +$('dampingInput').value,
      fmax: +$('forceInput').value, dt: +$('dtSelect').value };
  }
  function updateDtLabels() {
    const dt = +$('dtSelect').value;
    const seconds = dt.toFixed(3);
    const hz = Math.round(1 / dt);
    const text = `${seconds} s (${hz} Hz)`;
    $('stepSizeLabel').textContent = `${Math.round(dt * 1000)} ms`;
    $('apiDtLabel').textContent = text;
    $('configDtLabel').textContent = `Tₛ = ${text} · 30 s max`;
    $('equationDtLabel').textContent = `${seconds} s`;
  }
  function sanitizeUi() {
    for (const [id, lo, hi, fallback] of [['massInput',.2,10,1],['dampingInput',0,8,.7],['forceInput',1,50,14]]) {
      const input=$(id), raw=Number(input.value);
      input.value = String(Number.isFinite(raw) && input.value !== '' ? Math.max(lo, Math.min(hi, raw)) : fallback);
    }
  }
  function apply(next = null) {
    sanitizeUi(); updateDtLabels(); pendingAction = next;
    displayStatus('Loading', 'loading'); message('Compiling controller…');
    // Terminate previous worker: frees a blocked or stale controller.
    const workerStarted = createWorker();
    if (workerStarted) send('load', { source: $('codeEditor').value, config: readConfig(), mode: $('modeSelect').value,
      speed: +$('speedSelect').value });
    persistEditor();
    stageHint();
  }
  function runOrStep(action) { if (dirty) apply(action); else send(action); }
  function updateMetrics() {
    const err = Math.hypot(target.x-current.x,target.y-current.y);
    $('metricError').textContent = err.toFixed(2);
    $('metricRms').textContent = metrics.rms == null ? '—' : metrics.rms.toFixed(2);
    $('metricForce').textContent = Math.hypot(current.fx,current.fy).toFixed(2);
    $('metricVelocity').textContent = Math.hypot(current.vx,current.vy).toFixed(2);
    $('stageTime').textContent = 't = ' + current.t.toFixed(2) + ' s';
    $('chartInfo').textContent = current.t.toFixed(1) + ' of 30 s';
    $('csvBtn').disabled = history.length < 2;
  }
  function stageHint() {
    const mode=$('modeSelect').value;
    $('stageHint').textContent = mode === 'step' || mode === 'wind'
      ? 'Click anywhere to move the target'
      : mode === 'circle' ? 'The target follows an ellipse' : 'Target switches at t = 8 s';
  }
  function canvasResize(canvas, ctx) {
    const rect=canvas.getBoundingClientRect();
    const dpr=Math.min(window.devicePixelRatio||1,2);
    const w=Math.max(100,rect.width),h=Math.max(100,rect.height);
    const dw=Math.round(w*dpr),dh=Math.round(h*dpr);
    if (canvas.width !== dw || canvas.height !== dh) { canvas.width=dw;canvas.height=dh; }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    return { w,h };
  }
  function worldTransform(w,h) {
    const scale=Math.min(w/12.5,h/8.8);
    return { scale, x: x => w*.5+x*scale, y: y => h*.5-y*scale,
      ix: px => (px-w*.5)/scale, iy: py => (h*.5-py)/scale };
  }
  function drawArrow(ctx,x1,y1,x2,y2,color,width=2) {
    const dx=x2-x1,dy=y2-y1,ang=Math.atan2(dy,dx);
    ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=width;
    ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
    ctx.beginPath();ctx.moveTo(x2,y2);ctx.lineTo(x2-9*Math.cos(ang-.48),y2-9*Math.sin(ang-.48));
    ctx.lineTo(x2-9*Math.cos(ang+.48),y2-9*Math.sin(ang+.48));ctx.closePath();ctx.fill();
  }
  function drawWorld() {
    const {w,h}=canvasResize(world,worldCtx),ctx=worldCtx,tf=worldTransform(w,h);
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle='#091525';ctx.fillRect(0,0,w,h);
    const xx=w*.5,yy=h*.5,grid=tf.scale;
    ctx.lineWidth=1;
    for (let i=-20;i<=20;i++) {
      const x=xx+i*grid,y=yy+i*grid;
      ctx.strokeStyle=i===0?'#477187':'#1c3448';
      ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();
      if (i!==0 && i%2===0) {
        ctx.fillStyle='#58758b';ctx.font='10px ui-monospace,monospace';
        if (x>10&&x<w-18)ctx.fillText(String(i),x+3,yy+14);
        if (y>10&&y<h-15)ctx.fillText(String(-i),xx+7,y-5);
      }
    }
    // Ghost ellipse makes moving-target tasks understandable.
    if ($('modeSelect').value === 'circle') {
      ctx.strokeStyle='#e4b96a4f';ctx.setLineDash([5,8]);ctx.lineWidth=1.4;
      ctx.beginPath();ctx.ellipse(xx,yy,2.4*grid,1.8*grid,0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    }
    // Trail of particle trajectory.
    if(history.length>1) {
      ctx.lineWidth=2.5;ctx.strokeStyle='#5be2c4';ctx.globalAlpha=.73;
      ctx.beginPath();
      history.forEach((p,i)=> i===0?ctx.moveTo(tf.x(p.x),tf.y(p.y)):ctx.lineTo(tf.x(p.x),tf.y(p.y)));
      ctx.stroke();ctx.globalAlpha=1;
      // A few faded breadcrumb points.
      for(let i=Math.max(0,history.length-400);i<history.length;i+=18){
        const p=history[i];ctx.fillStyle='#72eaca55';ctx.beginPath();ctx.arc(tf.x(p.x),tf.y(p.y),2,0,7);ctx.fill();
      }
    }
    // Target marker: ring and a cross.
    const tx=tf.x(target.x),ty=tf.y(target.y);
    ctx.strokeStyle='#ffca79';ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(tx,ty,14,0,Math.PI*2);ctx.stroke();
    ctx.strokeStyle='#ffca7999';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(tx-22,ty);ctx.lineTo(tx+22,ty);ctx.moveTo(tx,ty-22);ctx.lineTo(tx,ty+22);ctx.stroke();
    ctx.fillStyle='#ffca79';ctx.beginPath();ctx.arc(tx,ty,3.5,0,Math.PI*2);ctx.fill();
    // Displacement line and applied force vector.
    const px=tf.x(current.x),py=tf.y(current.y);
    ctx.strokeStyle='#9eeacf4d';ctx.setLineDash([3,6]);ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(tx,ty);ctx.stroke();ctx.setLineDash([]);
    const forceLength=Math.hypot(current.fx,current.fy);
    if(forceLength>.01) {
      const len=Math.min(45,forceLength*2.7);
      drawArrow(ctx,px,py,px+current.fx/forceLength*len,py-current.fy/forceLength*len,'#e3fafa',1.6);
    }
    ctx.shadowColor='#52e6c2';ctx.shadowBlur=23;ctx.fillStyle='#63e4c3';
    ctx.beginPath();ctx.arc(px,py,8.5,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    ctx.strokeStyle='#dcfff4';ctx.lineWidth=1.4;ctx.stroke();
    if($('modeSelect').value==='wind' && current.t>=7){
      ctx.fillStyle='#ffca79';ctx.font='11px system-ui';ctx.fillText('WIND ON',14,h-40);
    }
  }
  function drawChart() {
    const {w,h}=canvasResize(chart,chartCtx),ctx=chartCtx;
    ctx.fillStyle='#091525';ctx.fillRect(0,0,w,h);
    const p={l:43,r:15,t:16,b:28},cw=w-p.l-p.r,ch=h-p.t-p.b;
    const emax=Math.max(1,...history.map(v=>v.error));
    const maxY=Math.ceil(emax*1.12*2)/2;
    ctx.font='10px ui-monospace,monospace';ctx.textAlign='right';
    for(let i=0;i<=4;i++){
      const y=p.t+(ch*i/4),val=maxY*(1-i/4);
      ctx.strokeStyle='#244055';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(p.l,y);ctx.lineTo(w-p.r,y);ctx.stroke();
      ctx.fillStyle='#8ca2b9';ctx.fillText(val.toFixed(1),p.l-9,y+4);
    }
    ctx.textAlign='center';
    for(let i=0;i<=6;i++){
      const x=p.l+cw*i/6;ctx.strokeStyle='#1b3042';ctx.beginPath();ctx.moveTo(x,p.t);ctx.lineTo(x,p.t+ch);ctx.stroke();
      ctx.fillStyle='#829bb1';ctx.fillText(String(i*5)+'s',x,p.t+ch+17);
    }
    if(!history.length)return;
    const fx=t=>p.l+(t/30)*cw,fy=v=>p.t+ch-(v/maxY)*ch;
    ctx.beginPath();history.forEach((pt,i)=>i?ctx.lineTo(fx(pt.t),fy(pt.error)):ctx.moveTo(fx(pt.t),fy(pt.error)));
    ctx.strokeStyle='#65e6c5';ctx.lineWidth=2.2;ctx.stroke();
    const last=history[history.length-1];ctx.fillStyle='#65e6c5';ctx.beginPath();ctx.arc(fx(last.t),fy(last.error),3.5,0,7);ctx.fill();
  }
  let queued=false;
  function requestDraw(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;drawWorld();drawChart();});}
  function renderTests(data) {
    const names={step:'Reach a fixed target',switch:'Recover after reversal',circle:'Track a moving target',wind:'Reject an external force'};
    const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    $('testResults').innerHTML=data.map(t=>`<div class="test-card ${t.passed?'passed':'failed'}">
      <h3>${esc(names[t.mode])}</h3><span class="result-status">${t.passed?'✓ TARGET MET':'○ KEEP TUNING'}</span>
      <strong>${(t.mode==='circle'?t.rms:t.finalError).toFixed(3)} <small style="display:inline">m</small></strong>
      <small>${esc(t.criterion)}</small><small class="cutoff">Goal: &lt; ${t.threshold.toFixed(2)} m · ${t.seconds}s run</small>
    </div>`).join('');
    const count=data.filter(t=>t.passed).length;
    message(`Challenges completed: ${count} of ${data.length} goals met. You can tune gains and retry.`,count===data.length?'success':'');
  }
  function exportCsv() {
    if(history.length < 2)return;
    const header='t_s,x_m,y_m,target_x_m,target_y_m,vx_mps,vy_mps,Fx_N,Fy_N,error_m';
    const rows=history.map(s=>[s.t,s.x,s.y,s.tx,s.ty,s.vx,s.vy,s.fx,s.fy,s.error].map(v=>Number(v).toFixed(6)).join(','));
    download('particlelab-response.csv',[header,...rows].join('\n'),'text/csv');
  }
  function download(name,contents,mime){
    const blob=new Blob([contents],{type:mime+';charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function persistEditor(){try{localStorage.setItem(savedKey,$('codeEditor').value)}catch(e){/* disabled storage */}}
  function loadSaved(){try{return localStorage.getItem(savedKey)}catch(e){return null}}
  function lineNumbers(){
    $('lineNumbers').textContent=Array.from({length:$('codeEditor').value.split('\n').length},(_,i)=>i+1).join('\n');
    $('lineNumbers').scrollTop=$('codeEditor').scrollTop;
  }
  function handleQuery(){
    const query=new URLSearchParams(location.search);
    const mode=query.get('task');if(['step','switch','circle','wind'].includes(mode))$('modeSelect').value=mode;
    [['m','massInput'],['b','dampingInput'],['fmax','forceInput'],['dt','dtSelect']].forEach(([param,id])=>{
      if(query.has(param) && query.get(param)!=='')$(id).value=query.get(param);
    });
    sanitizeUi();
    // Invalid query values fall back to the classroom default 20 ms.
    if (!['0.005','0.01','0.02','0.05','0.1'].includes($('dtSelect').value)) $('dtSelect').value='0.02';
  }
  function init() {
    handleQuery(); updateDtLabels();
    $('codeEditor').value=loadSaved() ?? starterCode;
    lineNumbers();stageHint();
    $('codeEditor').addEventListener('input',()=>{dirty=true;lineNumbers();message('Unsaved changes. Run or Apply to compile the new controller.');persistEditor();});
    $('codeEditor').addEventListener('scroll',lineNumbers);
    $('codeEditor').addEventListener('keydown',e=>{
      if(e.key==='Tab'){
        e.preventDefault();const s=e.target.selectionStart,end=e.target.selectionEnd;
        e.target.setRangeText('  ',s,end,'end');e.target.dispatchEvent(new Event('input'));
      }else if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();runOrStep('start');}
    });
    $('restoreBtn').addEventListener('click',()=>{
      if($('codeEditor').value !== starterCode &&
        !confirm('Discard your current code and restore the P controller starter?'))return;
      $('codeEditor').value=starterCode;dirty=true;lineNumbers();persistEditor();message('Starter restored. Press Run or Apply to compile.');
    });
    $('applyBtn').addEventListener('click',()=>apply());
    $('runBtn').addEventListener('click',()=>runOrStep('start'));
    $('pauseBtn').addEventListener('click',()=>send('pause'));
    $('stepBtn').addEventListener('click',()=>runOrStep('step'));
    $('resetBtn').addEventListener('click',()=>apply());
    $('testBtn').addEventListener('click',()=>runOrStep('test'));
    $('speedSelect').addEventListener('change',()=>send('speed',{speed:+$('speedSelect').value}));
    for(const id of ['modeSelect','massInput','dampingInput','forceInput','dtSelect'])$(id).addEventListener('change',()=>apply());
    $('saveBtn').addEventListener('click',()=>download('student-controller.js',$('codeEditor').value+'\n','text/javascript'));
    $('csvBtn').addEventListener('click',exportCsv);
    $('shareBtn').addEventListener('click',async()=>{
      sanitizeUi();const url=new URL(location.href),cfg=readConfig();
      url.searchParams.set('task',$('modeSelect').value);url.searchParams.set('m',cfg.m);url.searchParams.set('b',cfg.b);url.searchParams.set('fmax',cfg.fmax);url.searchParams.set('dt',cfg.dt);
      try {await navigator.clipboard.writeText(url.href);message('Setup link copied. It includes plant parameters, not controller code.','success');}
      catch(e){prompt('Copy setup link:',url.href);}
    });
    world.addEventListener('pointerdown',event=>{
      if(!['step','wind'].includes($('modeSelect').value))return;
      const rect=world.getBoundingClientRect(),t=worldTransform(rect.width,rect.height);
      const px=event.clientX-rect.left,py=event.clientY-rect.top;
      send('target',{x:Math.max(-5.5,Math.min(5.5,t.ix(px))),y:Math.max(-5.5,Math.min(5.5,t.iy(py)))});
    });
    window.addEventListener('resize',requestDraw);
    setInterval(()=>{
      if (status === 'loading' && worker && Date.now()-lastWorkerMessage > 5000) {
        worker.terminate(); worker = null; pendingAction = null;
        displayStatus('Controller timed out', 'error');
        message('The controller did not finish loading within 5 s. Check the code for a long loop at the top level, then click Apply & reset. If running locally, start the HTTP server as described in the README.', 'error');
        dirty = true;
      }
      if ((status==='running') && Date.now()-lastWorkerMessage>5000) {
        displayStatus('Error','error');message('Controller did not respond. Worker restarted. Check for infinite loops.','error');
        createWorker();send('load',{source:noControlCode,config:readConfig(),mode:$('modeSelect').value});
        dirty=true;
      }
    },1000);
    displayStatus('Loading', 'loading');
    if (createWorker()) send('load',{source:$('codeEditor').value,config:readConfig(),mode:$('modeSelect').value});
    updateMetrics();requestDraw();
  }
  init();
})();
