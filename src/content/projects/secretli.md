---
title: Secretli
description: "Zero-knowledge, end-to-end encrypted secret sharing, in the browser and on the command line. Share passwords, notes and files through a link that opens once — the server never sees the plaintext."
language: TypeScript
secondaryLanguage: Go
github: https://github.com/secretli
liveUrl: https://secretli.app
kind: Live
topics: [encryption, zero-knowledge, pake, react, golang, cli, self-hosted]
---

## Why I Built This

At DeepL, we regularly received user documents to reproduce reported issues. People either uploaded them to the JIRA ticket — where they sat in plaintext, readable by anyone with access — or used [magic-wormhole](https://magic-wormhole.readthedocs.io/) to send files directly between developers, which meant asking around who still had a copy on their machine.

I had previously built a tool inspired by the [1Password Security Whitepaper](https://1passwordstatic.com/files/security/1password-white-paper.pdf) for sharing text snippets securely. I repurposed it to also handle file uploads, so we could drop share links into JIRA tickets or Slack without exposing the actual data. Secrets self-delete after a configurable period — the internal version allowed up to a year, the public version caps at 7 days to limit data growth.

## How It Works

The entire encryption model rests on one value: a 32-byte random **share secret** that travels only in the link.

**Key derivation** uses two primitives, each for what it's good at:

- **HKDF-SHA512** expands the high-entropy share secret into independent values, each with its own label: a **public ID** (the address the server files the secret under), a **metadata token** and a **metadata key**, a **blob key** and a **blob token** for the content, and a **password salt**.
- **scrypt** handles low-entropy input. With a password, the blob key and blob token come from scrypt (N=2¹⁴, r=8, p=1) over the password instead of from the share secret. Anyone with the link can read the metadata and see that a password is needed, but only someone who knows it can derive the token the server demands for the content — and the server can't tell a wrong password from a wrong link.

The **deletion token** is 32 random bytes, derived from nothing. It is the one thing the owner has and recipients don't.

**Encryption** uses **XChaCha20-Poly1305**, an authenticated cipher with a 24-byte random nonce per message, so nonce collisions are not a concern even at scale. The content is a **bundle**: every file is cut into 4 MiB chunks, and each chunk is sealed on its own, with authenticated additional data that binds it to the secret, its file, its position and its size. A chunk that is moved, duplicated or cut off fails to open, so the bundle needs no checksum of its own. An encrypted manifest and a small footer at the end say where everything is, so a recipient reads the bundle by byte range, and neither side ever holds a large file in memory. A text secret is simply a bundle of one file.

**Sharing** works through the URL fragment. The link looks like `/s#<share secret>`, and the owner's link adds `!<deletion token>`. Browsers never send the `#` fragment to the server — this is the security boundary the whole model relies on. The recipient's browser re-derives the keys from the fragment, fetches and decrypts locally.

The server only ever sees the public ID, the tokens (and stores only their SHA-256 hashes) and ciphertext. It cannot decrypt anything, even if compromised. The whole format is written down as a [specification](https://github.com/secretli/format/blob/main/spec/FORMAT.md), with test vectors that both the Go and the TypeScript implementation must reproduce.

## Handing a Link Over With a Code

Typing a long link from one device into another is no fun. Instead, a link can travel as a short code like `7-acid-rocket`: a number that names the transfer, and two words drawn from the EFF's short word list.

The two devices run **CPace**, a password-authenticated key exchange (over ristretto255, following the IETF draft), through the server's relay with the two words as the password. The sender hands the link over only once the receiver has proved it typed the same words, and the link travels encrypted with a key only the two devices can derive. The relay sees public values and one fixed-size ciphertext; it never learns the words or the link. A code works once and for ten minutes, so someone guessing gets a single try at odds of about one in 1.7 million.

It works between the web app and the command line in either direction.

## Features

- **Text and files** — up to 1 GiB; several files travel together in one encrypted bundle
- **Opens once** — by default; a secret can also stay until it expires
- **Password protection** — the content needs the password on top of the link
- **Configurable expiration** — from 5 minutes to 7 days
- **Handover with a code** — move a link to another device by typing a short code
- **Owner status** — the owner link tells you what became of a secret: opened (and when), expired, or deleted
- **QR codes** — every link has one, and the Open page can scan one with the camera where the browser allows it
- **Installable** — add it to your home screen or dock; on Android, share text from any app straight into it
- **Command line** — the `secretli` command shares, opens, checks and deletes secrets and hands links over with codes; its links open in the web app and the other way round, and `--copy` puts an opened secret on the clipboard and clears it again after 45 seconds

## Architecture

The project lives in its own [GitHub organization](https://github.com/secretli), with one repository per part: the **format** (specification, Go and TypeScript libraries, test vectors), the **server** (the API), the **web** app, the **cli**, and **e2e**, which tests them all together.

**Storage** is split by purpose: PostgreSQL holds metadata (public ID, token hashes, the encrypted metadata, expiry) while encrypted bundles go to S3-compatible storage (Hetzner Object Storage). Uploads arrive in parts, each with its SHA-256; downloads are byte ranges within a short-lived retrieval session that the blob token opens.

**Cleanup** runs as a background worker every minute. It selects expired and used-up secrets with `FOR UPDATE SKIP LOCKED` to avoid contention, deletes the bundle first, then the row. For a week afterwards a tombstone remains — no content, just what happened and when — so the owner link can still tell the story.

**Authentication** is token-based with no user accounts. Each request carries the token for what it wants: the metadata token to read the metadata, the blob token to open a retrieval session, the deletion token to delete. The server compares hashes in constant time to prevent timing attacks.

**Rate limiting** applies per endpoint and per visitor.

## Testing

Every test lives with the code whose change would break it. Each repository has its own unit and integration tests; the server has black-box API tests against the real binary; the command line's and the web app's suites also run against a real server, not a mock. The **e2e** repository puts the whole setup behind a gateway like production's and runs both clients through it — the newest command line and the oldest one still supported — before the server or the web app may deploy and before the command line may release. After every deploy, and every hour, a smoke test checks the live site.

## Deployment

Secretli runs on my self-hosted [k3s cluster](/projects/k8s-cluster/) on Hetzner, managed through GitOps with FluxCD. The server and the web app ship as separate images to GitHub Container Registry; merging to `main` is the release. FluxCD picks up the new image, rolls it out, and once it's healthy announces the deploy to the e2e repository, which runs the smoke test against production. Command-line releases are tagged, with build attestations for every binary.

## Tech Stack

- **Format:** Go and TypeScript; golang.org/x/crypto and ristretto255 in Go, @noble/ciphers, @noble/hashes and @noble/curves in TypeScript
- **Backend:** Go, Echo, PostgreSQL (pgx), S3-compatible storage (Hetzner Object Storage), Prometheus metrics
- **Frontend:** React, TypeScript, Vite, Tailwind CSS, served by nginx
- **Command line:** Go, cobra
- **Infrastructure:** k3s, FluxCD, CloudNativePG, Envoy Gateway, cert-manager, Grafana Alloy
