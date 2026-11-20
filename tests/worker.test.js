const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
function makeWorker() {
  const messages=[];
  const context={ setInterval:()=>1, clearInterval:()=>{},
    self:{postMessage:x=>messages.push(x)}, importScripts:()=>{} };
  context.self.ParticlePhysics=require('../physics.js');
  vm.runInNewContext(fs.readFileSync(path.join(root,'worker.js'),'utf8'),context);
  return { messages, dispatch:message=>context.self.onmessage({data:message}) };
}
const emptyController='function controller(state, params, memory) { memory.calls=(memory.calls || 0)+1; return { fx:0, fy:0 }; }';
test('worker loads a no-control student template and can step',()=>{
  const w=makeWorker();
  w.dispatch({kind:'load',source:emptyController,mode:'step',config:{m:1,b:.7,fmax:14}});
  assert.equal(w.messages.at(-1).kind,'ready');
  w.dispatch({kind:'step'});
  assert.equal(w.messages.at(-1).kind,'frame');
  assert.equal(w.messages.at(-1).state.fx,0);
  assert.equal(w.messages.at(-1).state.fy,0);
});
test('worker accepts zero controller in all four challenge modes',()=>{
  const w=makeWorker();
  w.dispatch({kind:'load',source:emptyController,mode:'step',config:{m:1,b:.7,fmax:14}});
  w.dispatch({kind:'test'});
  assert.equal(w.messages.at(-1).kind,'test-results');
  const results=w.messages.at(-1).results;
  assert.equal(results.length,4);
  assert(results.every(v=>Number.isFinite(v.rms) && Number.isFinite(v.finalError)));
});
test('worker rejects infinite force',()=>{
  const w=makeWorker();
  w.dispatch({kind:'load',source:'function controller(){return {fx:Infinity,fy:0};}',mode:'step',config:{}});
  assert.equal(w.messages.at(-1).kind,'ready');
  w.dispatch({kind:'step'});
  assert.equal(w.messages.at(-1).kind,'error');
  assert.match(w.messages.at(-1).message,/finite/);
});
test('worker requires a named controller function',()=>{
  const w=makeWorker();
  w.dispatch({kind:'load',source:'const notController=()=>0;',mode:'step',config:{}});
  assert.equal(w.messages.at(-1).kind,'error');
});

test('controller can read params.dt when selecting forces', () => {
  const w=makeWorker();
  w.dispatch({kind:'load',
    source:'function controller(state, params, memory) { return { fx: params.dt * 100, fy: 0 }; }',
    mode:'step',config:{m:1,b:0,fmax:14,dt:0.05}});
  assert.equal(w.messages.at(-1).kind,'ready');
  w.dispatch({kind:'step'});
  assert.equal(w.messages.at(-1).kind,'frame');
  assert.equal(w.messages.at(-1).state.fx,5);
});

test('manual Step advances exactly one selected sampling interval', () => {
  const w=makeWorker();
  w.dispatch({kind:'load',source:emptyController,mode:'step',config:{dt:0.1}});
  w.dispatch({kind:'step'});
  assert(Math.abs(w.messages.at(-1).state.t-0.1)<1e-10);
});
test('playback heartbeat advances simulation time at selected dt', () => {
  const callbacks=[];
  const messages=[];
  const context={
    setInterval: (fn,ms) => {assert.equal(ms,20);callbacks.push(fn);return 1},
    clearInterval:()=>{},
    self:{postMessage:x=>messages.push(x)},importScripts:()=>{}
  };
  context.self.ParticlePhysics=require('../physics.js');
  vm.runInNewContext(fs.readFileSync(path.join(root,'worker.js'),'utf8'),context);
  const send=(data)=>context.self.onmessage({data});
  send({kind:'load',source:emptyController,mode:'step',config:{dt:0.005}});
  send({kind:'start'});
  callbacks.at(-1)(); // 20 ms wall-clock should produce 4 physics steps of 5 ms each
  assert.equal(messages.filter(x=>x.kind==='frame'&&x.reason!=='reset').length,4);
  assert(Math.abs(messages.at(-1).state.t-0.02)<1e-10);
  send({kind:'pause'});
  send({kind:'load',source:emptyController,mode:'step',config:{dt:0.1}});
  send({kind:'start'});
  for(let i=0;i<4;i++) callbacks.at(-1)();
  assert.equal(messages.at(-1).kind,'running'); // only 80 ms accumulated
  callbacks.at(-1)();
  assert(Math.abs(messages.at(-1).state.t-0.1)<1e-10);
});

