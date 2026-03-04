---
title: 'How Kubernetes HPA Decides Your Replica Count'
description: 'A deep dive into the four-stage pipeline the Horizontal Pod Autoscaler runs every 15 seconds: formula, stabilization, rate limiting, and clamping.'
pubDate: 'Mar 04 2026'
heroImage: '../../../../assets/2026/03/how-hpa-decides-replica-count-hero.jpg'
---

The Horizontal Pod Autoscaler (HPA) automatically adjusts the number of pod replicas in a deployment based on observed metrics. Every **sync period** (default: 15 seconds), it runs a four-stage pipeline to decide whether to scale up, scale down, or do nothing.

<div style="background: #0f1117; border-radius: 12px; padding: 1.5rem 1rem; margin: 2rem 0;">
<svg viewBox="0 0 800 90" style="width:100%;height:auto;" aria-label="HPA 4-stage pipeline overview">
<rect x="10" y="15" width="160" height="60" rx="12" fill="#fbbf24" fill-opacity="0.12" stroke="#fbbf24" stroke-width="1.5"/>
<text x="90" y="38" text-anchor="middle" fill="#fbbf24" font-size="11" font-weight="600" font-family="monospace">Stage 1</text>
<text x="90" y="56" text-anchor="middle" fill="#fbbf24" font-size="13" font-weight="700" font-family="monospace">Formula</text>
<text x="90" y="70" text-anchor="middle" fill="#fbbf24" font-size="9" opacity="0.7" font-family="monospace">Propose</text>
<line x1="175" y1="45" x2="205" y2="45" stroke="#52525b" stroke-width="1.5"/>
<polygon points="205,41 213,45 205,49" fill="#52525b"/>
<rect x="218" y="15" width="160" height="60" rx="12" fill="#c084fc" fill-opacity="0.12" stroke="#c084fc" stroke-width="1.5"/>
<text x="298" y="38" text-anchor="middle" fill="#c084fc" font-size="11" font-weight="600" font-family="monospace">Stage 2</text>
<text x="298" y="56" text-anchor="middle" fill="#c084fc" font-size="13" font-weight="700" font-family="monospace">Stabilization</text>
<text x="298" y="70" text-anchor="middle" fill="#c084fc" font-size="9" opacity="0.7" font-family="monospace">Smooth</text>
<line x1="383" y1="45" x2="413" y2="45" stroke="#52525b" stroke-width="1.5"/>
<polygon points="413,41 421,45 413,49" fill="#52525b"/>
<rect x="426" y="15" width="160" height="60" rx="12" fill="#fb7185" fill-opacity="0.12" stroke="#fb7185" stroke-width="1.5"/>
<text x="506" y="38" text-anchor="middle" fill="#fb7185" font-size="11" font-weight="600" font-family="monospace">Stage 3</text>
<text x="506" y="56" text-anchor="middle" fill="#fb7185" font-size="13" font-weight="700" font-family="monospace">Rate Limit</text>
<text x="506" y="70" text-anchor="middle" fill="#fb7185" font-size="9" opacity="0.7" font-family="monospace">Pace</text>
<line x1="591" y1="45" x2="621" y2="45" stroke="#52525b" stroke-width="1.5"/>
<polygon points="621,41 629,45 621,49" fill="#52525b"/>
<rect x="634" y="15" width="150" height="60" rx="12" fill="#34d399" fill-opacity="0.12" stroke="#34d399" stroke-width="1.5"/>
<text x="709" y="38" text-anchor="middle" fill="#34d399" font-size="11" font-weight="600" font-family="monospace">Stage 4</text>
<text x="709" y="56" text-anchor="middle" fill="#34d399" font-size="13" font-weight="700" font-family="monospace">Clamp</text>
<text x="709" y="70" text-anchor="middle" fill="#34d399" font-size="9" opacity="0.7" font-family="monospace">Bound</text>
</svg>
</div>

This article walks through each stage, building the full picture incrementally.

---

## Stage 1: The Formula — Metric Ratio × Current Pods

The HPA watches a metric you define — CPU utilization, request rate, custom metrics — and you tell it a **target** value. This target is your 100% baseline.

**Example:** You want each pod to use about 2 vCPU, so you set target = 2 vCPU.

Every sync period, the HPA reads the current metric value, computes the **ratio** (`currentValue / targetValue`), and multiplies current replicas by that ratio:

```
desiredReplicas = ceil(currentReplicas × currentValue / targetValue)
```

**Concrete example:** You have 12 pods, target is 2 vCPU, current CPU is 2.5 vCPU.

```
ratio = 2.5 / 2.0 = 1.25  (25% over target)
desired = ceil(12 × 1.25) = ceil(15) = 15 pods
```

The metric is 25% over target, so we need 25% more pods. This works for scale-down too: if CPU drops to 1.5 vCPU, ratio = 0.75, desired = ceil(12 × 0.75) = 9 pods.

