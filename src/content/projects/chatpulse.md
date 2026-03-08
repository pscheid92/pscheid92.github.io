---
title: ChatPulse
description: "Real-time Twitch chat sentiment overlay for OBS. Track viewer mood as a live tug-of-war bar, powered by WebSocket streaming and real-time vote counting."
language: Go
github: https://github.com/pscheid92/chatpulse
liveUrl: https://chatpulse.patrickscheid.de
kind: Live
topics: [twitch, vote-counting, websocket, obs, docker, redis]
---

## Why I Built This

A streamer I watch — [freiraumreh](https://www.twitch.tv/freiraumreh) — was watching a documentary with her chat and floated the idea of a live sentiment scale: viewers type `+` or `-` to move a needle showing whether they agree or disagree with what's happening on screen. After that, I started noticing how many streamers use "post 1 or 2" to poll their chat, or games like [Songbattle](https://songbattle.io/) that rely on the same mechanic. The problem is always the same: when hundreds of messages fly past, nobody can actually tally them.

I was curious how to build this properly — sliding-window counting, real-time broadcast, scaling to high-throughput chat — so I built it.

## How It Works

ChatPulse is a multi-tenant service where a single bot account reads chat across all connected channels:

1. **Webhook ingestion** — Chat messages arrive via Twitch EventSub webhooks through a Conduit, verified with HMAC-SHA256.
2. **Vote processing** — Messages matching configurable trigger words are counted as votes (case-insensitive, one vote per user per second).
3. **Sliding-window counting** — Votes are stored in Redis Streams. Sentiment is computed over a configurable time window (5–120s), so old votes naturally expire.
4. **Real-time broadcast** — Updates are pushed to overlay clients via Centrifuge WebSocket with a Redis broker for cross-instance delivery.
5. **Client-side lerp** — The overlay uses `requestAnimationFrame` for smooth animation toward server ratios at zero server cost.

## Architecture

- **Single Go binary** (Echo v4) serving HTTP, WebSocket, and webhook endpoints
- **PostgreSQL 18** with auto-migrations for streamers, configs, and EventSub subscriptions
- **3-layer read-through cache**: in-memory (10s) → Redis (1h) → PostgreSQL, with pub/sub invalidation
- **Horizontal scaling** via Redis Streams for vote counting and Centrifuge Redis broker for WebSocket fan-out
- **Observability**: structured logging (slog) with correlation IDs, Prometheus metrics
- **Compensation logic** — if persisting an EventSub subscription to the database fails, the already-created Twitch subscription is rolled back to avoid orphaned state
- **Visual decay** — a background ticker refreshes sentiment snapshots every 2 seconds for active broadcasters, so old votes visually expire even without new messages arriving

## Features

- **Two display modes** — combined tug-of-war bar or split positive/negative bars
- **Customizable triggers and labels** for "for" and "against" votes
- **Indefinite mode** — setting the time window to infinity (12h internally) turns it into a persistent poll
- **Session fixation prevention** — regenerates session ID after OAuth login
- **Overlay URL rotation** to invalidate old URLs
- **Zero-cost idle** — skips processing when no overlay viewers are connected
- **Per-IP rate limiting** on all route groups
- **Security headers** (HSTS, CSP, X-Frame-Options)

## Deployment

ChatPulse runs on a self-hosted [k3s cluster](/projects/k8s-cluster/) on Hetzner, managed through GitOps with FluxCD. PostgreSQL is operated by CloudNativePG, Redis by the Dragonfly Operator. Routing goes through Envoy Gateway with automatic TLS via cert-manager. Metrics are collected by Grafana Alloy and shipped to Grafana Cloud.

## Tech Stack

 - **Backend:** Go, Echo, PostgreSQL, Redis, Centrifuge WebSocket
 - **Frontend:** Minimal HTML/CSS/JS with no external dependencies, embedded via `go:embed`
 - **Infrastructure:** k3s, FluxCD, CloudNativePG, Dragonfly Operator, Envoy Gateway, cert-manager, Grafana Alloy
