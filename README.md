# Particle Control Lab (v1.6)

This is the **student-facing edition** of the Particle Control Lab. The editor opens with a simple **P controller** (`Kp = 10`) that students can modify. No PD or PID presets are included. All other simulator functions remain available.

## Start locally (Ubuntu / Linux)

From this folder:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. Do **not** open `index.html` using `file://`, because Web Workers may be blocked by the browser. Stop the server using Ctrl+C.

If you have tested the instructor edition on `localhost:8000`, the student edition uses a different browser localStorage key. It won't load your previous instructor controller. **v1.6 uses a fresh student storage key** to show the new `init()` / `controller()` starter, while leaving code saved by older versions untouched. To reset your current student code, select **Reset editor to starter**. If cached files are shown, use **Ctrl+Shift+R**.

## The plant

The top-down 2D particle obeys

```text
m*x_ddot + b*x_dot = fx + disturbance_x
m*y_ddot + b*y_dot = fy + disturbance_y
```

The simulator calls `controller()` **automatically at each sample** and integrates the plant for you. You return `{ fx, fy }` in newtons. Do not assign particle positions or velocities directly.

**New in v1.5:** `state`, `params`, and `memory` are **script-level bindings visible in all student-defined functions** (not just `controller`). The simulator refreshes their references before each controller call. You do **not** declare them, pass them to helpers, or manually step the controller. For compatibility, the old `controller(state, params, memory)` function signature continues to work.

## Default editor code (v1.6)

```js
// Called once on loading a new experiment or resetting.
function init() {
  memory.integralX = 0;
  memory.integralY = 0;
}

// Custom helper function.
function P() {
  const Kp = 10.0;
  const ex = state.target.x - state.x;
  const ey = state.target.y - state.y;
  return { fx: Kp * ex, fy: Kp * ey };
}

// Called every params.dt seconds of simulation time.
function controller() {
  const p = P();
  return { fx: p.fx, fy: p.fy };
}
```

The proportional controller is a working example. The integral variables are initialized in `init()` but not used by `P()`: students can use them later when implementing an integral controller. Custom helpers can be named freely and invoked from either callback.

## Standard callbacks and lifecycle (new in v1.6)

| Callback | Required? | Frequency | Responsibility |
| --- | --- | --- | --- |
| `init()` | No | Once for each fresh experiment | Initialize `memory` and any other controller-owned values |
| `controller()` | **Yes** | Once per `params.dt` simulation step | Update internal controller state, compute force, return `{ fx, fy }` |
| `P()`, `I()`, `D()`, other helpers | No | Whenever student code calls them | Organize custom control algorithms |

The simulator provides global `state`, `params`, and `memory` to **both callbacks and every custom helper function**. For compatibility, `controller(state, params, memory)` still works; `init(state, params, memory)` also accepts those optional arguments.

**When does `init()` run?**

- On first controller load, or **Apply & reset**.
- After **Reset**, a sampling-period change, scenario/plant parameter change, or restart of a completed experiment.
- **Independently once for each of the four automated challenge scenarios** (using its initial state and reference).
- **Not** during pause/resume, and **not** every time you press Step. Step only calls `controller()` once for the selected sample period.

At initialization, the simulator sets the plant to its starting state and gives student code a new empty `memory = {}`. It calls `init()` **before** the first `controller()` call. The student updates `memory` explicitly; the simulator never populates arbitrary student variables automatically. Every reset also creates a fresh controller script scope, so custom top-level counters do not carry over between independent runs.

For example, an integral state belongs in `init()` rather than being reset inside the periodic controller:

```js
function init() {
  memory.sum = 0;
}
function controller() {
  const error = state.target.x - state.x;
  memory.sum += error * params.dt;
  return { fx: 0, fy: 0 }; // replace zero with your own control law
}
```

You can still omit `init()` and use `if (memory.sum === undefined) { memory.sum = 0; }` inside your controller. This maintains compatibility with earlier student code.

## Controller API

**Start with the always-visible “Controller API reference” beneath the editor.** It lists all `state` fields (and units), `params.m`, `params.b`, `params.fmax`, the selected `params.dt`, and `memory` persistence/reset behavior. The editor toolbar has an **API reference ↓** jump link, so this table is easy to find on smaller screens. It also explains the required `{ fx, fy }` return value. The full field reference remains available, and v1.6 additionally documents both standard callbacks.


### Custom helpers with globally accessible context

```js
// state, params and memory are already available in all functions.
function modelAcceleration(force) {
  return (force - params.b * state.vx) / params.m;
}

function rememberPrediction(acceleration) {
  memory.lastPredictedAcceleration = acceleration;
}

function controller() {
  const predictedAcceleration = modelAcceleration(0);
  rememberPrediction(predictedAcceleration); // student-managed memory
  // TODO: design a control law that calculates fx and fy.
  return { fx: 0, fy: 0 };
}
```

