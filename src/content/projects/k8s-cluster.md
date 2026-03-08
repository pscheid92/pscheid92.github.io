---
title: k8s Cluster
description: "Production Kubernetes cluster on Hetzner running k3s, fully managed through GitOps with FluxCD. Hosts all my live projects with automatic TLS, database operators, and observability."
language: YAML
kind: Infrastructure
topics: [kubernetes, k3s, fluxcd, gitops, envoy-gateway, cert-manager]
---

## Why I Built This

I've worked with Kubernetes at nearly every employer and wanted to understand it more deeply — not just as a user deploying workloads, but as the person responsible for the full stack: networking, TLS, database operators, GitOps, observability. Running my own cluster on a single Hetzner VPS with k3s gives me that, and FluxCD means every change is a git commit.

## What It Runs

This cluster hosts [Secretli](/projects/secretli/) and [ChatPulse](/projects/chatpulse/) in production, with all infrastructure managed declaratively:

- **FluxCD** — GitOps controller that reconciles the cluster state from a Git repository.
- **Envoy Gateway** (v1.6.2) — Kubernetes Gateway API implementation for HTTP routing and TLS termination.
- **cert-manager** (v1.17.1) — Automatic TLS certificates from Let's Encrypt via Cloudflare DNS-01 challenges.
- **CloudNativePG** (v0.27.1) — PostgreSQL operator managing database instances with automated failover and backups. Runs PostgreSQL 18.
- **Dragonfly Operator** (v1.4.0) — Operator for Dragonfly, a Redis-compatible in-memory store.
- **Grafana Alloy** (v1.6.0) — Metrics collection (kubelet, cAdvisor, pod metrics) shipped to Grafana Cloud.
- **SOPS** — Secrets encrypted at rest in the Git repository using age keys.
- **Image Automation** — FluxCD watches GitHub Container Registry for new image tags, updates manifests, and commits back to the repo. Push an image and the cluster deploys it automatically.

## How It Works

The repository follows a layered structure: controllers (operators and system components), configs (networking, TLS, gateway), monitoring, and apps. Flux ensures each layer is healthy before deploying the next — controllers before configs, configs before apps. Adding a new app is as simple as creating a directory with a Deployment, Service, and HTTPRoute, then pushing to `main`.

## Key Design Decisions

- **k3s over full Kubernetes** — lightweight single-binary distribution, perfect for a single-node setup. Ships with containerd and CoreDNS, skips the overhead of a full control plane.
- **Gateway API over Ingress** — the newer, more expressive routing standard. Envoy Gateway implements it natively.
- **Operators over manual management** — CloudNativePG and Dragonfly handle the lifecycle of stateful workloads (provisioning, backups, version upgrades) that I don't want to manage by hand.
- **SOPS over external secret stores** — secrets live in the same Git repo as everything else, encrypted with age keys. Simple, auditable, no extra infrastructure.
- **DNS-01 over HTTP-01** — TLS certificates are provisioned via Cloudflare DNS-01 challenges, enabling wildcard certificates (`*.k.patrickscheid.de`) without exposing HTTP challenge endpoints.
- **Date-based image tags** — images are tagged `YYYYMMDD-HHMMSS-<sha>` instead of `latest` or semver. Alphabetical ordering means FluxCD can auto-detect the newest image without complex version parsing.

## Tech Stack

 - **Platform:** k3s on Hetzner VPS
 - **GitOps:** FluxCD
 - **Networking:** Envoy Gateway, cert-manager (Let's Encrypt)
 - **Data:** CloudNativePG (PostgreSQL 18), Dragonfly Operator
 - **Observability:** Grafana Alloy → Grafana Cloud
 - **Secrets:** SOPS with age encryption