<div style="background: #0f1117; border-radius: 12px; padding: 1.5rem 1rem; margin: 2rem 0;">
<svg viewBox="0 0 800 320" style="width:100%;height:auto;" aria-label="Formula ratio diagram">
<text x="30" y="30" fill="#a1a1aa" font-size="12" font-weight="500" font-family="monospace">Metric Ratio</text>
<text x="30" y="62" fill="#71717a" font-size="10" font-family="monospace">currentValue</text>
<rect x="140" y="48" width="250" height="28" rx="6" fill="#fbbf24" fill-opacity="0.2" stroke="#fbbf24" stroke-width="1"/>
<text x="265" y="67" text-anchor="middle" fill="#fbbf24" font-size="13" font-weight="600" font-family="monospace">2.5 vCPU</text>
<text x="30" y="108" fill="#71717a" font-size="10" font-family="monospace">targetValue</text>
<rect x="140" y="94" width="200" height="28" rx="6" fill="none" stroke="#60a5fa" stroke-width="1.5" stroke-dasharray="6 3"/>
<text x="240" y="113" text-anchor="middle" fill="#60a5fa" font-size="13" font-weight="600" font-family="monospace">2.0 vCPU</text>
<line x1="420" y1="62" x2="420" y2="108" stroke="#52525b" stroke-width="1" stroke-dasharray="3 2"/>
<text x="440" y="75" fill="#fbbf24" font-size="12" font-weight="500" font-family="monospace">2.5 / 2.0 = </text>
<text x="560" y="75" fill="#fbbf24" font-size="16" font-weight="700" font-family="monospace">1.25</text>
<text x="440" y="100" fill="#71717a" font-size="11" font-family="monospace">25% over target → need 25% more pods</text>
<text x="440" y="128" fill="#fbbf24" font-size="11" font-weight="500" font-family="monospace">ceil(12 × 1.25) = 15 pods</text>
<text x="30" y="185" fill="#a1a1aa" font-size="12" font-weight="500" font-family="monospace">±10% Tolerance Band</text>
<line x1="60" y1="220" x2="740" y2="220" stroke="#3f3f46" stroke-width="1.5"/>
<line x1="100" y1="215" x2="100" y2="225" stroke="#52525b" stroke-width="1"/>
<text x="100" y="242" text-anchor="middle" fill="#71717a" font-size="10" font-family="monospace">0.5</text>
<line x1="230" y1="215" x2="230" y2="225" stroke="#52525b" stroke-width="1"/>
<text x="230" y="242" text-anchor="middle" fill="#71717a" font-size="10" font-family="monospace">0.75</text>
<line x1="340" y1="212" x2="340" y2="228" stroke="#fbbf24" stroke-width="1.5" opacity="0.6"/>
<text x="340" y="252" text-anchor="middle" fill="#fbbf24" font-size="10" opacity="0.8" font-family="monospace">0.9</text>
<line x1="400" y1="210" x2="400" y2="230" stroke="#fafafa" stroke-width="2"/>
<text x="400" y="252" text-anchor="middle" fill="#fafafa" font-size="11" font-weight="600" font-family="monospace">1.0</text>
<line x1="460" y1="212" x2="460" y2="228" stroke="#fbbf24" stroke-width="1.5" opacity="0.6"/>
<text x="460" y="252" text-anchor="middle" fill="#fbbf24" font-size="10" opacity="0.8" font-family="monospace">1.1</text>
<line x1="570" y1="215" x2="570" y2="225" stroke="#52525b" stroke-width="1"/>
<text x="570" y="242" text-anchor="middle" fill="#71717a" font-size="10" font-family="monospace">1.25</text>
<line x1="700" y1="215" x2="700" y2="225" stroke="#52525b" stroke-width="1"/>
<text x="700" y="242" text-anchor="middle" fill="#71717a" font-size="10" font-family="monospace">1.5</text>
<rect x="340" y="206" width="120" height="28" rx="4" fill="#fbbf24" fill-opacity="0.08"/>
<text x="400" y="198" text-anchor="middle" fill="#fbbf24" font-size="9" opacity="0.7" font-family="monospace">no action zone</text>
<circle cx="570" cy="220" r="6" fill="#fbbf24" fill-opacity="0.3" stroke="#fbbf24" stroke-width="2"/>
<line x1="570" y1="262" x2="570" y2="272" stroke="#fbbf24" stroke-width="1"/>
<text x="570" y="286" text-anchor="middle" fill="#fbbf24" font-size="10" font-weight="600" font-family="monospace">ratio = 1.25</text>
<text x="570" y="300" text-anchor="middle" fill="#fbbf24" font-size="9" opacity="0.7" font-family="monospace">outside tolerance → scale up</text>
</svg>
</div>

### The ±10% Tolerance Band

The HPA doesn't react to tiny fluctuations. If the ratio is within **±10% of 1.0** (i.e., between 0.9 and 1.1), it does nothing. This prevents constant micro-adjustments when the metric hovers near the target.

