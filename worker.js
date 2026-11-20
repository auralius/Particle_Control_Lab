'use strict';
importScripts('./physics.js');
const P = self.ParticlePhysics;
let config = P.sanitizeConfig(P.DEFAULTS);
let mode = 'step';
let userSource = '';
let userController = null;
let memory = {};
let state = P.initial(mode);
let manualTarget = null;
let timer = null;
let speed = 1;
let playbackBudget = 0; // virtual seconds pending since last 20 ms wall-clock tick
let metrics = {};

function freshMetrics() { return { count: 0, err2: 0, force2: 0, finalError: 0 }; }
function serializeMetrics() {
  return { rms: metrics.count ? Math.sqrt(metrics.err2 / metrics.count) : null,
    forceRms: metrics.count ? Math.sqrt(metrics.force2 / metrics.count) : null,
    finalError: metrics.finalError };
}
function snapshot(reason) {
  const target = P.targetAt(state.t, mode, manualTarget);
  self.postMessage({ kind: 'frame', state, target, disturbance: P.disturbanceAt(state.t, mode),
    metrics: serializeMetrics(), reason: reason || '' });
}
function stop() { if (timer !== null) clearInterval(timer); timer = null; }
function reset() {
  stop(); playbackBudget = 0;
  memory = {}; state = P.initial(mode); metrics = freshMetrics(); snapshot('reset');
}
function compile(src) {
  // Student code runs in a dedicated Web Worker, not in the page's UI context.
  // This is not a security boundary for untrusted scripts.
  // Each compiled controller gets its own script-level bindings. They are
  // accessible by name in EVERY student helper function and are refreshed
  // just before each controller call. They are not the simulator's own state.
  // Keeping them inside this closure also isolates challenge-test runs.
  const factory = new Function('"use strict";\n'
    + 'let state, params, memory;\n'
    + src
    + '\nif (typeof controller !== "function") return null;\n'
    + 'return function invokeController(currentState, currentParams, currentMemory) {\n'
    + '  state = currentState; params = currentParams; memory = currentMemory;\n'
    // Always supply arguments too, so v1.4 controller(state, params, memory)
    // works without edits while v1.5 controller() may omit them entirely.
    + '  return controller(currentState, currentParams, currentMemory);\n'
    + '};');
  const fn = factory();
  if (typeof fn !== 'function') throw new Error('Define function controller() (or controller(state, params, memory)).');
  return fn;
}
function validateForces(output) {
  if (!output || typeof output !== 'object') throw new Error('Controller must return { fx, fy }.');
  if (typeof output.fx !== 'number' || !Number.isFinite(output.fx) ||
      typeof output.fy !== 'number' || !Number.isFinite(output.fy)) {
    throw new Error('fx and fy must be finite numbers.');
  }
  return { fx: output.fx, fy: output.fy };
}
function oneStep() {
  const target = P.targetAt(state.t, mode, manualTarget);
  const input = { t: state.t, x: state.x, y: state.y, vx: state.vx, vy: state.vy,
    target: Object.assign({}, target) };
  // A copy prevents student code from changing the simulator's own parameters.
  const output = validateForces(userController(input, { ...config }, memory));
  const result = P.step(state, output, config, mode, manualTarget);
  state = result.state;
  if (state.t >= 2) {
    metrics.count++;
    metrics.err2 += result.error * result.error;
    metrics.force2 += result.effort * result.effort;
  }
  metrics.finalError = result.error;
  snapshot();
  if (state.t >= P.DURATION - 1e-8) { stop(); self.postMessage({ kind: 'done' }); }
}
function safeStep() {
  try { oneStep(); }
  catch (err) { stop(); self.postMessage({ kind: 'error', message: String(err.message || err) }); }
}
// A 20 ms *wall-clock* heartbeat is distinct from the chosen physics sample time.
// At 1x, advance 0.020 s of simulation per heartbeat, using as many (or as few)
// integration steps as needed. This also supports 50/100 ms sampling periods.
function playbackTick() {
  playbackBudget += 0.02 * speed;
  let count = 0;
  while (timer !== null && playbackBudget + 1e-10 >= config.dt && count < 64) {
    playbackBudget -= config.dt;
    if (playbackBudget < 0) playbackBudget = 0;
    safeStep();
    count++;
  }
}
function testCase(testMode, seconds, threshold) {
  const controller = compile(userSource); // resets any closure variables per case
  const localMemory = {};
  let s = P.initial(testMode);
  let count = 0, totalSquared = 0, forceSquared = 0, lastError = 0;
  const steps = Math.round(seconds / config.dt);
  for (let k = 0; k < steps; k++) {
    const target = P.targetAt(s.t, testMode, null);
    const request = validateForces(controller({ t: s.t, x: s.x, y: s.y, vx: s.vx, vy: s.vy,
      target: { ...target } }, { ...config }, localMemory));
    const out = P.step(s, request, config, testMode, null);
    s = out.state;
    lastError = out.error;
    if (s.t >= 10) { count++; totalSquared += lastError * lastError;
      forceSquared += out.effort * out.effort; }
  }
  const rms = Math.sqrt(totalSquared / Math.max(count, 1));
  return { mode: testMode, seconds, rms, finalError: lastError,
    forceRms: Math.sqrt(forceSquared / Math.max(count, 1)),
    passed: testMode === 'circle' ? rms < threshold : lastError < threshold,
    threshold, criterion: testMode === 'circle' ? 'RMS tracking error (t ≥ 10 s)' : 'Final position error' };
}
self.onmessage = function (event) {
  const msg = event.data || {};
  try {
    switch (msg.kind) {
      case 'load':
        stop(); userSource = String(msg.source || '');
        userController = compile(userSource);
        mode = P.MODES.includes(msg.mode) ? msg.mode : 'step';
        config = P.sanitizeConfig(msg.config);
        speed = P.clamp(Number(msg.speed) || 1, 1, 4);
        manualTarget = null; reset();
        self.postMessage({ kind: 'ready' });
        break;
      case 'start':
        if (!userController) throw new Error('Press Apply & Reset to load your controller.');
        if (state.t >= P.DURATION - 1e-8) reset();
        stop();
        timer = setInterval(playbackTick, 20);
        self.postMessage({ kind: 'running' });
        break;
      case 'pause': stop(); self.postMessage({ kind: 'paused' }); break;
      case 'step': if (!userController) throw new Error('Load your controller first.');
        stop(); playbackBudget = 0;
        if (state.t < P.DURATION - 1e-8) safeStep(); break;
      case 'reset': reset(); break;
      case 'target':
        if (mode !== 'step' && mode !== 'wind') return;
        manualTarget = { x: Number(msg.x), y: Number(msg.y) }; snapshot('target'); break;
      case 'speed': speed = P.clamp(Number(msg.speed) || 1, 1, 4); break;
      case 'test':
        stop();
        if (!userController) throw new Error('Load your controller first.');
        self.postMessage({ kind: 'test-start' });
        const results = [testCase('step', 20, 0.3), testCase('switch', 22, 0.3),
          testCase('circle', 24, 1.1), testCase('wind', 20, 0.4)];
        self.postMessage({ kind: 'test-results', results });
        break;
    }
  } catch (err) { stop(); self.postMessage({ kind: 'error', message: String(err.message || err) }); }
};
