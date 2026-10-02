---
title: AgeSharp
description: "A C# implementation of the age file encryption format. Fully interoperable with age, rage, and other age-compatible tools. Available on NuGet."
language: "C#"
github: https://github.com/pscheid92/AgeSharp
kind: Library
topics: [cryptography, age-encryption, nuget, x25519, post-quantum, dotnet]
---

## Why I Built This

While setting up [SOPS](/projects/k8s-cluster/) for my Kubernetes cluster, I discovered [age](https://age-encryption.org) — a modern file encryption tool designed by Filippo Valsorda as a simpler replacement for PGP. I liked the simplicity and flexibility of the format and started thinking about applications at work. The problem: our main backend language at DeepL is C#, and there was no age implementation for .NET. So I built one.

## How It Works

age splits encryption into two layers: **key wrapping** and **payload encryption**.

**Key wrapping** generates a random 16-byte file key, then wraps it independently for each recipient using their specific scheme — X25519 Diffie-Hellman for public keys, scrypt for passphrases, converted Ed25519 for SSH keys, or the X-Wing hybrid KEM for post-quantum recipients. Each scheme derives a wrapping key and encrypts the file key with ChaCha20-Poly1305.

**Payload encryption** derives a payload key from the file key via HKDF-SHA256 with a random 16-byte nonce. The plaintext is encrypted in **64 KiB chunks** using ChaCha20-Poly1305, each with a counter-based nonce and a final-chunk flag. This enables streaming without buffering the entire file — both `EncryptReader` and `DecryptReader` process data lazily on `Read()`.

The **header** ties it together: all recipient stanzas followed by an HMAC-SHA256 MAC over the header bytes, keyed from the file key. Tampering with any stanza invalidates the MAC.

All sensitive material (file keys, shared secrets, wrapping keys) is zeroed from memory after use via `CryptographicOperations.ZeroMemory()`.

## Features

- **All standard recipient types** — X25519, scrypt/passphrase, SSH-Ed25519, SSH-RSA
- **Post-quantum** — ML-KEM-768-X25519 hybrid encryption
- **Encrypt to multiple recipients**
- **Plugin protocol** — interoperates with `age-plugin-*` binaries
- **Encrypted identity files** (passphrase-protected)
- **ASCII armor support**
- **Pull-based streaming** (`EncryptReader` / `DecryptReader`) — lazy chunk-by-chunk processing
- **Random-access decryption** (`AgeRandomAccess`) — seek into encrypted files without reading the whole thing
- **Detached header APIs** — store header and payload separately
- **Header inspection** without decryption
- **Interop-tested** against the Go `age` CLI — encrypts and decrypts bidirectionally

AgeSharp is the most complete non-Go implementation — it covers every feature in the Go v1.3.0 API, including post-quantum recipients, random-access decryption, and detached headers, where rage has gaps.

## Usage

```csharp
using Age;
using Age.Recipients;

// Generate a key pair
using var identity = X25519Identity.Generate();
var recipient = identity.Recipient;

// Encrypt
using var input = new MemoryStream("Hello, age!"u8.ToArray());
using var encrypted = new MemoryStream();
AgeEncrypt.Encrypt(input, encrypted, recipient);

// Decrypt
encrypted.Position = 0;
using var decrypted = new MemoryStream();
AgeEncrypt.Decrypt(encrypted, decrypted, identity);
```

## Benchmarks

CLI wall-clock time compared to the Go and Rust implementations (Apple M2 Pro, AOT-compiled, averaged over 5 runs):

| Size | Op | age (Go) | rage (Rust) | AgeSharp (C#) |
|---|---|---:|---:|---:|
| 1 KB | enc | 24 ms | 23 ms | 24 ms |
| 1 KB | dec | 24 ms | 23 ms | 25 ms |
| 1 MB | enc | 26 ms | 29 ms | 31 ms |
| 1 MB | dec | 27 ms | 30 ms | 30 ms |
| 100 MB | enc | 189 ms | 459 ms | 467 ms |
| 100 MB | dec | 156 ms | 470 ms | 384 ms |

Up to 1 MB, all three are within noise (~25 ms), dominated by process startup. At 100 MB, Go leads thanks to assembly-optimized ChaCha20-Poly1305, but AgeSharp beats rage on decrypt. The AOT-compiled binary starts in ~28 ms, comparable to native Go and Rust.

## Tech Stack

 - **Language:** C# / .NET 10
 - **Cryptography:** BouncyCastle.Cryptography (single dependency — provides X25519, ML-KEM-768, ChaCha20-Poly1305, scrypt, HKDF, SSH key parsing)
 - **Distribution:** NuGet package + AOT-compiled CLI binaries (Linux x64/ARM64, macOS x64/ARM64, Windows x64)