### Multiple Metrics

If you configure multiple metrics (e.g., CPU and memory), the HPA computes desired replicas for each metric independently and takes the **maximum**. This ensures you have enough pods to satisfy the most demanding metric.

### The Feedback Loop

The formula uses *current replicas* as input, which creates a feedback loop. If the HPA scaled to 15 last sync, the formula uses 15 as its starting point next sync. This means desired replicas can overshoot — if the metric is still high but declining, the formula may compute an even higher number because it's multiplying against more replicas.

---

## Stage 2: Stabilization — "Don't Panic"

### The Problem

The raw formula output can be noisy. One sync period says 20 pods, the next says 5, the next says 18. If the HPA acted on every fluctuation immediately, replicas would bounce up and down constantly — **flapping**.

### The Solution: Look Back Before Acting

Stabilization keeps a **sliding window** of recent raw desired values (the Stage 1 outputs — the unfiltered proposals, not the results of previous stages). Before acting, it looks at the last N seconds of recommendations and picks a conservative value.

Why does it look at raw values and not filtered ones? Because if it only saw the already-smoothed output, it would have nothing to smooth. It needs to see the actual noise to filter it out.

There are **two separate windows**, one for each direction:

**Scale-down stabilization** (default: 300 seconds / 5 minutes):
- Looks at all raw desired values within the window
- Picks the **maximum** — the highest recent recommendation
- Logic: "Someone recently said we need a lot of pods. Don't rush to remove them."

**Scale-up stabilization** (default: 0 seconds — disabled):
- Looks at all raw desired values within the window
- Picks the **minimum** — the lowest recent recommendation
- Logic: "Even the most conservative recent recommendation says we need at least this many."

The current desired value is included in the window — it's pushed into the history before the window is evaluated.

<div style="background: #0f1117; border-radius: 12px; padding: 1.5rem 1rem; margin: 2rem 0;">
<svg viewBox="0 0 800 300" style="width:100%;height:auto;" aria-label="Stabilization window diagram">
<line x1="80" y1="30" x2="80" y2="240" stroke="#3f3f46" stroke-width="1"/>
<line x1="80" y1="240" x2="760" y2="240" stroke="#3f3f46" stroke-width="1"/>
<text x="70" y="234" text-anchor="end" fill="#71717a" font-size="9" font-family="monospace">4</text>
<text x="70" y="194" text-anchor="end" fill="#71717a" font-size="9" font-family="monospace">6</text>
<text x="70" y="154" text-anchor="end" fill="#71717a" font-size="9" font-family="monospace">8</text>
<text x="70" y="114" text-anchor="end" fill="#71717a" font-size="9" font-family="monospace">10</text>
<text x="70" y="74" text-anchor="end" fill="#71717a" font-size="9" font-family="monospace">12</text>
<text x="70" y="44" text-anchor="end" fill="#71717a" font-size="9" font-family="monospace">14</text>
<text x="28" y="140" fill="#71717a" font-size="9" font-family="monospace" transform="rotate(-90 28 140)">desired pods</text>
<line x1="80" y1="230" x2="760" y2="230" stroke="#27272a" stroke-width="0.5"/>
<line x1="80" y1="190" x2="760" y2="190" stroke="#27272a" stroke-width="0.5"/>
<line x1="80" y1="150" x2="760" y2="150" stroke="#27272a" stroke-width="0.5"/>
<line x1="80" y1="110" x2="760" y2="110" stroke="#27272a" stroke-width="0.5"/>
<line x1="80" y1="70" x2="760" y2="70" stroke="#27272a" stroke-width="0.5"/>
<text x="420" y="268" text-anchor="middle" fill="#71717a" font-size="10" font-family="monospace">time →</text>
<rect x="370" y="30" width="380" height="210" rx="4" fill="#c084fc" fill-opacity="0.06"/>
<line x1="370" y1="30" x2="370" y2="240" stroke="#c084fc" stroke-width="1" stroke-dasharray="4 3" opacity="0.5"/>
<text x="560" y="22" text-anchor="middle" fill="#c084fc" font-size="10" opacity="0.7" font-family="monospace">stabilization window (300s)</text>
<circle cx="120" cy="170" r="5" fill="#c084fc" opacity="0.2"/>
<circle cx="170" cy="130" r="5" fill="#c084fc" opacity="0.2"/>
<circle cx="220" cy="190" r="5" fill="#c084fc" opacity="0.2"/>
<circle cx="270" cy="150" r="5" fill="#c084fc" opacity="0.2"/>
<circle cx="320" cy="110" r="5" fill="#c084fc" opacity="0.2"/>
<circle cx="400" cy="150" r="6" fill="#c084fc" fill-opacity="0.3" stroke="#c084fc" stroke-width="1.5"/>
<text x="400" y="170" text-anchor="middle" fill="#c084fc" font-size="9" font-family="monospace">8</text>
<circle cx="460" cy="190" r="6" fill="#c084fc" fill-opacity="0.3" stroke="#c084fc" stroke-width="1.5"/>
<text x="460" y="210" text-anchor="middle" fill="#c084fc" font-size="9" font-family="monospace">6</text>
<circle cx="520" cy="70" r="6" fill="#c084fc" fill-opacity="0.3" stroke="#c084fc" stroke-width="1.5"/>
<text x="520" y="62" text-anchor="middle" fill="#c084fc" font-size="9" font-family="monospace">12</text>
<circle cx="580" cy="110" r="6" fill="#c084fc" fill-opacity="0.3" stroke="#c084fc" stroke-width="1.5"/>
<text x="580" y="100" text-anchor="middle" fill="#c084fc" font-size="9" font-family="monospace">10</text>
<circle cx="640" cy="130" r="6" fill="#c084fc" fill-opacity="0.3" stroke="#c084fc" stroke-width="1.5"/>
<text x="640" y="120" text-anchor="middle" fill="#c084fc" font-size="9" font-family="monospace">9</text>
<circle cx="700" cy="170" r="6" fill="#c084fc" fill-opacity="0.3" stroke="#c084fc" stroke-width="1.5"/>
<text x="700" y="190" text-anchor="middle" fill="#c084fc" font-size="9" font-family="monospace">7</text>
<line x1="370" y1="70" x2="750" y2="70" stroke="#c084fc" stroke-width="2"/>
<text x="755" y="65" fill="#c084fc" font-size="10" font-weight="600" font-family="monospace">max = 12</text>
<text x="755" y="78" fill="#c084fc" font-size="9" opacity="0.7" font-family="monospace">stabilized output</text>
<text x="120" y="288" fill="#52525b" font-size="9" font-family="monospace">expired (no effect)</text>
<text x="500" y="288" fill="#c084fc" font-size="9" text-anchor="middle" font-family="monospace">active window — max of all dots wins</text>
</svg>
</div>

