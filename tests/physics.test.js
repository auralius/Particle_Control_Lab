const assert = require('node:assert/strict');
const test = require('node:test');
const P = require('../physics.js');
test('zero input, zero damping => rest remains at rest', () => {
  let s = P.initial('step');
  for (let i=0;i<500;i++) s=P.step(s,{fx:0,fy:0},P.sanitizeConfig({m:1,b:0,fmax:10}),'step').state;
  assert(Math.abs(s.x+3.2)<1e-10 && Math.abs(s.y+2)<1e-10);
  assert.equal(s.vx,0);
});
test('force obeys acceleration m a = f - b v', () => {
  const cfg=P.sanitizeConfig({m:2,b:0,fmax:50});
  let s=P.initial('step');
  s=P.step(s,{fx:4,fy:-2},cfg,'step').state;
  assert(Math.abs(s.vx-0.04)<1e-10);
  assert(Math.abs(s.vy+0.02)<1e-10);
  assert(Math.abs(s.x-(-3.2+0.04*0.02))<1e-10);
});
test('actuator limit clips x and y independently', () => {
  let s=P.step(P.initial('step'),{fx:999,fy:-999},P.sanitizeConfig({m:1,b:0,fmax:5}),'step').state;
  assert.equal(s.fx,5); assert.equal(s.fy,-5);
});
test('drag resists initial velocity',()=>{
  let s={...P.initial('step'),vx:4};
  s=P.step(s,{fx:0,fy:0},P.sanitizeConfig({m:1,b:2,fmax:10}),'step').state;
  assert(s.vx<4 && s.vx>0);
});
test('disturbance starts at t >= 7 for wind challenge',()=>{
  assert.equal(P.disturbanceAt(6.98,'wind').fx,0);
  assert.equal(P.disturbanceAt(7,'wind').fx,2.4);
});
test('moving target has consistent x velocity',()=>{
  const t=2,h=1e-4;
  const a=P.targetAt(t,'circle'),b=P.targetAt(t+h,'circle');
  assert(Math.abs((b.x-a.x)/h-a.vx)<0.001);
});

test('sampling period defaults to 20 ms but accepts all classroom options', () => {
  assert.equal(P.sanitizeConfig({}).dt, 0.02);
  for(const dt of [0.005,0.01,0.02,0.05,0.1]) {
    assert.equal(P.sanitizeConfig({dt}).dt, dt);
  }
  assert.equal(P.sanitizeConfig({dt:123}).dt,0.02);
  assert.equal(P.sanitizeConfig({dt:0}).dt,0.02);
});
test('different sample periods change semi-implicit Euler plant states', () => {
  const s = P.initial('step');
  const small = P.step(s,{fx:1,fy:0},P.sanitizeConfig({m:1,b:0,dt:.01}),'step').state;
  const large = P.step(s,{fx:1,fy:0},P.sanitizeConfig({m:1,b:0,dt:.1}),'step').state;
  assert(Math.abs(small.vx - .01) < 1e-12);
  assert(Math.abs(large.vx - .1) < 1e-12);
  assert(Math.abs(small.x - (s.x + .0001)) < 1e-12);
  assert(Math.abs(large.x - (s.x + .01)) < 1e-12);
});
test('semi-implicit Euler agrees with the documented discrete state update', () => {
  const cfg=P.sanitizeConfig({m:2,b:0.5,fmax:10});
  const before={...P.initial('step'), vx:1.2, vy:-0.8};
  const output=P.step(before,{fx:4,fy:-2},cfg,'step').state;
  const h=cfg.dt, c=1-cfg.b*h/cfg.m;
  const x1=before.x + h*c*before.vx+(h*h/cfg.m)*4;
  const v1=c*before.vx + (h/cfg.m)*4;
  const y1=before.y + h*c*before.vy+(h*h/cfg.m)*(-2);
  const vy1=c*before.vy + (h/cfg.m)*(-2);
  assert(Math.abs(output.x-x1)<1e-12);
  assert(Math.abs(output.vx-v1)<1e-12);
  assert(Math.abs(output.y-y1)<1e-12);
  assert(Math.abs(output.vy-vy1)<1e-12);
});
