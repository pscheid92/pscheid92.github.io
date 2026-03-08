---
title: uuid
description: "Modern, zero-alloc, zero-dependency UUID library for Go. Supports V4 and V7 (RFC 9562) with pooled and batch generation for high-throughput workloads."
language: Go
github: https://github.com/pscheid92/uuid
kind: Library
topics: [rfc9562, zero-alloc, uuidv4, uuidv7, performance]
---

## Why I Built This

I've used ULIDs for years because they're great for PostgreSQL — ordered tuple storage means index scans instead of bitmap scans. So when UUID v7 landed in [RFC 9562](https://www.rfc-editor.org/rfc/rfc9562), I was excited. Digging into the existing Go libraries, I found that [gofrs/uuid](https://github.com/gofrs/uuid) has a clean, modern API but uses Method 1 (random counter) for V7 monotonicity, while [google/uuid](https://github.com/google/uuid) uses Method 3 (sub-millisecond precision) but has an aging, backward-compatible codebase. I wanted to combine both: gofrs/uuid's clean design with google/uuid's Method 3 approach — and see how far I could push it with zero allocations, pooling, and batch generation.

## What Makes It Different

- **Zero allocations** — `NewV4`, `NewV7`, `Parse`, `MarshalText`, and `UnmarshalText` all allocate nothing
- **Pool API** — amortizes `crypto/rand` reads across many UUIDs (~14x faster V4, ~2x faster V7)
- **Batch API** — generates many UUIDs in one call (~25x faster bulk V4)
- **V7 monotonicity built-in** — sub-millisecond ordering via RFC 9562 Method 3, with automatic counter fallback
- **No global mutable state** — no `SetRand`, no global clock. V3/V4/V5/V8 are pure functions
- **Strict by default** — `Parse` accepts only the standard hyphenated form; `ParseLenient` for URN/braced/compact
- **Simple value type** — `UUID` is `[16]byte`: comparable, copyable, safe as map key. Use `*UUID` for nullable fields.

## Under the Hood

The core design decision is that `UUID` is a `[16]byte` value type — all operations work on stack-allocated arrays with no heap allocations.

**Pool** maintains a buffer of 256 pre-generated UUIDs. A single `crypto/rand.Read` fills the entire buffer at once, then subsequent calls just return from the buffer until it's exhausted. For V4, this eliminates the dominant cost (each `crypto/rand` call takes ~230ns). For V7, timestamps can't be pre-computed, so the pool only pre-generates the random bytes — `time.Now()` still runs per call, which is why the speedup is ~2x rather than ~14x.

**V7 monotonicity** uses RFC 9562 Method 3: the 12-bit `rand_a` field encodes sub-millisecond precision (~244ns resolution) rather than random data. A counter fallback guarantees ordering even when multiple UUIDs are generated within the same sub-millisecond window. The counter naturally overflows into the next millisecond, so there's no hard cap on generation rate. The mutex protects only the sequence comparison and update — held for roughly 10 CPU cycles.

**Parsing** uses a 256-byte lookup table for hex-to-nibble conversion (no branching) and a 16-element offset array that maps UUID byte positions to their locations in the hyphenated string format, skipping hyphens implicitly.

**V3/V5 namespaces** pre-compute the hash state for standard namespaces (DNS, URL, OID, X500) at init time using `hash.Cloner`, so each call only hashes the name — not the namespace prefix.

## Benchmarks

Compared to google/uuid and gofrs/uuid on Apple M2:

| Benchmark | pscheid92/uuid | google/uuid | gofrs/uuid |
|-----------|---------------|-------------|------------|
| NewV4 | **247 ns** | 291 ns | 274 ns |
| NewV4 (Pool) | **17 ns** | — | — |
| NewV4Batch(100) | **1,025 ns** | 25,483 ns | 24,768 ns |
| NewV7 | **106 ns** | 309 ns | 130 ns |
| NewV7 (Pool) | **50 ns** | — | — |
| Parse | **23 ns** | 21 ns | 27 ns |
| MarshalText | **11 ns** | 18 ns | 27 ns |

All entries for this library are zero-alloc; other libraries allocate at least once per operation.

## Quick Start

```go
import "github.com/pscheid92/uuid"

id := uuid.NewV4() // random UUID
id  = uuid.NewV7() // timestamp-ordered, database-friendly

id, err := uuid.Parse("550e8400-e29b-41d4-a716-446655440000")
fmt.Println(id.String())
```

## Tech Stack

 - **Language:** Go 1.26+
 - **Dependencies:** None (stdlib only) 
 - **Distribution:** `go get github.com/pscheid92/uuid`
