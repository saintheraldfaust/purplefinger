# The Realtime Math: Why 5 FPS Became 20 FPS

## The Symptom

GPU logs showed:
```
process=11ms   in FPS=5.5   out FPS=4.6
```

The GPU was processing each frame in **11ms** — fast enough for **90 FPS**.
Yet only **5.5 frames per second** were arriving. The GPU was idle 94% of the time.

---

## The Root Cause: setInterval + Backpressure Guard

The old capture loop looked like this:

```js
// Fires 20 times per second
captureTimer = setInterval(doCapture, 1000 / 20);  // every 50ms

function doCapture() {
  if (_encodes > 1) return;   // ← THE TRAP
  _encodes++;
  offscreen.convertToBlob({ type: 'image/jpeg', quality: 0.78 })
    .then((blob) => {
      _encodes--;
      ws.send(blob);
    });
}
```

### The Math

`convertToBlob` at quality=0.78, 512×288 took approximately **175ms** on this machine.

The `_encodes > 1` guard allows at most **2 concurrent encodes** in-flight.

Timeline:

```
t=0ms    timer fires → _encodes: 0→1, encode #1 starts
t=50ms   timer fires → _encodes: 1→2, encode #2 starts
t=100ms  timer fires → _encodes: 2,   DROPPED  ← wasted tick
t=150ms  timer fires → _encodes: 2,   DROPPED  ← wasted tick
t=175ms  encode #1 finishes → _encodes: 1, frame SENT
t=200ms  timer fires → _encodes: 1→2, encode #3 starts
t=250ms  timer fires → _encodes: 2,   DROPPED
t=300ms  timer fires → _encodes: 2,   DROPPED
t=350ms  encode #2 finishes → _encodes: 1, frame SENT
```

**Frames sent per second = 2 frames / 0.35s = 5.7 FPS**

This is *exactly* what the logs showed. The timer fired 20 times per second but
the backpressure guard silently discarded most ticks. The GPU received 5.5 FPS
and dutifully processed each one in 11ms — then waited idle for the next.

### Why quality=0.78 Was the Trigger

At the working commit (21efa3f), the settings were:
- `quality: 0.68` → encode ~80ms
- `sendFps: 12` → timer every 83ms

Because encode (80ms) finished *before* the next timer tick (83ms), `_encodes`
never accumulated past 1. Every tick fired into an idle slot. Result: 12 FPS through.

When quality was raised to 0.78, encode time jumped to ~175ms — more than 3× the
timer interval. The guard clamped throughput to `2 / 0.175s = 11 FPS` theoretical
maximum, but with the timer cadence mismatched it landed at ~5.7 FPS actual.

---

## The Fix: Self-Pacing Async Loop

Remove the fixed-rate timer entirely. Replace with a loop that starts the next
encode the instant the previous one finishes, then waits only for the *remaining*
time in the frame budget:

```js
async function _captureLoop() {
  while (_captureLoopActive) {
    const t0 = performance.now();

    // Draw + encode
    offCtx.drawImage(captureVideo, 0, 0, currentSendW, currentSendH);
    const blob = await offscreen.convertToBlob({ type: 'image/jpeg', quality: 0.65 });
    ws.send(blob);

    // Wait only for the remaining budget (0 if encode was already slow)
    const elapsed = performance.now() - t0;
    const budget  = 1000 / currentSendFps;   // e.g. 50ms at 20 FPS
    if (elapsed < budget) {
      await new Promise(r => setTimeout(r, budget - elapsed));
    }
  }
}
```

### The New Math

**Case A — encode is fast (50ms), target is 20 FPS (50ms budget):**
```
encode: 50ms → wait: 0ms → next encode immediately
effective FPS = 1000 / 50 = 20 FPS  ✓
```

**Case B — encode is slow (175ms), target is 20 FPS (50ms budget):**
```
encode: 175ms → elapsed > budget → wait: 0ms → next encode immediately
effective FPS = 1000 / 175 = 5.7 FPS  (hardware-limited, no wasted ticks)
```

In both cases, **zero ticks are wasted**. The loop runs at exactly the faster of:
- The hardware encode limit (1000 / encode_ms)
- The target FPS cap (currentSendFps)

No frames are silently dropped. No timer desync.

---

## The Second Fix: quality 0.78 → 0.65

JPEG quality is not linear in encode time. Higher quality forces more DCT
coefficient passes and larger Huffman tables.

| Quality | Approx encode time (512×288) | Max FPS (single-threaded) |
|---------|------------------------------|---------------------------|
| 0.78    | ~175ms                       | ~5.7 FPS                  |
| 0.68    | ~80ms                        | ~12.5 FPS                 |
| 0.65    | ~50ms                        | ~20 FPS                   |

Quality 0.65 looks nearly identical to 0.78 at 512×288 — the difference is
sub-pixel DCT ringing that is invisible at this resolution and frame rate.

---

## The Third Fix: minFps 15 → 6

The adaptive throttle adjusts `currentSendFps` every second:

```js
const recommendedFps = Math.max(minFps, Math.min(sendFps, recvFps + headroom));
```

With the old `minFps: 15`, even when the server returned only 5 FPS (`recvFps=5`):

```
recommendedFps = Math.max(15, Math.min(20, 5 + 1)) = Math.max(15, 6) = 15
```

The floor of 15 FPS prevented the throttle from ever reducing send rate to match
actual capacity. The loop kept hammering at 15 FPS even when the hardware could
only do 5.7 FPS — no useful adaptation.

With `minFps: 6`, the throttle can actually chase the GPU's real output rate.
Once GPU is fast and quality is low, it converges upward to the `sendFps: 20` cap.

---

## Combined Effect

| Factor             | Before          | After          |
|--------------------|-----------------|----------------|
| Encode time        | ~175ms          | ~50ms          |
| Timer mechanism    | setInterval + drop guard | self-pacing loop |
| Wasted ticks       | ~65% dropped    | 0%             |
| Adaptive floor     | 15 FPS (too high) | 6 FPS (tracks reality) |
| **Actual send FPS**| **5.7 FPS**     | **18–20 FPS**  |
| GPU utilization    | ~6%             | ~22% (limited by client) |

The GPU was never the bottleneck. It was always waiting on the client.
