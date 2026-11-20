/* Shared plant model: browser Web Worker + Node.js tests.
 * Position is in meters, time in seconds, forces in newtons.
 * Integrator: fixed-step semi-implicit Euler.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ParticlePhysics = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DT = 0.02; // default only; experiment setup may override it
  const SAMPLE_PERIODS = Object.freeze([0.005, 0.01, 0.02, 0.05, 0.1]);
  const DURATION = 30;
  const DEFAULTS = Object.freeze({ m: 1, b: 0.7, fmax: 14, dt: DT });
  const MODES = ['step', 'switch', 'circle', 'wind'];
  function finite(v, fallback) { return Number.isFinite(v) ? v : fallback; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function sanitizeConfig(input) {
    const a = input || {};
    return {
      m: clamp(finite(Number(a.m), DEFAULTS.m), 0.2, 10),
      b: clamp(finite(Number(a.b), DEFAULTS.b), 0, 8),
      fmax: clamp(finite(Number(a.fmax), DEFAULTS.fmax), 1, 50),
      // Only the documented classroom sample periods are supported.
      dt: SAMPLE_PERIODS.includes(Number(a.dt)) ? Number(a.dt) : DT
    };
  }
  function initial(mode) {
    if (mode === 'circle') return { t: 0, x: -2.8, y: -2.0, vx: 0, vy: 0, fx: 0, fy: 0 };
    return { t: 0, x: -3.2, y: -2.0, vx: 0, vy: 0, fx: 0, fy: 0 };
  }
  function targetAt(t, mode, manualTarget) {
    if (mode === 'circle') {
      const w = 0.45;
      return { x: 2.4 * Math.cos(w*t), y: 1.8 * Math.sin(w*t),
        vx: -2.4*w*Math.sin(w*t), vy: 1.8*w*Math.cos(w*t),
        ax: -2.4*w*w*Math.cos(w*t), ay: -1.8*w*w*Math.sin(w*t) };
    }
    if (mode === 'switch') {
      return t < 8 ? { x: 2.5, y: 1.6, vx: 0, vy: 0, ax: 0, ay: 0 }
        : { x: -2.5, y: 1.3, vx: 0, vy: 0, ax: 0, ay: 0 };
    }
    if (manualTarget && Number.isFinite(manualTarget.x) && Number.isFinite(manualTarget.y)) {
      return { x: clamp(manualTarget.x, -5.5, 5.5), y: clamp(manualTarget.y, -5.5, 5.5),
        vx: 0, vy: 0, ax: 0, ay: 0 };
    }
    return { x: 2.5, y: 1.6, vx: 0, vy: 0, ax: 0, ay: 0 };
  }
  function disturbanceAt(t, mode) {
    return mode === 'wind' && t >= 7 ? { fx: 2.4, fy: -1.4 } : { fx: 0, fy: 0 };
  }
  function step(state, requested, params, mode, manualTarget) {
    const cfg = params;
    let fx = clamp(finite(requested.fx, 0), -cfg.fmax, cfg.fmax);
    let fy = clamp(finite(requested.fy, 0), -cfg.fmax, cfg.fmax);
    const d = disturbanceAt(state.t, mode);
    const ax = (fx - cfg.b * state.vx + d.fx) / cfg.m;
    const ay = (fy - cfg.b * state.vy + d.fy) / cfg.m;
    // Semi-implicit Euler: velocity updated before position.
    const vx = state.vx + ax * cfg.dt;
    const vy = state.vy + ay * cfg.dt;
    const t = state.t + cfg.dt;
    const next = { t, x: state.x + vx * cfg.dt, y: state.y + vy * cfg.dt,
      vx, vy, fx, fy };
    const target = targetAt(t, mode, manualTarget);
    return { state: next, target, disturbance: d,
      error: Math.hypot(target.x - next.x, target.y - next.y),
      effort: Math.hypot(fx, fy) };
  }
  return { DT, SAMPLE_PERIODS, DURATION, DEFAULTS, MODES, clamp, finite,
    sanitizeConfig, initial, targetAt, disturbanceAt, step };
});