test('v1.5 global helpers read state, params, and explicit student memory', () => {
  const w=makeWorker();
  w.dispatch({kind:'load',mode:'step',config:{m:2,b:0,fmax:50,dt:0.05},source:`
    function modelGain() { return params.m + params.dt * 100; }
    function readPosition() { return state.x; }
    function countCalls() { memory.calls = (memory.calls || 0) + 1; return memory.calls; }
    function controller() {
      const n = countCalls();
      return { fx: modelGain() + n + (readPosition() > -3.2 ? 1 : 0), fy: 0 };
    }
  `});
  assert.equal(w.messages.at(-1).kind,'ready');
  w.dispatch({kind:'step'});
  assert.equal(w.messages.at(-1).state.fx,8); // 2 + 5 + 1
  assert(Math.abs(w.messages.at(-1).state.t - .05)<1e-12);
  w.dispatch({kind:'step'});
  assert.equal(w.messages.at(-1).state.fx,10); // 2 + 5 + 2 + moved-position indicator
  assert(Math.abs(w.messages.at(-1).state.t - .10)<1e-12);
  w.dispatch({kind:'reset'});
  w.dispatch({kind:'step'});
  assert.equal(w.messages.at(-1).state.fx,8); // memory resets, and state resets
});

test('v1.5 globals in helper functions also work with legacy three-arg controller', () => {
  const w=makeWorker();
  w.dispatch({kind:'load',mode:'step',config:{m:2,b:0,fmax:14,dt:.01},source:`
    function inverseModel(a) { return params.m*a + params.b*state.vx; }
    function controller(state, params, memory) {
      memory.times = (memory.times || 0) + 1;
      return { fx: inverseModel(memory.times), fy: 0 };
    }
  `});
  assert.equal(w.messages.at(-1).kind,'ready');
  w.dispatch({kind:'step'});
  assert.equal(w.messages.at(-1).state.fx,2);
  w.dispatch({kind:'step'});
  assert.equal(w.messages.at(-1).state.fx,4);
});

test('v1.5 leaves memory untouched unless student writes to it', () => {
  const w=makeWorker();
  w.dispatch({kind:'load',mode:'step',config:{b:0,dt:.02},source:`
    function controller() {
      // Simulator should not fill any keys or update prior positions itself.
      return { fx: Object.keys(memory).length, fy: 0 };
    }
  `});
  for(let i=0;i<3;i++) {
    w.dispatch({kind:'step'});
    assert.equal(w.messages.at(-1).state.fx,0);
  }
});

test('v1.5 physical plant state is advanced by simulator, not student code', () => {
  const w=makeWorker();
  w.dispatch({kind:'load',mode:'step',config:{m:1,b:0,dt:.02},source:`
    function tryChangingSnapshot() { state.x = 999; params.dt = 1; }
    function controller() { tryChangingSnapshot(); return {fx:0,fy:0}; }
  `});
  w.dispatch({kind:'step'});
  assert.equal(w.messages.at(-1).state.x,-3.2);
  assert(Math.abs(w.messages.at(-1).state.t-.02)<1e-12);
});

test('v1.5 challenge tests start with fresh controller globals and memory', () => {
  const w=makeWorker();
  w.dispatch({kind:'load',mode:'step',config:{m:1,b:.7,dt:.05},source:`
    function nextForce() { memory.counter=(memory.counter || 0)+1; return memory.counter % 3; }
    function controller() { return { fx: nextForce(), fy: 0 }; }
  `});
  w.dispatch({kind:'test'});
  assert.equal(w.messages.at(-1).kind,'test-results');
  const before=JSON.stringify(w.messages.at(-1).results);
  w.dispatch({kind:'test'});
  assert.equal(w.messages.at(-1).kind,'test-results');
  assert.equal(JSON.stringify(w.messages.at(-1).results),before);
});