The shaded region is the stabilization window. Dots show raw desired values from Stage 1 at each sync point — some high, some low. The solid line at the top is the stabilized output: the **max** of all dots within the window (for scale-down). It won't drop until the high values expire from the window.

### What Stabilization Does NOT Do

- It does **not** change the formula output. Stage 1 still computes the same raw desired each tick.
- The stabilized value does **not** feed back into the next tick's formula. The formula always uses the *actual* replica count (after all four stages).
- It only filters the *recommendation*. The actual scaling decision still goes through rate limiting and clamping.

---

## Stage 3: Rate Limiting — "Speed Limit on Scaling"

### The Problem

Even with stabilization smoothing out the recommendation, the HPA might want to make large jumps. If you're at 3 pods and stabilization says you need 20, jumping straight to 20 could overwhelm your infrastructure — thundering herd, resource contention, cascading failures.

### The Solution: Cap How Fast Replicas Can Change

Rate limiting defines **policies** — rules that limit how many replicas can be added or removed within a time window. Think of it as a speed limit: even if the destination is far away, you can only drive so fast.

Each policy has three parts:
- **Type**: `Pods` (absolute number) or `Percent` (proportion of current count)
- **Value**: how much change is allowed
- **Period**: the time window to measure against (in seconds)

**Example with Pods:** "Max +4 pods per 60 seconds" — if you already added 2 pods in the last 60 seconds, you can only add 2 more this tick.

**Example with Percent:** "Max +50% per 60 seconds" — if you started the period at 10 pods, you can scale up to at most 15 (10 × 1.5).

