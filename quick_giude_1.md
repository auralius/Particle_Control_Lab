# Quick Guide: Using `memory` in Particle Control Lab

## 1. What is `memory`?

`memory` is a JavaScript object that stores values between controller executions.

The simulator automatically calls `controller()` every sampling period \(T_s\), but **students are responsible for initializing and updating their own memory variables**.

## 2. Understanding `undefined`

In JavaScript, a variable or object property that has not been assigned a value can be `undefined`.

```javascript
// Initially, memory is empty: {}

memory.data1;  // undefined
memory.data2;  // undefined
```

**Important:** `undefined` is not the same as zero!

For example:

```javascript
memory.data1 += 1;
```

If `data1` was never initialized, the result becomes `NaN` (Not a Number).

## 3. Initializing memory

**Method A — Explicit initialization**

```javascript
if (memory.data1 === undefined) {
  memory.data1 = 0;
}
```

**Method B — Shorter JavaScript syntax (recommended)**

```javascript
memory.data1 ??= 0;
memory.data2 ??= 0;
```

The `??=` operator assigns a default value only if the current value is `undefined` or `null`.

You can initialize other data types too:

```javascript
memory.counter ??= 0;
memory.previousError ??= 0;
memory.history ??= [];
memory.model ??= { x: 0, v: 0 };
```

## 4. Example: Integral controller

```javascript
function controller() {
  // Initialize once
  memory.integralX ??= 0;

  // Calculate error
  const ex = state.target.x - state.x;

  // Update integral state
  memory.integralX += ex * params.dt;

  // PI control
  const Kp = 10;
  const Ki = 2;

  const fx = Kp * ex + Ki * memory.integralX;

  return { fx, fy: 0 };
}
```

Notice that `memory.integralX` is preserved between sampling instants.

## 5. Who updates what?

| Object | Updated by |
|---|---|
| `state` | Simulator automatically |
| `params` | Experiment configuration |
| `memory` | Student's controller code |

The simulator preserves the `memory` object between controller calls but does not automatically initialize arbitrary properties or update their values.

When a new simulation is reset, controller memory starts fresh.

## 6. Common mistakes

**Incorrect:**

```javascript
memory.counter += 1; // May become NaN
```

**Correct:**

```javascript
memory.counter ??= 0;
memory.counter += 1;
```

**Another mistake:**

```javascript
function controller() {
  memory.integral = 0; // Resets every call!
}
```

**Correct:**

```javascript
function controller() {
  memory.integral ??= 0; // Initializes only when needed
}
```

**Remember:** Initialize once, update every sampling period, and let the simulator preserve the result.
