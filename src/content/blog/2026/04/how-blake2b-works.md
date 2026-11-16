---
title: 'How BLAKE2b Works'
description: 'Inside BLAKE2b, the cryptographic hash function that processes data faster than SHA-512 while maintaining a strong security margin.'
pubDate: 'Apr 01 2026'
tags: ['Cryptography', 'Security']
series: 'inside-pqsign'
seriesPart: 4
draft: true
---

## The Big Picture

BLAKE2b is a cryptographic hash function that produces digests up to 512 bits. It's faster than SHA-512, MD5, and SHA-256 on 64-bit platforms without sacrificing security. It descends from BLAKE, a SHA-3 finalist, which itself is based on Daniel J. Bernstein's ChaCha stream cipher.

This post explains how BLAKE2b turns arbitrary-length input into a fixed-length hash.

---

## Design Lineage

BLAKE2b's internal structure is a variant of the **ChaCha quarter-round**, applied within an **HAIFA-style** (HAsh Iterative FrAmework) compression function. The family tree:

```
ChaCha (stream cipher)
  └─ BLAKE (SHA-3 finalist)
       └─ BLAKE2b (optimized, simplified)
```

BLAKE2 dropped the constants from BLAKE's G function (their benefit wasn't worth the cycles) and reduced the number of rounds from 16 to 12.

---

## State and Initialization

BLAKE2b maintains an internal state of **eight 64-bit words** (h₀ through h₇), initialized by XORing the IV (the fractional parts of the square roots of the first eight primes, the same constants SHA-512 uses) with parameter block values:

```
h₀ = IV₀ ⊕ 0x01010000 ⊕ (kk << 8) ⊕ nn
h₁ = IV₁
...
h₇ = IV₇
```

where `nn` is the digest length (64 for BLAKE2b-512) and `kk` is the key length (0 for unkeyed hashing).

---

## The Compression Function

BLAKE2b processes input in **128-byte blocks**. For each block, the compression function:

1. **Initialize the working vector v** (16 words): the top 8 from the current state, the bottom 8 from the IV, with the counter mixed into words 12 and 13 and the finalization flag into word 14.

2. **Apply 12 rounds of mixing.** Each round consists of 8 calls to the **G function**: 4 on columns and 4 on diagonals of a 4×4 matrix of words.

3. **Finalize:** XOR the top and bottom halves of v back into the state.

### The G Function

Each G(a, b, c, d) mixes four 64-bit words using two message words (mᵢ, mⱼ) selected by a permutation schedule:

```
a = a + b + mᵢ
d = (d ⊕ a) >>> 32
c = c + d
b = (b ⊕ c) >>> 24
a = a + b + mⱼ
d = (d ⊕ a) >>> 16
c = c + d
b = (b ⊕ c) >>> 63
```

This is a modified ChaCha quarter-round. The additions provide diffusion, the XORs mix bits, and the rotations break alignment. The rotation amounts (32, 24, 16, 63) were chosen for implementation speed: rotations by multiples of 8 are byte shuffles, and a rotation by 63 is a doubling plus a shift.

### The Permutation Schedule

Each of the 12 rounds selects 16 message words via a fixed permutation σ. The permutations cycle through 10 distinct patterns (rounds 11 and 12 reuse σ₀ and σ₁). This ensures every message word influences every state word across the full 12 rounds.

---

## Processing a Message

1. **Pad** the message to a multiple of 128 bytes (zero-padding; no length encoding needed since the counter tracks it).
2. **For each block**, call the compression function with a 128-bit counter that holds the number of message bytes fed in so far.
3. **On the last block**, set the finalization flag.
4. **Output** the first `nn` bytes of the final state as the hash digest.

Because the counter carries the message length into every block, and the flag marks the last one, the padding needs no length field of its own.

---

## Why BLAKE2b Is Fast

- **Designed for 64-bit CPUs.** Every operation (64-bit add, XOR, rotate) maps to a single instruction on modern processors.
- **No message expansion.** Unlike SHA-512, which expands each block's 16 message words to 80, BLAKE2b uses the 16 words directly with permutation schedules.
- **12 rounds vs. 80.** SHA-512 runs 80 rounds per block; BLAKE2b runs 12. Fewer rounds with a wider state achieves comparable diffusion at lower cost.
- **Parallelism-friendly.** BLAKE2bp (the parallel variant) processes 4 lanes simultaneously, but even the sequential BLAKE2b benefits from instruction-level parallelism within each round.

Typical throughput on x86-64: **about 3 cycles/byte**, or roughly 1 GiB/s, about 3× faster than SHA-512.

---

## Security

- **Collision resistance:** 2²⁵⁶ for BLAKE2b-512 (birthday bound on 512-bit output).
- **Preimage resistance:** 2⁵¹² (full digest).
- **Post-quantum:** Grover's algorithm halves the exponent for preimages: 2²⁵⁶ instead of 2⁵¹². The best known quantum collision search only lowers collisions to roughly 2¹⁷⁰. Both are far out of reach.

No attack on the full 12-round BLAKE2b has been published. On the hash function itself, the best preimage attacks reach 2.75 rounds; a pseudo-preimage attack on the bare compression function reaches 7.5 rounds.

---

## Further Reading

- Jean-Philippe Aumasson et al., ["BLAKE2: simpler, smaller, fast as MD5"](https://blake2.net/): the BLAKE2 paper.
- RFC 7693: the IETF specification.
