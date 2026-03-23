---
title: centrifuge-rs
description: "Production-ready async Rust client SDK for the Centrifuge real-time messaging protocol. Full pub/sub, presence, history, and RPC with actor-based connection management."
language: Rust
github: https://github.com/pscheid92/centrifuge-rs
kind: Library
topics: [rust, websocket, real-time, centrifugo, pub-sub, tokio, actor-model, protobuf]
---

## Why I Built This

I needed a Centrifugo client for PingMe, a desktop notification app I'm building with Tauri. Centrifugo is a good fit for real-time push — it handles reconnection, history recovery, and presence at the server level so the client doesn't have to reinvent those primitives. But when I went looking for a Rust client library, the existing options were unmaintained or incomplete. The official SDKs are in Go, JavaScript, Swift, and Dart — Rust is an afterthought.

So I wrote one properly. The [Centrifuge Client SDK specification](https://centrifugal.dev/docs/transports/client_protocol) defines 139 requirements covering connection states, subscription lifecycle, token refresh, error codes, and recovery semantics. I wanted to implement all of them correctly, not just the happy path.

## How It Works

The client is built around a single background actor per connection. When you call `Client::new()`, nothing happens yet — you get a lightweight handle backed by a channel. When you call `connect()`, a `ConnectionActor` is spawned as a tokio task and takes ownership of the WebSocket transport:

```rust
let client = Client::new(ClientConfig::new("ws://localhost:8000/connection/websocket"));
let (sub, mut events) = client.subscribe("example").await?;
client.connect().await?;

loop {
    tokio::select! {
        Some(event) = events.recv() => match event {
            SubEvent::Publication(p) => println!("received {} bytes", p.data.len()),
            SubEvent::Subscribed(ctx) => println!("subscribed to {}", ctx.channel),
            _ => {}
        },
        _ = tokio::signal::ctrl_c() => break,
    }
}
```

All state lives inside the actor — no mutexes, no `Arc<Mutex<...>>` scattered across the codebase. The public `Client` and `Subscription` handles are cheaply cloneable Arc-backed structs that send commands to the actor over async channels and receive responses via oneshot channels. The actor serializes everything; the handles are just message-passing endpoints.

## Under the Hood

**Connection lifecycle** follows a strict state machine: `Disconnected → Connecting → Connected → Closed`. The actor drives reconnection automatically with exponential backoff and full jitter (the AWS strategy to prevent thundering herds). Each cycle re-authenticates, re-subscribes to all active channels, and recovers missed messages using the offset and epoch from the last successful subscription.

**Token refresh** runs without interrupting the connection. The actor schedules a refresh before the token expires, calls a user-supplied async callback, and silently rotates the credential. Both connection tokens and per-subscription tokens support this. If the callback fails, the actor retries with backoff rather than disconnecting.

**Delta compression** is supported via the Fossil SCM delta algorithm. When a channel is configured with `force_recovery` and delta mode on the server, publications arrive as diffs rather than full payloads. The client reconstructs each message by applying the delta to the previous publication, reducing bandwidth significantly for large, frequently-updated payloads.

**Protocol encoding** is selectable at runtime. The default is newline-delimited JSON. Switching to Protobuf is one config line:

```rust
let config = ClientConfig::new("ws://localhost:8000/connection/websocket")
    .protocol_type(ProtocolType::Protobuf);
```

The codec layer is fully abstracted — the rest of the client never touches wire format directly.

## What Makes It Different

- **Full spec compliance** — 139/139 requirements from the Centrifuge Client SDK specification, including the less-common paths like server-side subscriptions, RPC, and pin-exact recovery semantics
- **Actor model** — single-threaded state machine eliminates the lock contention and race conditions common in async connection managers
- **Pluggable transport** — a `Transport` trait means you can swap out the WebSocket implementation or inject a mock for testing
- **Delta decompression** — built-in Fossil delta support for channels that use delta compression mode
- **Both TLS backends** — `native-tls` (default) or `rustls` via feature flags, for environments where one or the other is preferred
- **Thorough test suite** — unit tests, actor-level state machine tests with mock transports, and integration tests that spin up a real Centrifugo server via testcontainers

## Tech Stack

- **Language:** Rust (edition 2024, MSRV 1.85)
- **Async runtime:** tokio
- **WebSocket:** tokio-tungstenite
- **Serialization:** serde + serde_json (JSON), prost (Protobuf)
- **Error handling:** thiserror
- **Observability:** tracing
- **Integration tests:** testcontainers (Docker-based Centrifugo server)
- **Distribution:** `cargo add centrifuge-client` ([crates.io](https://crates.io/crates/centrifuge-client))