<div style="background: #0f1117; border-radius: 12px; padding: 1.5rem 1rem; margin: 2rem 0;">
<svg viewBox="0 0 800 320" style="width:100%;height:auto;" aria-label="Rate limiting staircase diagram">
<line x1="80" y1="30" x2="80" y2="260" stroke="#3f3f46" stroke-width="1"/>
<line x1="80" y1="260" x2="740" y2="260" stroke="#3f3f46" stroke-width="1"/>
<text x="28" y="155" fill="#71717a" font-size="9" font-family="monospace" transform="rotate(-90 28 155)">replicas</text>
<text x="410" y="288" text-anchor="middle" fill="#71717a" font-size="10" font-family="monospace">sync periods →</text>
<text x="70" y="254" text-anchor="end" fill="#71717a" font-size="9" font-family="monospace">1</text>
<text x="70" y="227" text-anchor="end" fill="#71717a" font-size="9" font-family="monospace">2</text>
<text x="70" y="200" text-anchor="end" fill="#71717a" font-size="9" font-family="monospace">3</text>
<text x="70" y="173" text-anchor="end" fill="#71717a" font-size="9" font-family="monospace">4</text>
<text x="70" y="146" text-anchor="end" fill="#71717a" font-size="9" font-family="monospace">5</text>
<text x="70" y="119" text-anchor="end" fill="#71717a" font-size="9" font-family="monospace">6</text>
<text x="70" y="92" text-anchor="end" fill="#71717a" font-size="9" font-family="monospace">7</text>
<text x="70" y="65" text-anchor="end" fill="#71717a" font-size="9" font-family="monospace">8</text>
<text x="70" y="38" text-anchor="end" fill="#71717a" font-size="9" font-family="monospace">10</text>
<line x1="80" y1="250" x2="740" y2="250" stroke="#27272a" stroke-width="0.5"/>
<line x1="80" y1="223" x2="740" y2="223" stroke="#27272a" stroke-width="0.5"/>
<line x1="80" y1="196" x2="740" y2="196" stroke="#27272a" stroke-width="0.5"/>
<line x1="80" y1="169" x2="740" y2="169" stroke="#27272a" stroke-width="0.5"/>
<line x1="80" y1="142" x2="740" y2="142" stroke="#27272a" stroke-width="0.5"/>
<line x1="80" y1="115" x2="740" y2="115" stroke="#27272a" stroke-width="0.5"/>
<line x1="80" y1="88" x2="740" y2="88" stroke="#27272a" stroke-width="0.5"/>
<line x1="80" y1="35" x2="740" y2="35" stroke="#fb7185" stroke-width="1.5" stroke-dasharray="6 3"/>
<text x="745" y="39" fill="#fb7185" font-size="10" font-weight="500" font-family="monospace">desired = 10</text>
<line x1="80" y1="250" x2="190" y2="250" stroke="#fb7185" stroke-width="2.5"/>
<line x1="190" y1="250" x2="190" y2="223" stroke="#fb7185" stroke-width="2.5"/>
<line x1="190" y1="223" x2="300" y2="223" stroke="#fb7185" stroke-width="2.5"/>
<text x="195" y="240" fill="#fb7185" font-size="9" font-weight="600" font-family="monospace">+1</text>
<line x1="300" y1="223" x2="300" y2="196" stroke="#fb7185" stroke-width="2.5"/>
<line x1="300" y1="196" x2="410" y2="196" stroke="#fb7185" stroke-width="2.5"/>
<text x="305" y="213" fill="#fb7185" font-size="9" font-weight="600" font-family="monospace">+1</text>
<line x1="410" y1="196" x2="410" y2="169" stroke="#fb7185" stroke-width="2.5"/>
<line x1="410" y1="169" x2="520" y2="169" stroke="#fb7185" stroke-width="2.5"/>
<text x="415" y="186" fill="#fb7185" font-size="9" font-weight="600" font-family="monospace">+1</text>
<line x1="520" y1="169" x2="520" y2="142" stroke="#fb7185" stroke-width="2.5"/>
<line x1="520" y1="142" x2="630" y2="142" stroke="#fb7185" stroke-width="2.5"/>
<text x="525" y="159" fill="#fb7185" font-size="9" font-weight="600" font-family="monospace">+1</text>
<line x1="630" y1="142" x2="630" y2="115" stroke="#fb7185" stroke-width="2.5"/>
<line x1="630" y1="115" x2="740" y2="115" stroke="#fb7185" stroke-width="2.5"/>
<text x="635" y="132" fill="#fb7185" font-size="9" font-weight="600" font-family="monospace">+1</text>
<line x1="725" y1="115" x2="725" y2="35" stroke="#fb7185" stroke-width="1" stroke-dasharray="3 2"/>
<polygon points="721,42 725,35 729,42" fill="#fb7185" opacity="0.7"/>
<polygon points="721,108 725,115 729,108" fill="#fb7185" opacity="0.7"/>
<text x="738" y="75" fill="#fb7185" font-size="10" font-weight="500" font-family="monospace">Δ4</text>
<text x="738" y="87" fill="#71717a" font-size="8" font-family="monospace">remaining</text>
<rect x="150" y="296" width="200" height="20" rx="4" fill="#fb7185" fill-opacity="0.08" stroke="#fb7185" stroke-width="0.5" opacity="0.6"/>
<text x="250" y="310" text-anchor="middle" fill="#fb7185" font-size="9" opacity="0.8" font-family="monospace">policy: +1 pod / 60s</text>
</svg>
</div>

The staircase shows how rate limiting works in practice. The desired value sits at 10 (dashed line), but the actual replicas climb one step at a time. Each sync period, the rate limiter checks the budget — if the policy allows +1 pod per 60s, that's all you get per tick.

### Period Start Replicas

The key concept in rate limiting is **period start replicas** — "where were we at the start of this policy's time window?" The HPA computes this by rewinding through recent scale events:

```
periodStartReplicas = currentReplicas - replicasAddedInPeriod + replicasDeletedInPeriod
```

If you already used some of your "budget" for the period, the remaining budget is smaller.

### Multiple Policies and selectPolicy

You can define multiple policies per direction. The `selectPolicy` field controls how they combine:

- **Max** (default for scale-up): pick the most permissive policy — allows the most change
- **Min**: pick the most restrictive policy — allows the least change
- **Disabled**: skip rate limiting entirely for this direction

