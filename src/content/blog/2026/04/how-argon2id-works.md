---
title: 'How Argon2id Works'
description: 'Inside Argon2id — the memory-hard password hashing function that makes brute-force attacks expensive by design, from the memory matrix to the hybrid mixing passes.'
pubDate: 'Apr 01 2026'
tags: ['Cryptography', 'Security']
draft: true
---

## The Big Picture

Argon2 won the Password Hashing Competition in 2015 and was standardized as RFC 9106. It's designed so that hashing a password is cheap for a legitimate user (a few hundred milliseconds) but prohibitively expensive for an attacker with GPUs or ASICs.

The `id` variant combines two modes: Argon2i (data-independent memory access, side-channel resistant) for the first pass, and Argon2d (data-dependent access, harder to attack with GPUs) for subsequent passes.

---

## Why Memory-Hardness Matters

Traditional KDFs like PBKDF2 and bcrypt are **compute-hard**: they slow down hashing by iterating a hash function many times. But GPUs have thousands of cores — they can run thousands of PBKDF2 instances in parallel, with each core handling one candidate password.

Argon2 is **memory-hard**: each instance requires a large, dedicated memory allocation (e.g., 256 MiB). A GPU with 24 GB of VRAM can only run ~96 simultaneous instances at 256 MiB each. Memory-hardness turns the attack from "how many cores do you have?" into "how much RAM do you have?" — a much more expensive resource to scale.

---

## The Memory Matrix

Argon2 allocates a matrix of **q blocks**, each 1024 bytes. The blocks are organized into:

- **p lanes** (parallelism parameter) — independent columns that can be computed concurrently.
- **n passes** (iteration parameter) — how many times the entire matrix is filled.
- **4 segments per pass per lane** — the unit of sequential dependency within a lane.

For example, with 256 MiB memory and 1 lane:
```
q = 256 × 1024 = 262,144 blocks
Each pass fills all 262,144 blocks
3 passes = 786,432 block computations
```

---

## Block Generation

Each block is computed from two previous blocks using the **GB compression function**, which is built from the BLAKE2b round function:

```
B[i] = G(B[ref], B[prev])
```

where:
- **B[prev]** is the immediately preceding block in the lane.
- **B[ref]** is a block selected by an indexing function.

### Data-Independent vs. Data-Dependent Indexing

This is where the `id` in Argon2id comes in:

- **First half of pass 1 (Argon2i-style):** The reference index is generated from a pseudorandom function seeded with the pass number, lane, and position — **independent of the actual block contents**. This prevents side-channel attacks (an attacker watching memory access patterns learns nothing about the password).

- **Second half of pass 1 and all subsequent passes (Argon2d-style):** The reference index is derived from the **content of the previous block**. This makes the memory access pattern depend on the password, which means an attacker can't precompute the access pattern — they must actually fill the memory to know which blocks to read.

The hybrid gives you side-channel resistance during the critical early phase (when the matrix is being initialized and patterns are most informative) and maximum GPU resistance for the bulk of the computation.

---

## The GB Compression Function

GB takes two 1024-byte blocks (8 × 128-byte rows), applies the BLAKE2b **G function** (the same quarter-round as in BLAKE2b hashing) in two steps:

1. **Column-wise mixing:** Apply G to each column of the 8×16 matrix of 64-bit words.
2. **Row-wise mixing:** Apply G to each row.

The output is XORed with the input to prevent trivial inversions. This makes each block depend on the full content of its two parent blocks, ensuring that skipping any block invalidates all subsequent blocks.

---

## Initialization and Finalization

**Initialization:**
1. Hash the inputs (password, salt, parameters) with BLAKE2b to produce a 64-byte digest H₀.
2. Use H₀ to generate the first two blocks of each lane via a variable-length hash function (BLAKE2b in long-output mode).

**Finalization:**
1. XOR the last block of each lane together.
2. Hash the result with BLAKE2b in long-output mode to produce the final tag of the desired length.

---

## Tuning Parameters

The three dials you can turn:

| Parameter | Effect | Trade-off |
|-----------|--------|-----------|
| **Memory (m)** | Larger matrix = more RAM per instance | Directly limits GPU parallelism |
| **Iterations (t)** | More passes over the matrix | Linear increase in time; same memory |
| **Parallelism (p)** | More lanes computed concurrently | Faster for the defender; but also for the attacker if they have the RAM |

The general guidance: maximize memory first (it's the most effective defense), then increase iterations to hit your target latency.

---

## Why Argon2id Doesn't Fix Weak Passwords

Argon2id makes brute-force **slower**, not impossible. The math is straightforward:

- At 256 MiB / 3 iterations, one hash ≈ 380 ms per core.
- A 4-digit PIN has 10,000 candidates → cracked in 64 minutes on a single core.
- A 4-word diceware passphrase has ~7776⁴ ≈ 3.66 × 10¹⁵ candidates → 22 million years on a single core.

Memory-hardness buys orders of magnitude, but the password's entropy is still the dominant factor.

---

## Further Reading

- Alex Biryukov et al., ["Argon2: the memory-hard function for password hashing and other applications"](https://www.password-hashing.net/argon2-specs.pdf) — the original specification.
- RFC 9106 — the IETF standard.