test('v1.5.2 editor starter compiles and applies saturated P force', () => {
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const match=app.match(/const starterCode = `([\s\S]*?)`;/);
  assert(match,'Student starter string must be found in app.js');
  const w=makeWorker();
  w.dispatch({kind:'load',mode:'step',config:{},source:match[1]});
  assert.equal(w.messages.at(-1).kind,'ready');
  w.dispatch({kind:'step'});
  assert.equal(w.messages.at(-1).state.fx,14);
  assert.equal(w.messages.at(-1).state.fy,14);
});

test('v1.6 calls optional init once before first controller sample', () => {
  const w=makeWorker();
  w.dispatch({kind:'load',mode:'step',config:{m:2,b:0,fmax:40,dt:.02},source:`
    function initialForce() { return memory.force + params.m + state.target.x - 2.5; }
    function init() {
      memory.force = 3;
      memory.initialX = state.x;
      memory.initialTime = state.t;
    }
    function controller() {
      const force = initialForce();
      memory.force += 1;
      return { fx: force, fy: memory.initialX + 3.2 + memory.initialTime };
    }
  `});
  assert.equal(w.messages.at(-1).kind,'ready');
  w.dispatch({kind:'step'});
  assert.equal(w.messages.at(-1).state.fx,5);
  assert.equal(w.messages.at(-1).state.fy,0);
  w.dispatch({kind:'step'});
  assert.equal(w.messages.at(-1).state.fx,6);
});

test('v1.6 pause / resume and consecutive Steps never rerun init', () => {
  const w=makeWorker();
  w.dispatch({kind:'load',mode:'step',config:{b:0},source:`
    function init() { memory.n = 0; }
    function controller() { memory.n += 1; return { fx: memory.n, fy: 0 }; }
  `});
  w.dispatch({kind:'step'}); assert.equal(w.messages.at(-1).state.fx,1);
  w.dispatch({kind:'pause'});
  w.dispatch({kind:'start'});
  w.dispatch({kind:'pause'});
  w.dispatch({kind:'step'}); assert.equal(w.messages.at(-1).state.fx,2);
  w.dispatch({kind:'step'}); assert.equal(w.messages.at(-1).state.fx,3);
});

test('v1.6 reset reruns init with an empty memory and a fresh helper scope', () => {
  const w=makeWorker();
  w.dispatch({kind:'load',mode:'step',config:{b:0},source:`
    let hidden = 0;
    function init() { hidden++; memory.n = hidden; }
    function controller() { return { fx: memory.n, fy: 0 }; }
  `});
  w.dispatch({kind:'step'}); assert.equal(w.messages.at(-1).state.fx,1);
  w.dispatch({kind:'reset'}); assert.equal(w.messages.at(-1).kind,'frame');
  w.dispatch({kind:'step'}); assert.equal(w.messages.at(-1).state.fx,1);
  w.dispatch({kind:'reset'});
  w.dispatch({kind:'step'}); assert.equal(w.messages.at(-1).state.fx,1);
});

test('v1.6 each offline challenge calls init once with its own starting state', () => {
  const w=makeWorker();
  w.dispatch({kind:'load',mode:'step',config:{dt:.1},source:`
    function init() {
      self.postMessage({kind:'student-init', x:state.x, t:state.t, targetX:state.target.x});
      memory.base = state.x;
      memory.counter = 0;
    }
    function controller() {
      memory.counter++;
      return { fx: memory.counter === 1 ? 1 : 0, fy: 0 };
    }
  `});
  assert.equal(w.messages.filter(v=>v.kind==='student-init').length,1);
  w.dispatch({kind:'test'});
  assert.equal(w.messages.at(-1).kind,'test-results');
  const initMessages=w.messages.filter(v=>v.kind==='student-init');
  assert.equal(initMessages.length,5); // 1 live + 4 separate challenges
  assert(initMessages.every(v=>v.t===0));
  assert.equal(initMessages[3].x,-2.8); // circle scenario starts elsewhere
  assert.equal(initMessages[1].x,-3.2);
  const original=w.messages.at(-1).results;
  w.dispatch({kind:'test'});
  assert.equal(w.messages.at(-1).kind,'test-results');
  assert.equal(JSON.stringify(w.messages.at(-1).results),JSON.stringify(original));
  assert.equal(w.messages.filter(v=>v.kind==='student-init').length,9);
  // Testing must not reset the live controller's memory.
  w.dispatch({kind:'step'}); assert.equal(w.messages.at(-1).state.fx,1);
  w.dispatch({kind:'step'}); assert.equal(w.messages.at(-1).state.fx,0);
});

