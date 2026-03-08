---
title: Secretli
description: "Zero-knowledge, end-to-end encrypted secret sharing. Share passwords and sensitive data with a self-destructing link — the server never sees the plaintext."
language: TypeScript
secondaryLanguage: Go
github: https://github.com/pscheid92/secretli
liveUrl: https://secretli.k.patrickscheid.de/
kind: Live
topics: [encryption, zero-knowledge, react, golang, self-hosted]
---

## Why I Built This

At DeepL, we regularly received user documents to reproduce reported issues. People either uploaded them to the JIRA ticket — where they sat in plaintext, readable by anyone with access — or used [magic-wormhole](https://magic-wormhole.readthedocs.io/) to send files directly between developers, which meant asking around who still had a copy on their machine.

I had previously built a tool inspired by the [1Password Security Whitepaper](https://1passwordstatic.com/files/security/1password-white-paper.pdf) for sharing text snippets securely. I repurposed it to also handle file uploads, so we could drop share links into JIRA tickets or Slack without exposing the actual data. Secrets self-delete after a configurable period — the internal version allowed up to a year, the public version caps at 7 days to limit data growth.

## How It Works

The entire encryption model rests on one value: a 32-byte random `shareSecret` that never leaves the browser.

**Key derivation** uses a two-primitive approach, each chosen for what it's good at:

- **HKDF-SHA512** handles key expansion. From the high-entropy `shareSecret`, it derives three independent values using distinct info strings as domain separators: an **encryption key** (32 bytes), a **public ID** (16 bytes, used to address the secret on the server), and a **retrieval token** (16 bytes, used to authenticate fetches).
- **PBKDF2-SHA512** handles low-entropy input. When a password is set, PBKDF2 (210,000 iterations, per OWASP recommendation) stretches the password using the `shareSecret` as salt, producing key material that then feeds through the same HKDF pipeline. Without a password, the `shareSecret` already has full entropy, so only HKDF runs.

**Encryption** uses **AES-256-GCM** — an authenticated encryption cipher. Every ciphertext includes an authentication tag, so if anyone tampers with the blob on the server, decryption fails rather than silently producing corrupted data. Each encryption operation uses a fresh random 12-byte nonce. Content and metadata are encrypted separately with their own nonces.

**Sharing** works through the URL fragment. The browser builds a link like `/s#<shareSecret>` — the `#` fragment is never sent to the server by browsers. This is the security boundary the whole model relies on. The recipient's browser extracts the `shareSecret` from the fragment, re-derives the same keys, fetches the encrypted blob using the public ID and retrieval token, and decrypts locally.

The server only ever sees the public ID, retrieval token, and ciphertext. It cannot decrypt anything, even if compromised.

## Features

- **Text and file sharing** — upload files up to 100 MB; multiple files are zipped client-side
- **Burn after reading** — optionally destroy the secret after first view
- **Password protection** — adds a second encryption layer on top of the share link
- **Configurable expiration** — from 5 minutes to 7 days
- **QR codes** — every share link includes a scannable QR code
- **Manual deletion** — secret owners can delete before expiry

## Architecture

**Storage** is split by purpose: PostgreSQL holds metadata (public ID, retrieval token, encrypted metadata, expiration) while encrypted blobs go to S3-compatible storage (MinIO). This keeps the database lean and lets blob storage scale independently.

**Cleanup** runs as a background worker on a one-minute interval. It selects expired and burned secrets using `FOR UPDATE SKIP LOCKED` to avoid contention, deletes the blob from S3 first, then removes the database row.

**Authentication** is token-based with no user accounts. The retrieval token (derived client-side from the `shareSecret`) is sent as an `X-Retrieval-Token` header. The server compares it using constant-time comparison (`crypto/subtle.ConstantTimeCompare`) to prevent timing attacks. Deletion requires a separate `X-Deletion-Token` that only the secret creator has.

**Rate limiting** is applied per endpoint to prevent abuse.

## Deployment

Secretli runs on a self-hosted [k3s cluster](/projects/k8s-cluster/) on Hetzner, managed entirely through GitOps with FluxCD. The infrastructure includes CloudNativePG for PostgreSQL, automatic TLS via cert-manager and Let's Encrypt, and Envoy Gateway for routing. Metrics are collected by Grafana Alloy and shipped to Grafana Cloud. The app itself ships as a distroless Docker image published to GitHub Container Registry.

## Tech Stack

- **Backend:** Go, Echo, PostgreSQL, S3-compatible storage (MinIO), Prometheus metrics
- **Frontend:** React, TypeScript, Vite, Tailwind CSS, Web Crypto API
- **Infrastructure:** k3s, FluxCD, CloudNativePG, Envoy Gateway, cert-manager, Grafana Alloy