Rate limiting doesn't have its own timer. It's evaluated at every sync period. The `periodSeconds` on a policy is just a lookback window.

---

## Stage 4: Clamping — The Safety Net

After the formula, stabilization, and rate limiting have all had their say, clamping enforces the hard boundaries:

```
actual = max(minReplicas, min(maxReplicas, rateLimitedValue))
```

If the pipeline computed 100 pods but `maxReplicas` is 50, the actual becomes 50. If it computed 0 but `minReplicas` is 2, the actual becomes 2.

<div style="background: #0f1117; border-radius: 12px; padding: 1.5rem 1rem; margin: 2rem 0;">
<svg viewBox="0 0 800 220" style="width:100%;height:auto;" aria-label="Clamping number line diagram">
<line x1="60" y1="100" x2="740" y2="100" stroke="#3f3f46" stroke-width="2"/>
<line x1="100" y1="92" x2="100" y2="108" stroke="#52525b" stroke-width="1"/>
<text x="100" y="124" text-anchor="middle" fill="#71717a" font-size="10" font-family="monospace">0</text>
<line x1="160" y1="92" x2="160" y2="108" stroke="#34d399" stroke-width="2"/>
<text x="160" y="124" text-anchor="middle" fill="#34d399" font-size="11" font-weight="600" font-family="monospace">1</text>
<text x="160" y="140" text-anchor="middle" fill="#34d399" font-size="9" opacity="0.7" font-family="monospace">min</text>
<line x1="220" y1="95" x2="220" y2="105" stroke="#52525b" stroke-width="1"/>
<text x="220" y="124" text-anchor="middle" fill="#71717a" font-size="10" font-family="monospace">2</text>
<line x1="280" y1="95" x2="280" y2="105" stroke="#52525b" stroke-width="1"/>
<line x1="340" y1="95" x2="340" y2="105" stroke="#52525b" stroke-width="1"/>
<line x1="400" y1="95" x2="400" y2="105" stroke="#52525b" stroke-width="1"/>
<line x1="460" y1="95" x2="460" y2="105" stroke="#52525b" stroke-width="1"/>
<text x="460" y="124" text-anchor="middle" fill="#71717a" font-size="10" font-family="monospace">6</text>
<line x1="520" y1="95" x2="520" y2="105" stroke="#52525b" stroke-width="1"/>
<line x1="580" y1="95" x2="580" y2="105" stroke="#52525b" stroke-width="1"/>
<text x="580" y="124" text-anchor="middle" fill="#71717a" font-size="10" font-family="monospace">8</text>
<line x1="640" y1="92" x2="640" y2="108" stroke="#34d399" stroke-width="2"/>
<text x="640" y="124" text-anchor="middle" fill="#34d399" font-size="11" font-weight="600" font-family="monospace">10</text>
<text x="640" y="140" text-anchor="middle" fill="#34d399" font-size="9" opacity="0.7" font-family="monospace">max</text>
<line x1="700" y1="95" x2="700" y2="105" stroke="#52525b" stroke-width="1"/>
<text x="700" y="124" text-anchor="middle" fill="#71717a" font-size="10" font-family="monospace">12</text>
<rect x="160" y="88" width="480" height="24" rx="4" fill="#34d399" fill-opacity="0.05"/>
<circle cx="460" cy="55" r="5" fill="#34d399" fill-opacity="0.3" stroke="#34d399" stroke-width="1.5"/>
<line x1="460" y1="61" x2="460" y2="88" stroke="#34d399" stroke-width="1.5"/>
<polygon points="456,85 460,92 464,85" fill="#34d399"/>
<text x="460" y="44" text-anchor="middle" fill="#34d399" font-size="10" font-weight="500" font-family="monospace">7 → 7</text>
<text x="460" y="32" text-anchor="middle" fill="#34d399" font-size="8" opacity="0.7" font-family="monospace">passes through</text>
<circle cx="700" cy="170" r="5" fill="#fb7185" fill-opacity="0.3" stroke="#fb7185" stroke-width="1.5"/>
<line x1="700" y1="164" x2="700" y2="150" stroke="#fb7185" stroke-width="1" stroke-dasharray="3 2"/>
<path d="M 695 150 Q 670 138 645 113" fill="none" stroke="#fb7185" stroke-width="1.5"/>
<polygon points="648,117 642,111 650,113" fill="#fb7185"/>
<text x="700" y="188" text-anchor="middle" fill="#fb7185" font-size="10" font-weight="500" font-family="monospace">12 → 10</text>
<text x="700" y="200" text-anchor="middle" fill="#fb7185" font-size="8" opacity="0.7" font-family="monospace">clamped down</text>
<circle cx="100" cy="170" r="5" fill="#fbbf24" fill-opacity="0.3" stroke="#fbbf24" stroke-width="1.5"/>
<line x1="100" y1="164" x2="100" y2="150" stroke="#fbbf24" stroke-width="1" stroke-dasharray="3 2"/>
<path d="M 105 150 Q 130 138 155 113" fill="none" stroke="#fbbf24" stroke-width="1.5"/>
<polygon points="152,117 158,111 150,113" fill="#fbbf24"/>
<text x="100" y="188" text-anchor="middle" fill="#fbbf24" font-size="10" font-weight="500" font-family="monospace">0 → 1</text>
<text x="100" y="200" text-anchor="middle" fill="#fbbf24" font-size="8" opacity="0.7" font-family="monospace">clamped up</text>
</svg>
</div>

