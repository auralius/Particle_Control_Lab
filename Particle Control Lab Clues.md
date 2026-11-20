# Particle Control Lab — P, I, and D Controller Clues

**Barefoot Undergraduate Students · Student worksheet**

## Your mission

Implement three separate JavaScript functions—**P()**, **I()**, and **D()**—and combine their outputs in **controller()**. The simulator handles the particle dynamics and calls your controller automatically every sampling period. **You write the control algorithm, not the particle integration.**

**Do not expect ready-made solutions here.** The clues and equations below tell you *what* to implement without giving you the JavaScript implementation.

## First, know your tools

| Object | Available information | What you can do |
|---|---|---|
| `state` | Particle position `x`, `y`; velocity `vx`, `vy`; target position `target.x`, `target.y`; and other reference information | Read the current simulated state |
| `params` | Mass `m`, damping `b`, force limit `fmax`, and sampling period **`dt`** (seconds) | Read experiment parameters |
| `memory` | Any student-defined properties, such as `previousErrorX` or `integralY` | Initialize, read, and update persistent controller values |

The names `state`, `params`, and `memory` are globally accessible to your helper functions in Particle Control Lab v1.5.1 and later. Each function may use them without receiving them as arguments.

**Important:** An uninitialized `memory` property has the value **`undefined`**, **not** zero. Check whether it is undefined before using it in arithmetic. Students are responsible for initializing and updating memory. The simulator preserves it between control steps and clears it when controller memory is reset.

## Clue 1 — Proportional term, P()

**Question:** How far is the particle from the target?

1. Compute the **position error** on each axis: target position minus actual position.
2. Choose a proportional gain, \(K_p\).
3. Multiply the error on each axis by that gain.
4. Have `P()` return the two force components, named **`fx`** and **`fy`**.

Mathematically:

$$ 
e_x[k]=r_x[k]-x[k], \qquad e_y[k]=r_y[k]-y[k] 
$$

$$
F_{P,x}[k]=K_p e_x[k], \qquad F_{P,y}[k]=K_p e_y[k]
$$

**Think about:** What happens if you double \(K_p\)? Can a P-only controller oscillate even when the target is stationary?

## Clue 2 — Derivative term, D()

**Question:** How quickly is the *position error* changing?

For this exercise, compute the **classical derivative of error**, rather than using the particle velocity directly.

1. Calculate the current position error for both axes, just as you did in `P()`.
2. Retrieve the *previous* errors from `memory`.
3. **First-call clue:** If previous error is `undefined`, initialize it to the **current error**. Why does this make the first derivative zero?
4. Approximate the derivative using a **backward difference** and the current sampling period **`params.dt`**.
5. Multiply each derivative by \(K_d\).
6. **After** calculating the derivatives, save the current errors in `memory` for the next call.
7. Return the derivative force components as `fx` and `fy`.

Mathematically:

$$
\dot e_x[k]\approx\frac{e_x[k]-e_x[k-1]}{T_s},\qquad
\dot e_y[k]\approx\frac{e_y[k]-e_y[k-1]}{T_s}
$$

$$
F_{D,x}[k]=K_d\dot e_x[k],\qquad F_{D,y}[k]=K_d\dot e_y[k]
$$

where \(T_s=\texttt{params.dt}\).

**Think about:** Why must the previous error be saved **after**, not before, calculating the difference? What happens to the derivative term if the target jumps suddenly (*derivative kick*)?

## Clue 3 — Integral term, I()

**Question:** How much position error has accumulated over time?

1. Calculate the current position errors.
2. Reserve **two persistent accumulators** in `memory`: one for the x-axis and one for the y-axis.
3. **First-call clue:** When an accumulator is `undefined`, initialize it to **zero**.
4. At each call, add **current error × `params.dt`** to each accumulator.
5. Multiply the accumulated errors by an integral gain, \(K_i\).
6. Return the integral force components as `fx` and `fy`.

Using rectangular integration:

$$
S_x[k]=S_x[k-1]+e_x[k]T_s,\qquad
S_y[k]=S_y[k-1]+e_y[k]T_s
$$

$$
F_{I,x}[k]=K_iS_x[k],\qquad F_{I,y}[k]=K_iS_y[k]
$$

**Think about:** Why does the integral term require `memory`? What happens if you set the accumulated error back to zero every time `I()` is called? What might happen if the requested force exceeds `params.fmax` for a long time (*integral windup*)?

## Clue 4 — Combine them in controller()

1. Call `P()`, `I()`, and `D()` once per sampling step.
2. Store their returned objects in **three differently named variables**. Do **not** give a local variable the same name as its function.
3. Retrieve each object's `.fx` and `.fy` components.
4. Add the three x-forces together and the three y-forces together.
5. Return a single object containing the final **`fx`** and **`fy`**. The simulator applies its force limits and advances the plant automatically.

The desired control law is:

$$
F_x[k]=F_{P,x}[k]+F_{I,x}[k]+F_{D,x}[k]
$$

$$
F_y[k]=F_{P,y}[k]+F_{I,y}[k]+F_{D,y}[k]
$$

**Think about:** To test P, PI, and PD independently, which function outputs would you include in the final force sum?

## Debugging checklist

- [ ] Does every custom function return an object with **both** `fx` and `fy`?
- [ ] Are `state` and `params` only **read**, not manually stepped or modified?
- [ ] Are all student-defined `memory` properties checked for `undefined` before arithmetic?
- [ ] Are the integral accumulators initialized **once**, rather than reset each call?
- [ ] Are the previous errors updated **after** the derivative is calculated?
- [ ] Does the derivative and integral use **`params.dt`** rather than a hardcoded `0.02`?
- [ ] Are the P, I, and D forces combined into the final controller return object?
- [ ] Have you checked behavior with different sampling periods and force limits?

## Suggested experiments

1. **P only:** Vary \(K_p\). Observe overshoot and oscillation.
2. **PD:** Keep \(K_p\) fixed and vary \(K_d\). Observe damping and settling.
3. **PI:** Add integral action. Try the disturbance-rejection challenge.
4. **PID:** Combine all three terms. Compare settling, overshoot, and disturbance rejection.
5. **Sampling period:** Test \(T_s = 0.01\), \(0.02\), and \(0.05\) s. Keep gains fixed; compare the responses.
6. **Optional challenge:** Devise a way to prevent integral windup during force saturation.

**Deliverables:** Your own JavaScript controller implementation, a screenshot or exported CSV of one or more responses, and a short explanation of how your gains and sampling period affect performance.

---

*Guiding principle: Read `state` and `params`, explicitly update `memory`, and return `{fx, fy}`. The simulator does the rest.*
