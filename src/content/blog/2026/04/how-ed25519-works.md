---
title: 'How Ed25519 Works'
description: 'A ground-up explanation of Ed25519, the elliptic curve signature scheme built on Curve25519, from finite fields to Schnorr-style signing.'
pubDate: 'Apr 01 2026'
tags: ['Cryptography', 'Security']
series: 'inside-pqsign'
seriesPart: 2
draft: true
---

## The Big Picture

Ed25519 is a digital signature scheme on edwards25519, the twisted Edwards curve that is birationally equivalent to Curve25519. It produces 64-byte signatures using 32-byte keys. OpenSSH generates Ed25519 keys by default since version 9.5, and TLS 1.3 supports it alongside the mandatory RSA and ECDSA P-256.

This post explains how it works from the ground up.

---

## Elliptic Curves Over Finite Fields

An elliptic curve over a finite field is a set of points (x, y) satisfying an equation like y² = x³ + ax + b, where all arithmetic happens modulo a prime p. The key property: you can "add" two points on the curve to get a third point, and this addition operation forms a group.

**Scalar multiplication**, computing kP (adding P to itself k times), is efficient. But given P and kP, recovering k is believed to be computationally hard. This is the **Elliptic Curve Discrete Logarithm Problem (ECDLP)**, and it's the foundation of all elliptic curve cryptography.

---

## Curve25519 and the Edwards Form

Curve25519 uses the prime p = 2²⁵⁵ - 19 (hence the name). It is defined as a Montgomery curve; Ed25519 uses the birationally equivalent twisted Edwards curve, called edwards25519:

```
-x² + y² = 1 + d·x²·y²
```

where d = -121665/121666 mod p.

The Edwards form has a practical advantage: the addition formula is **complete**: it works for all input points without special cases for doubling or the identity. This eliminates branches in the implementation, making it naturally resistant to timing side-channel attacks.

The base point B is a specific generator of a prime-order subgroup of order:

```
ℓ = 2²⁵² + 27742317777372353535851937790883648493
```

This ~253-bit prime puts the best known attack at about 2¹²⁶ operations, which is what the usual "128-bit security level" refers to.

---

## Key Generation

1. Generate 32 random bytes as the **seed**.
2. Compute `H = SHA-512(seed)`, a 64-byte hash.
3. Take the lower 32 bytes of H, clamp them (clear the lowest 3 bits, clear the highest bit, set the second-highest bit), and interpret as a scalar **a**.
4. Compute the public key **A = aB** (scalar multiplication of the base point).

The clamping makes the scalar a multiple of the cofactor 8, so multiplying any curve point by it lands in the prime-order subgroup, and it fixes the position of the highest set bit so every scalar has the same length.

---

## Signing

To sign a message M with secret key seed and public key A:

1. Compute `H = SHA-512(seed)`. The lower 32 bytes give scalar **a**; the upper 32 bytes are the **prefix**.
2. Compute `r = SHA-512(prefix || M)`, a deterministic nonce derived from the secret key and message.
3. Compute the commitment **R = rB**.
4. Compute the challenge `k = SHA-512(R || A || M)`, reduced mod ℓ.
5. Compute the response `s = (r + k·a) mod ℓ`.

The signature is **(R, s)**: the point R (32 bytes) and the scalar s (32 bytes), totaling 64 bytes.

**Why the deterministic nonce matters:** In ECDSA, a repeated or biased nonce leaks the secret key (a repeated nonce is how the PS3 signing key was extracted). Ed25519 derives r from the secret key and message, making nonce reuse impossible and the scheme deterministic.

---

## Verification

Given a message M, public key A, and signature (R, s):

1. Reject the signature if s is not smaller than ℓ.
2. Compute `k = SHA-512(R || A || M)`, reduced mod ℓ.
3. Check that `sB = R + kA`.

This works because:
```
sB = (r + k·a)B = rB + k·aB = R + kA
```

If the signature is valid, the equation holds. If either s or R was forged, the equation fails with overwhelming probability.

---

## Why Ed25519 Is Fast

- **No scalar inversion.** ECDSA has to invert a number modulo the group order for every signature and every verification. The Schnorr-style equation sB = R + kA needs none.
- **Fixed-base scalar multiplication.** A precomputed table for B makes signing (computing rB) cheap. Verification also has to compute kA for a point it has never seen, which is why it takes about three times as long as signing.
- **Small keys and signatures.** 32 + 64 bytes total, compact enough to embed anywhere.

---

## Security Properties

- **~128-bit security level.** The best known attack is Pollard's rho, which needs about 2¹²⁶ group operations.
- **Not post-quantum.** Shor's algorithm solves ECDLP in polynomial time on a quantum computer. This is why Ed25519 needs a post-quantum companion in hybrid schemes.
- **SUF-CMA secure**, as specified in RFC 8032: the verifier rejects any s that is not below ℓ, so an attacker can't turn a valid signature into a second one for the same message.
- **Deterministic.** No randomness needed at signing time, eliminating an entire class of implementation bugs.

---

## Further Reading

- Daniel J. Bernstein et al., ["High-speed high-security signatures"](https://ed25519.cr.yp.to/ed25519-20110926.pdf): the original Ed25519 paper.
- RFC 8032: the IETF specification.