### Clamping Is Applied Last

This ordering matters. The entire pipeline runs fully — the formula might say 100, stabilization confirms 100, rate limiting allows 100 — and only at the very end does clamping say "nope, max is 50."

The consequence: **the stabilization window still remembers that 100.** Since stabilization looks at raw Stage 1 outputs (not clamped values), future scale-down decisions will be held by that high recommendation until it expires from the window. Clamping doesn't erase the signal — it just prevents the actual scaling from exceeding bounds.

---

## The Full Pipeline

Every sync period (default 15 seconds), the HPA runs all four stages in sequence. The only feedback loop: the final actual replica count becomes `currentReplicas` for the next sync.

<div style="background: #0f1117; border-radius: 12px; padding: 1.5rem 1rem; margin: 2rem 0;">
<svg viewBox="0 0 800 340" style="width:100%;height:auto;" aria-label="Full HPA pipeline flow diagram">
<text x="80" y="30" text-anchor="middle" fill="#71717a" font-size="10" font-family="monospace">Metric Value</text>
<text x="80" y="44" text-anchor="middle" fill="#fafafa" font-size="12" font-weight="600" font-family="monospace">70</text>
<line x1="80" y1="50" x2="80" y2="70" stroke="#52525b" stroke-width="1"/>
<polygon points="76,67 80,75 84,67" fill="#52525b"/>
<text x="80" y="190" text-anchor="middle" fill="#71717a" font-size="9" font-family="monospace">currentReplicas</text>
<text x="80" y="204" text-anchor="middle" fill="#fafafa" font-size="11" font-weight="600" font-family="monospace">7</text>
<line x1="80" y1="208" x2="80" y2="126" stroke="#52525b" stroke-width="1" stroke-dasharray="3 2"/>
<polygon points="76,130 80,123 84,130" fill="#52525b"/>
<rect x="30" y="80" width="100" height="42" rx="8" fill="#fbbf24" fill-opacity="0.1" stroke="#fbbf24" stroke-width="1.5"/>
<text x="80" y="98" text-anchor="middle" fill="#fbbf24" font-size="10" font-weight="600" font-family="monospace">Formula</text>
<text x="80" y="112" text-anchor="middle" fill="#fbbf24" font-size="9" opacity="0.7" font-family="monospace">ratio × curr</text>
<line x1="135" y1="101" x2="205" y2="101" stroke="#52525b" stroke-width="1.5"/>
<polygon points="202,97 210,101 202,105" fill="#52525b"/>
<text x="170" y="93" text-anchor="middle" fill="#fafafa" font-size="11" font-weight="600" font-family="monospace">10</text>
<rect x="215" y="80" width="120" height="42" rx="8" fill="#c084fc" fill-opacity="0.1" stroke="#c084fc" stroke-width="1.5"/>
<text x="275" y="98" text-anchor="middle" fill="#c084fc" font-size="10" font-weight="600" font-family="monospace">Stabilization</text>
<text x="275" y="112" text-anchor="middle" fill="#c084fc" font-size="9" opacity="0.7" font-family="monospace">window max</text>
<line x1="340" y1="101" x2="405" y2="101" stroke="#52525b" stroke-width="1.5"/>
<polygon points="402,97 410,101 402,105" fill="#52525b"/>
<text x="372" y="93" text-anchor="middle" fill="#fafafa" font-size="11" font-weight="600" font-family="monospace">10</text>
<rect x="415" y="80" width="120" height="42" rx="8" fill="#fb7185" fill-opacity="0.1" stroke="#fb7185" stroke-width="1.5"/>
<text x="475" y="98" text-anchor="middle" fill="#fb7185" font-size="10" font-weight="600" font-family="monospace">Rate Limit</text>
<text x="475" y="112" text-anchor="middle" fill="#fb7185" font-size="9" opacity="0.7" font-family="monospace">cap Δ/period</text>
<line x1="540" y1="101" x2="605" y2="101" stroke="#52525b" stroke-width="1.5"/>
<polygon points="602,97 610,101 602,105" fill="#52525b"/>
<text x="572" y="93" text-anchor="middle" fill="#fafafa" font-size="11" font-weight="600" font-family="monospace">7</text>
<text x="572" y="118" text-anchor="middle" fill="#71717a" font-size="8" font-family="monospace">budget used</text>
<rect x="615" y="80" width="100" height="42" rx="8" fill="#34d399" fill-opacity="0.1" stroke="#34d399" stroke-width="1.5"/>
<text x="665" y="98" text-anchor="middle" fill="#34d399" font-size="10" font-weight="600" font-family="monospace">Clamp</text>
<text x="665" y="112" text-anchor="middle" fill="#34d399" font-size="9" opacity="0.7" font-family="monospace">[min, max]</text>
<line x1="720" y1="101" x2="770" y2="101" stroke="#52525b" stroke-width="1.5"/>
<polygon points="767,97 775,101 767,105" fill="#52525b"/>
<rect x="775" y="86" width="22" height="30" rx="4" fill="#fafafa" fill-opacity="0.08" stroke="#fafafa" stroke-width="1"/>
<text x="786" y="106" text-anchor="middle" fill="#fafafa" font-size="14" font-weight="700" font-family="monospace">7</text>
<path d="M 786 120 L 786 230 Q 786 250 766 250 L 100 250 Q 80 250 80 230 L 80 212" fill="none" stroke="#52525b" stroke-width="1.5" stroke-dasharray="5 3"/>
<polygon points="76,215 80,208 84,215" fill="#52525b"/>
<text x="430" y="262" text-anchor="middle" fill="#71717a" font-size="10" font-family="monospace">becomes currentReplicas for next sync period</text>
<path d="M 130 101 Q 145 60 170 55 L 218 55" fill="none" stroke="#c084fc" stroke-width="1" stroke-dasharray="3 2" opacity="0.5"/>
<text x="200" y="48" text-anchor="middle" fill="#c084fc" font-size="8" opacity="0.6" font-family="monospace">stored in window</text>
<rect x="40" y="280" width="720" height="48" rx="8" fill="#18181b" stroke="#27272a" stroke-width="1"/>
<text x="55" y="298" fill="#71717a" font-size="10" font-weight="500" font-family="monospace">Traced example:</text>
<text x="55" y="316" fill="#d4d4d8" font-size="10" font-family="monospace">7 pods, CPU=70 (target 50) → ceil(7×1.4)=10 → window max=10 → budget used, stay at 7 → 7 ∈ [1,10] → 7</text>
</svg>
</div>