There is no need to call `controller()` or advance the simulator yourself. The worker calls optional `init()` once on a fresh experiment, then calls `controller()` once per `params.dt`, applies its returned force and updates the **physical state** automatically. `memory` persists between calls but the simulator never updates its properties for you: use it to store previous errors, integral terms, observer estimates, optimization warm starts, etc. All custom helper functions share the same current context. Each challenge starts with fresh memory.

The three names `state`, `params`, and `memory` are **reserved at the top level** of your student code. Do not write `let state`, `const params`, etc. You can still use these names as arguments in the legacy `controller(state, params, memory)`, where they shadow the bindings inside that function. The simulator provides snapshots of state and parameters; changing their properties does not change the physical plant or experiment settings.


### Read-only state (position in m; velocity in m/s)

```js
state.x, state.y             // position
state.vx, state.vy           // velocity
state.t                      // current simulation time, s
state.target.x, state.target.y      // reference position
state.target.vx, state.target.vy    // reference velocity
state.target.ax, state.target.ay    // reference acceleration
```

### Plant parameters

```js
params.m     // mass, kg
params.b     // damping, N*s/m
params.dt    // selected controller sampling period, seconds (default 0.020 s = 50 Hz)
params.fmax  // allowed absolute force per axis, N
```

### Memory persists across controller calls

`memory` starts as `{}` and is cleared whenever the experiment resets. `init()` can initialize its properties, but **students must explicitly update it**. For example:

```js
memory.calls = (memory.calls || 0) + 1;
```

### Return control force (N)

```js
return { fx: 10 * (state.target.x - state.x), fy: 10 * (state.target.y - state.y) }; // default P example
```

The default P controller uses gain 10; replace that law when trying other controllers. Forces are saturated independently to `[-params.fmax, +params.fmax]` by the simulator.

## How the particle is discretized (as implemented)

The continuous-time equations on each axis are:

```text
m * x_ddot + b * x_dot = fx + disturbance_x
m * y_ddot + b * y_dot = fy + disturbance_y
```

One controller call is made at each **selected** sample interval `h = params.dt` (default `0.020 s`, or 50 Hz). Choose 5, 10, 20, 50 or 100 ms in **Experiment setup → Sampling period**. Each selection resets the particle and `memory`. Its requested force is clipped to `[-fmax, +fmax]` on each axis. The **semi-implicit Euler** numerical integrator in `physics.js` then computes:

```js
// Use velocity at sample k when evaluating the drag and acceleration.
ax = (fx - b * vx + disturbanceX) / m;
ay = (fy - b * vy + disturbanceY) / m;

// Update velocity FIRST.
vxNext = vx + ax * dt;
vyNext = vy + ay * dt;

// Update position using the NEW velocity.
xNext = x + vxNext * dt;
yNext = y + vyNext * dt;
tNext = t + dt;
```

Written as a discrete-time state-space model for **one axis**, with `u` the saturated force plus disturbance, `h = dt`, `c = 1 - b*h/m`:

```text
[ x[k+1] ]   [ 1   h*c ] [ x[k] ]   [ h*h/m ]
[ v[k+1] ] = [ 0    c  ] [ v[k] ] + [  h/m  ] * u[k]
```

This is a **numerical approximation**, not the exact zero-order-hold discretization. At higher playback speeds (2×/4×), the selected `dt` is unchanged; only the wall-clock playback rate changes. The worker uses a 20 ms wall-clock scheduling heartbeat with a simulation-time accumulator, so the step size is not tied to this heartbeat. Students should use `params.dt` for any accumulators, discrete-time differences, or observers instead of hard-coding `0.02`.

## Sampling period experiment

- Choose `T_s = 0.020 s` to reproduce the original classroom baseline.
- Try `T_s = 0.005 s`, `0.050 s`, and `0.100 s` with the **same gains** and compare response trajectories, tracking error, and stability.
- **Step** advances exactly one selected physics sample; **Run** targets real-time progression (subject to browser timer throttling), and the separate **SPEED** control changes wall-clock playback only.
- The plant uses semi-implicit Euler, not exact ZOH; discrete-time numerical errors and digital-controller behavior can change with sampling period.

## Lab sequence

1. **Setpoint:** implement a controller to reach a stationary target.
2. **Setpoint reversal:** control the response to a target change at 8 s.
3. **Moving target:** follow the elliptical reference.
4. **Disturbance rejection:** test what happens when an unknown force appears at 7 s.

Click **Run simulation**, **Step +[selected Ts]**, or **Run 4 tests**. Use **Save .js** to submit your code and **Export CSV** to analyze tracking error, overshoot, and settling. The editor autosaves to the current browser only; it does not submit code to GitHub.

You can share an instructor-defined experiment by adding URL parameters, e.g. `?task=wind&m=2&b=0.5&fmax=10&dt=0.05`.

## Publish on GitHub Pages

Upload this folder's contents to a GitHub repository, then enable **Settings → Pages → Deploy from a branch → main / (root)**.

## Notes

- This is a browser playground, not a hardened sandbox for running untrusted scripts. Use trusted classroom code.
- All physics and controller execution run locally in a Web Worker.
- No npm dependencies or build required.
- MIT license (see LICENSE).
