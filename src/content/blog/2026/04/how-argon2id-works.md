---
title: 'How Argon2id Works'
description: 'Inside Argon2id, the memory-hard password hashing function that makes brute-force attacks expensive by design, from the memory matrix to the hybrid mixing passes.'
pubDate: 'Apr 01 2026'
tags: ['Cryptography', 'Security']
series: 'inside-pqsign'
seriesPart: 5
draft: true
---

## The Big Picture

Argon2 won the Password Hashing Competition in 2015 and was published as RFC 9106. It's designed so that hashing a password is cheap for a legitimate user (a few hundred milliseconds) but prohibitively expensive for an attacker with GPUs or ASICs.

The `id` variant combines two modes: Argon2i (data-independent memory access, side-channel resistant) for the first half of the first pass, and Argon2d (data-dependent access, harder to attack with GPUs) for everything after that.

---

## Why Memory-Hardness Matters

Traditional KDFs like PBKDF2 and bcrypt are **compute-hard**: they slow down hashing by iterating a hash function many times. But GPUs have thousands of cores and can run thousands of PBKDF2 instances in parallel, with each core handling one candidate password.

Argon2 is **memory-hard**: each instance requires a large, dedicated memory allocation (e.g., 256 MiB). A GPU with 24 GB of VRAM can only run ~96 simultaneous instances at 256 MiB each. Memory-hardness turns the attack from "how many cores do you have?" into "how much RAM do you have?", a much more expensive resource to scale.

---

## The Memory Matrix

Argon2 allocates **m′ blocks** of 1024 bytes each and arranges them as a matrix:

- **p lanes** (parallelism parameter): the rows, which can be computed concurrently and synchronize four times per pass.
- **t passes** (iteration parameter): how many times the entire matrix is filled.
- **4 slices per pass**: a lane's share of a slice is a segment, the unit of sequential work.

For example, with 256 MiB memory and 1 lane:
```
m′ = 256 × 1024 = 262,144 blocks
Each pass fills all 262,144 blocks
3 passes = 786,432 block computations
```

---

## Block Generation

Each block is computed from two previous blocks using the **compression function G**, which is built from the BLAKE2b round function:

```
B[i][j] = G(B[i][j-1], B[l][z])
```

where:
- **B[i][j-1]** is the immediately preceding block in the lane.
- **B[l][z]** is a block selected by an indexing function, possibly from another lane.

From the second pass on, the result is also XORed into the block it overwrites.

### Data-Independent vs. Data-Dependent Indexing

This is where the `id` in Argon2id comes in:

- **First half of pass 1 (Argon2i-style):** The reference index is generated from a pseudorandom function seeded with the pass number, lane, and position, **independent of the actual block contents**. This prevents side-channel attacks (an attacker watching memory access patterns learns nothing about the password).

- **Second half of pass 1 and all subsequent passes (Argon2d-style):** The reference index is derived from the **content of the previous block**. This makes the memory access pattern depend on the password, which means an attacker can't precompute the access pattern. They must actually fill the memory to know which blocks to read.

The hybrid gives you side-channel resistance while the first part of the matrix is filled, and the stronger GPU resistance of data-dependent access for the bulk of the computation.

---

## The Compression Function G

G takes two 1024-byte blocks, XORs them, and treats the result as an 8×8 matrix of 16-byte registers. It then applies a permutation P in two steps:

1. **Row-wise mixing:** Apply P to each of the 8 rows.
2. **Column-wise mixing:** Apply P to each of the 8 columns.

P is one round of BLAKE2b with a twist: its quarter-round GB adds a 64-bit multiplication to every addition, which makes the function slower in custom hardware without costing much on a CPU. The output is XORed with the input to prevent trivial inversions. This makes each block depend on the full content of its two parent blocks, ensuring that skipping any block invalidates all subsequent blocks.

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
- A 4-digit PIN has 10,000 candidates → all tried in 64 minutes on a single core.
- A 4-word diceware passphrase has 7776⁴ ≈ 3.66 × 10¹⁵ candidates → 44 million years on a single core.

Memory-hardness buys orders of magnitude, but the password's entropy is still the dominant factor.

---

## Further Reading

- Alex Biryukov et al., ["Argon2: the memory-hard function for password hashing and other applications"](https://www.password-hashing.net/argon2-specs.pdf): the original specification.
- RFC 9106: the IETF standard.