### Tracing a Single Sync Period

Say we have 7 pods, CPU is at 70 (target 50), scale-down stabilization window is 180s, rate limit is +1 pod per 60s:

1. **Stage 1:** `ceil(7 × 70/50) = ceil(9.8) = 10` → raw desired = 10
2. **Stage 2:** Look back 180s. Recent raw desires: [8, 7, 6, 10]. For scale-up, min of window = 6. Since current (7) > 6, no constraint. → stabilized = 10
3. **Stage 3:** Policy: +1 pod per 60s. Period start replicas = 6 (rewound from 7, found a +1 event). Limit = 6 + 1 = 7. Desired is 10 > current 7, so up-limit applies: min(10, 7) = 7. → rate limited = 7 (no change, budget exhausted)
4. **Stage 4:** min=1, max=10. 7 is within bounds. → actual = 7

Next sync period, if the rate limit budget has refreshed, we might get to add +1.

---

## Configuring the Behavior API

All stabilization and rate limiting is configured through the HPA's `behavior` field:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-app
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  minReplicas: 1
  maxReplicas: 50
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0          # No delay on scale-up (default)
      policies:
        - type: Pods
          value: 4
          periodSeconds: 60                  # Max +4 pods per 60s
        - type: Percent
          value: 100
          periodSeconds: 60                  # Max +100% per 60s
      selectPolicy: Max                      # Use the most permissive policy
    scaleDown:
      stabilizationWindowSeconds: 300        # 5 min cooldown (default)
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60                  # Max -10% per 60s
      selectPolicy: Max
```

### Key Defaults

| Setting | Scale-Up Default | Scale-Down Default |
|---------|------------------|--------------------|
| Stabilization Window | 0s (immediate) | 300s (5 minutes) |
| Policies | +4 pods/15s, +100%/15s | -100%/15s |
| Select Policy | Max | Max |

The asymmetric defaults reflect Kubernetes' philosophy: **scale up quickly** (don't lose traffic) but **scale down cautiously** (don't kill pods you might need in a minute).

---

## Summary

| Stage | Input | Output | Purpose |
|-------|-------|--------|---------|
| **1. Formula** | Metric value, current replicas | Raw desired replicas | "How many pods does the math say we need?" |
| **2. Stabilization** | Raw desired + history window | Stabilized desired | "Is it safe to act on this, or is it noise?" |
| **3. Rate Limiting** | Stabilized desired + event history | Constrained desired | "How fast are we allowed to get there?" |
| **4. Clamping** | Constrained desired | Actual replicas | "Are we within [min, max] bounds?" |

Each stage is a filter. The formula proposes, stabilization smooths, rate limiting paces, and clamping bounds. Together, they transform a noisy metric signal into controlled, predictable scaling behavior.