test('v1.6 allows old three-argument callback signature for init and controller', () => {
  const w=makeWorker();
  w.dispatch({kind:'load',mode:'step',config:{m:2,dt:.05},source:`
    function init(state, params, memory) { memory.n = params.m + state.target.x; }
    function controller(state, params, memory) {
      return { fx: memory.n, fy: params.dt * 20 };
    }
  `});
  w.dispatch({kind:'step'});
  assert.equal(w.messages.at(-1).state.fx,4.5);
  assert.equal(w.messages.at(-1).state.fy,1);
});

test('v1.6 reports init failures instead of silently running controller', () => {
  const w=makeWorker();
  w.dispatch({kind:'load',mode:'step',config:{},source:`
    function init() { throw new Error('bad initialization'); }
    function controller() { return {fx:0,fy:0}; }
  `});
  assert.equal(w.messages.at(-1).kind,'error');
  assert.match(w.messages.at(-1).message,/bad initialization/);
  assert(!w.messages.some(v=>v.kind==='ready'));
});

test('v1.6 starter includes both standard callbacks and a reusable P helper', () => {
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const match=app.match(/const starterCode = `([\s\S]*?)`;/);
  assert(match);
  assert.match(match[1],/function init\(\)/);
  assert.match(match[1],/function P\(\)/);
  assert.match(match[1],/function controller\(\)/);
  const w=makeWorker();
  w.dispatch({kind:'load',source:match[1],mode:'step',config:{}});
  assert.equal(w.messages.at(-1).kind,'ready');
  w.dispatch({kind:'step'});
  assert.equal(w.messages.at(-1).state.fx,14);
  assert.equal(w.messages.at(-1).state.fy,14);
});

test('v1.6 starting after the 30-second endpoint initializes a fresh run', () => {
  const w=makeWorker();
  w.dispatch({kind:'load',mode:'step',config:{dt:0.1,b:0},source:`
    function init() { memory.start = 6; }
    function controller() { return { fx: memory.start, fy: 0 }; }
  `});
  // Advance the 30 s run exactly 300 steps; final step sends done.
  for (let i=0; i<300; i++) w.dispatch({kind:'step'});
  assert.equal(w.messages.at(-1).kind,'done');
  w.dispatch({kind:'start'});
  assert.equal(w.messages.at(-1).kind,'running');
  const resets=w.messages.filter(v=>v.kind==='frame'&&v.reason==='reset');
  assert.equal(resets.length,2);
  assert.equal(resets.at(-1).state.t,0);
  w.dispatch({kind:'pause'});
  w.dispatch({kind:'step'});
  assert.equal(w.messages.at(-1).state.fx,6);
  assert(Math.abs(w.messages.at(-1).state.t-.1)<1e-10);
});

test('v1.6 failed initialization does not leave a partially loaded controller active', () => {
  const w=makeWorker();
  w.dispatch({kind:'load',mode:'step',config:{},source:`
    function init() { throw new Error('failed initialization'); }
    function controller() { return {fx:7, fy:0}; }
  `});
  assert.equal(w.messages.at(-1).kind,'error');
  w.dispatch({kind:'step'});
  assert.equal(w.messages.at(-1).kind,'error');
  assert.match(w.messages.at(-1).message,/Load your controller first/);
});
