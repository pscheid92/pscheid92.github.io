---
title: 'How XChaCha20-Poly1305 Works'
description: 'A walkthrough of XChaCha20-Poly1305 — the authenticated encryption scheme that combines a stream cipher with a universal hash for confidentiality and integrity in one pass.'
pubDate: 'Apr 01 2026'
tags: ['Cryptography', 'Security']
draft: true
---

## The Big Picture

XChaCha20-Poly1305 is an **AEAD (Authenticated Encryption with Associated Data)** scheme. It encrypts data for confidentiality and produces an authentication tag that detects tampering — in a single pass. The `X` means extended nonce: 24 bytes instead of the usual 12, making random nonce generation safe for virtually unlimited encryptions under the same key.

---

## The Building Blocks

The scheme combines two primitives:

- **ChaCha20** — a stream cipher that generates a pseudorandom keystream, XORed with plaintext to produce ciphertext.
- **Poly1305** — a one-time authenticator that produces a 16-byte MAC (Message Authentication Code) from the ciphertext and any associated data.

The `X` variant adds a third piece:

- **HChaCha20** — a key derivation step that stretches the 24-byte nonce into a subkey and 12-byte sub-nonce for standard ChaCha20.

---

## ChaCha20: The Stream Cipher

ChaCha20 is built on a **quarter-round** function that mixes four 32-bit words:

```
a += b; d ^= a; d <<<= 16;
c += d; b ^= c; b <<<= 12;
a += b; d ^= a; d <<<= 8;
c += d; b ^= c; b <<<= 7;
```

The cipher state is a 4×4 matrix of 32-bit words:

```
"expa"  "nd 3"  "2-by"  "te k"    ← constants
 key₀    key₁    key₂    key₃     ← 256-bit key
 key₄    key₅    key₆    key₇
 cnt      n₀      n₁      n₂      ← counter + 96-bit nonce
```

To generate 64 bytes of keystream:

1. Copy the state to a working copy.
2. Apply **20 rounds** (10 iterations of column rounds + diagonal rounds, each consisting of 4 quarter-rounds).
3. Add the original state to the working copy word-by-word.
4. Serialize the result as 64 bytes of keystream.
5. Increment the counter and repeat for more keystream.

Encryption: `ciphertext = plaintext ⊕ keystream`.

### Why ChaCha20 Over AES?

- **No special hardware needed.** AES is fast with AES-NI but slow in software on platforms without it (embedded, older ARM). ChaCha20 uses only adds, XORs, and rotates — fast everywhere.
- **No timing side channels.** ChaCha20's operations are naturally constant-time. AES in software requires careful implementation to avoid cache-timing attacks.

---

## HChaCha20: Extending the Nonce

XChaCha20 uses a 24-byte nonce. The first 16 bytes feed into **HChaCha20** to derive a 256-bit subkey:

1. Set up the ChaCha state with the original key and the first 16 bytes of the nonce (in place of counter + nonce).
2. Run 20 rounds of ChaCha (without the final addition).
3. Extract words 0–3 and 12–15 as the 256-bit subkey.

The remaining 8 bytes of the nonce, prefixed with 4 zero bytes, become the 12-byte sub-nonce for standard ChaCha20.

**Why this matters:** With a 12-byte nonce and random generation, birthday collisions become likely after ~2³² encryptions. With 24 bytes, the threshold is ~2⁴⁸ — safe for any practical usage pattern.

---

## Poly1305: The Authenticator

Poly1305 is a **one-time MAC** — it takes a single-use 256-bit key and a message, and produces a 16-byte tag.

The math is polynomial evaluation over a prime field:

```
tag = ((c₁·r^n + c₂·r^(n-1) + ... + cₙ·r) mod (2¹³⁰ - 5)) + s
```

where:
- The message is split into 16-byte chunks c₁, c₂, ..., cₙ (each treated as a 128-bit integer with a high bit appended).
- **r** is the first 128 bits of the Poly1305 key (with certain bits clamped for performance).
- **s** is the last 128 bits of the key.

The tag is the polynomial evaluated at r, plus s. Without knowing r and s, an attacker can't forge a valid tag.

**Critical requirement:** The (r, s) key pair must be used for **exactly one message**. In ChaCha20-Poly1305, the Poly1305 key is derived from the first 32 bytes of ChaCha20 keystream (block 0), ensuring each nonce produces a unique Poly1305 key.

---

## Putting It All Together

To encrypt with XChaCha20-Poly1305:

1. **Derive subkey and sub-nonce** via HChaCha20 from the key and first 16 bytes of the 24-byte nonce.
2. **Generate Poly1305 key** from ChaCha20 block 0 (using subkey and sub-nonce).
3. **Encrypt** the plaintext with ChaCha20 starting at block 1.
4. **Authenticate**: compute the Poly1305 tag over:
   ```
   AAD || pad || ciphertext || pad || len(AAD) as u64 || len(ciphertext) as u64
   ```
   where pad is zero-padding to 16-byte alignment.
5. **Output:** nonce || ciphertext || 16-byte tag.

Decryption reverses steps 3–4: recompute the tag, verify it in constant time, and only then decrypt.

---

## Authentication Catches Everything

The Poly1305 tag protects against:

- **Tampering:** Any modification to the ciphertext or AAD changes the tag.
- **Truncation:** The length fields are included in the MAC input.
- **Wrong key/nonce:** Decryption with the wrong key produces a different keystream, which produces a different Poly1305 key, which produces a different tag — verification fails.

This last property is why AEAD schemes don't need a separate "is this the right key?" check. A wrong password manifests as an authentication failure.

---

## Further Reading

- Daniel J. Bernstein, ["ChaCha, a variant of Salsa20"](https://cr.yp.to/chacha/chacha-20080128.pdf) — the original ChaCha paper.
- RFC 8439 — ChaCha20-Poly1305 IETF specification.
- RFC draft — XChaCha20-Poly1305 construction.
