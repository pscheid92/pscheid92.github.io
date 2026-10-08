---
title: k8s Cluster
description: "Production Kubernetes cluster on Hetzner running k3s, fully managed through GitOps with FluxCD. Hosts all my live projects with automatic TLS, database operators with point-in-time backups, and observability."
language: YAML
kind: Infrastructure
topics: [kubernetes, k3s, fluxcd, gitops, envoy-gateway, cert-manager, cloudnativepg, object-storage]
---

## Why I Built This

I've worked with Kubernetes at nearly every employer and wanted to understand it more deeply — not just as a user deploying workloads, but as the person responsible for the full stack: networking, TLS, database operators, object storage, GitOps, observability. Running my own cluster on Hetzner with k3s gives me that, and FluxCD means every change is a git commit.

## How It Works

The cluster hosts my live projects on three Hetzner nodes. Everything in it is declared in a Git repository and reconciled by FluxCD.

The repository follows a layered structure: controllers (operators and system components), configs (networking, TLS, gateway), monitoring, and apps. Flux ensures each layer is healthy before deploying the next — controllers before configs, configs before apps. Adding a new app is as simple as creating a directory with a Deployment, Service, and HTTPRoute, then pushing to `main`.

New releases roll out the same way: FluxCD watches GitHub Container Registry for new image tags, updates the manifests, and commits back to the repo.

## Key Design Decisions

- **k3s over full Kubernetes** — lightweight single-binary distribution. Ships with containerd and CoreDNS, skips the overhead of a full control plane.
- **3-node HA** — all nodes run as control-plane with etcd, providing redundancy for both the control plane and workloads.
- **Gateway API over Ingress** — the newer, more expressive routing standard. Envoy Gateway implements it natively and terminates TLS.
- **Operators over manual management** — CloudNativePG handles the lifecycle of PostgreSQL, including automated failover, so I don't manage stateful workloads by hand.
- **Per-app databases** — each app gets its own PostgreSQL cluster with dedicated credentials and storage instead of sharing one database server.
- **Managed object storage over self-hosted** — the cluster used to run SeaweedFS for S3. For one small bucket that meant ten pods to operate, and it kept each object on a single node. Hetzner Object Storage now holds the app files, outside the cluster.
- **Point-in-time recovery for databases** — CloudNativePG's Barman Cloud plugin streams PostgreSQL's WAL to object storage in a second Hetzner location and takes a nightly base backup, so any moment of the last 30 days can be restored. Restores are drilled, not assumed.
- **SOPS over external secret stores** — secrets live in the same Git repo as everything else, encrypted with age keys. Simple, auditable, no extra infrastructure.
- **DNS-01 over HTTP-01** — cert-manager provisions Let's Encrypt certificates via Cloudflare DNS-01 challenges, enabling wildcard certificates (`*.k.patrickscheid.de`) without exposing HTTP challenge endpoints.
- **Date-based image tags** — images are tagged `YYYYMMDD-HHMMSS-<sha>` instead of `latest` or semver. Alphabetical ordering means FluxCD can auto-detect the newest image without complex version parsing.
- **Metrics shipped out** — Grafana Alloy collects kubelet, cAdvisor, and pod metrics and ships them to Grafana Cloud, so the cluster doesn't run its own monitoring stack.

## Tech Stack

- **Platform:** k3s on Hetzner
- **GitOps:** FluxCD
- **Networking:** Envoy Gateway, cert-manager (Let's Encrypt + Cloudflare)
- **Data:** CloudNativePG with Barman Cloud backups, Hetzner Object Storage
- **Observability:** Grafana Alloy → Grafana Cloud
- **Secrets:** SOPS with age encryption
