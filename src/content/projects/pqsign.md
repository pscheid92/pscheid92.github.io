---
title: pqsign
description: "Hybrid post-quantum file signing tool. Combines Ed25519 and ML-DSA-65 in a nested signature scheme — both must verify, so a break in either algorithm alone doesn't compromise authenticity."
language: Rust
github: https://github.com/pscheid92/pqsign
kind: CLI
topics: [post-quantum, cryptography, ml-dsa, ed25519, fips204, hybrid-signing]
---

## Why I Built This

I wanted to get deeper into both Rust and applied cryptography, and building a real tool felt like a better way to learn than working through textbook exercises. [minisign](https://jedisct1.com/minisign/) is the go-to for simple file signing, but it's Ed25519-only — no post-quantum support. When NIST finalized [FIPS 204 (ML-DSA)](https://csrc.nist.gov/pubs/fips/204/final) in 2024, that seemed like the right project: take minisign's "simple CLI for signing files" idea, add a post-quantum layer, and learn how signature schemes, key derivation, and authenticated encryption actually fit together by implementing them end to end.

The result is a hybrid scheme where Ed25519 and ML-DSA-65 both have to verify. If lattice-based crypto turns out weaker than expected, Ed25519 still holds. If quantum computers break Ed25519, ML-DSA-65 covers you. Neither signature alone is sufficient — they're nested so you can't strip one out.

## How It Works

**Signing** hashes the file with BLAKE2b-512 (streaming, so it never loads the full file into memory), then produces two interdependent signatures:

```text
file_hash   = BLAKE2b-512(file)
ed25519_sig = Ed25519.Sign(sk, "pqsign-ed25519" || file_hash || trusted_comment)
mldsa65_sig = ML-DSA-65.Sign(sk, file_hash || ed25519_sig, ctx="pqsign-mldsa65")
```

The signatures are nested, not independent — ML-DSA-65 signs over the Ed25519 signature bytes. This means an attacker who breaks one algorithm can't just replace that component; modifying either signature invalidates the other. Domain separation tags (`"pqsign-ed25519"`, `"pqsign-mldsa65"`) prevent cross-protocol attacks.

**Trusted comments** (timestamp, filename, custom text) are bound into the Ed25519 message and transitively covered by ML-DSA-65. Tampering with the comment invalidates both signatures.

**Key protection** uses Argon2id (256 MiB, 3 iterations) to derive a key from the user's password, then encrypts the secret key with XChaCha20-Poly1305. At ~2.6 attempts per second per core, even a short passphrase makes offline brute-force impractical. All secret material is zeroized on drop.

## Quick Start

```bash
# Generate a key pair (prompts for password)
pqsign generate

# Sign a file — produces document.pdf.pqsig
pqsign sign document.pdf
pqsign sign document.pdf -t "release v1.0"

# Verify
pqsign verify document.pdf
pqsign verify document.pdf -p mykey.pub

# Inspect metadata
pqsign inspect document.pdf.pqsig
```

Keys default to `~/.pqsign/default.key` and `~/.pqsign/default.key.pub`. Public keys are base64-encoded text (`pqsign:v1:<base64>`), so they're easy to paste into READMEs or config files.

## Benchmarks

End-to-end CLI timings on Apple M-series (key I/O, Argon2id, hashing, signing/verification):

| Operation | 0 B | 1 KiB | 1 MiB | 10 MiB | 100 MiB |
|-----------|-----|-------|-------|--------|---------|
| Sign | 380 ms | 400 ms | 389 ms | 398 ms | 486 ms |
| Verify | 178 µs | 181 µs | 1.19 ms | 10.8 ms | 106 ms |

Signing has a ~380 ms floor regardless of file size — that's Argon2id decrypting the secret key (256 MiB memory, 3 iterations). The actual cryptographic signing adds under 1 ms. BLAKE2b-512 hashing only becomes visible at 100 MiB, where it adds ~106 ms at roughly 1 GiB/s throughput.

Verification is the interesting side: no password, no Argon2id, so it's **2000x faster** for small files. Sub-millisecond up to 1 KiB, and even a 100 MiB file verifies in ~100 ms. This is what matters in practice — signing happens once, verification happens many times.

## What Makes It Different

- **Nested hybrid scheme** — not just two independent signatures stapled together; breaking one algorithm doesn't help an attacker
- **NIST-standardized post-quantum** — ML-DSA-65 (FIPS 204, security level 3), not an experimental or pre-standardization algorithm
- **Password-protected keys** — Argon2id + XChaCha20-Poly1305, same defense-in-depth as modern password managers
- **Streaming file hashing** — sign multi-gigabyte files without loading them into memory
- **Self-signed releases** — all release binaries are signed with pqsign itself, with the public key in the repo

## Tech Stack

- **Language:** Rust (edition 2024)
- **Cryptography:** ed25519-dalek, fips204 (ML-DSA-65), blake2, argon2, chacha20poly1305
- **CLI:** clap (derive)
- **Distribution:** GitHub Releases for Linux (x86_64, ARM64), macOS (x86_64, ARM64), and Windows
