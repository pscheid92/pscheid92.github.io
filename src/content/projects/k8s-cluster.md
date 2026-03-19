---
title: k8s Cluster
description: "Production Kubernetes cluster on Hetzner running k3s, fully managed through GitOps with FluxCD. Hosts all my live projects with automatic TLS, database operators, messaging, identity management, and observability."
language: YAML
kind: Infrastructure
topics: [kubernetes, k3s, fluxcd, gitops, envoy-gateway, cert-manager, kafka, scylladb, zitadel, seaweedfs]
---

## Why I Built This

I've worked with Kubernetes at nearly every employer and wanted to understand it more deeply — not just as a user deploying workloads, but as the person responsible for the full stack: networking, TLS, database operators, messaging, identity, GitOps, observability. Running my own cluster on Hetzner with k3s gives me that, and FluxCD means every change is a git commit.

## What It Runs

The cluster runs on a 3-node Hetzner setup (4 CPU, 8 GB RAM each) and hosts [Secretli](/projects/secretli/) and [ChatPulse](/projects/chatpulse/) in production, with all infrastructure managed declaratively:

**Core Platform:**
- **FluxCD** — GitOps controller that reconciles the cluster state from a Git repository.
- **Envoy Gateway** (v1.6.2) — Kubernetes Gateway API implementation for HTTP routing and TLS termination.
- **cert-manager** (v1.17.1) — Automatic TLS certificates from Let's Encrypt via Cloudflare DNS-01 challenges.
- **SOPS** — Secrets encrypted at rest in the Git repository using age keys.
- **Image Automation** — FluxCD watches GitHub Container Registry for new image tags, updates manifests, and commits back to the repo.

**Data Layer:**
- **CloudNativePG** (v0.27.1) — PostgreSQL operator managing per-app database clusters with automated failover. Runs PostgreSQL 17/18.
- **Dragonfly Operator** (v1.4.0) — Operator for Dragonfly, a Redis-compatible in-memory store.
- **Strimzi** (v0.51.0) — Apache Kafka operator running a 3-broker KRaft cluster (Kafka 4.2.0) for event streaming. No ZooKeeper.
- **ScyllaDB Operator** (v1.20.1) — Runs a 3-node ScyllaDB 2026.1.0 cluster, a high-performance Cassandra-compatible database written in C++.
- **SeaweedFS Operator** (v0.1.13) — S3-compatible distributed object storage with built-in IAM, managed via a `Seaweed` CRD. Replaced MinIO after it entered maintenance mode.

**Identity & Auth:**
- **Zitadel** (v4.10.1) — Self-hosted identity provider (OIDC/OAuth2) for centralized authentication across all apps, backed by its own CNPG PostgreSQL cluster.
- **Resend** — Transactional email via SMTP for Zitadel notifications, sending from `notify.patrickscheid.de`.

**Observability & Tooling:**
- **Grafana Alloy** (v1.6.0) — Metrics collection (kubelet, cAdvisor, pod metrics) shipped to Grafana Cloud.
- **Redpanda Console** (v3.3.0) — Web UI for browsing Kafka topics, consumer groups, and messages.

## How It Works

The repository follows a layered structure: controllers (operators and system components), configs (networking, TLS, gateway), monitoring, and apps. Flux ensures each layer is healthy before deploying the next — controllers before configs, configs before apps. Adding a new app is as simple as creating a directory with a Deployment, Service, and HTTPRoute, then pushing to `main`.

## Key Design Decisions

- **k3s over full Kubernetes** — lightweight single-binary distribution. Ships with containerd and CoreDNS, skips the overhead of a full control plane.
- **3-node HA** — all nodes run as control-plane with etcd, providing redundancy for both the control plane and workloads.
- **Gateway API over Ingress** — the newer, more expressive routing standard. Envoy Gateway implements it natively.
- **Operators over manual management** — CloudNativePG, Dragonfly, Strimzi, ScyllaDB, and SeaweedFS operators handle the lifecycle of stateful workloads that I don't want to manage by hand.
- **One Kafka cluster, per-app databases** — Kafka is a shared messaging bus (apps isolate via topics), while each app gets its own PostgreSQL cluster with dedicated credentials and storage.
- **Centralized identity** — Zitadel provides a single OIDC/OAuth2 identity provider for all apps instead of per-app auth.
- **KRaft over ZooKeeper** — Kafka 4.2.0 runs in KRaft mode with combined controller+broker nodes, eliminating the ZooKeeper dependency.
- **ScyllaDB over Cassandra** — same CQL interface but written in C++, using a fraction of the memory compared to Java-based Cassandra.
- **SeaweedFS over MinIO** — MinIO community edition entered maintenance mode. SeaweedFS provides a Kubernetes-native operator with CRD-based lifecycle management and built-in IAM.
- **SOPS over external secret stores** — secrets live in the same Git repo as everything else, encrypted with age keys. Simple, auditable, no extra infrastructure.
- **DNS-01 over HTTP-01** — TLS certificates are provisioned via Cloudflare DNS-01 challenges, enabling wildcard certificates (`*.k.patrickscheid.de`) without exposing HTTP challenge endpoints.
- **Date-based image tags** — images are tagged `YYYYMMDD-HHMMSS-<sha>` instead of `latest` or semver. Alphabetical ordering means FluxCD can auto-detect the newest image without complex version parsing.

## Tech Stack

 - **Platform:** k3s on 3-node Hetzner cluster (12 CPU, 24 GB RAM total)
 - **GitOps:** FluxCD
 - **Networking:** Envoy Gateway, cert-manager (Let's Encrypt + Cloudflare)
 - **Data:** CloudNativePG (PostgreSQL 17/18), Dragonfly Operator, Strimzi (Kafka 4.2.0), ScyllaDB Operator, SeaweedFS (S3-compatible object storage)
 - **Identity:** Zitadel (OIDC/OAuth2) with Resend SMTP
 - **Observability:** Grafana Alloy → Grafana Cloud, Redpanda Console (Kafka UI)
 - **Secrets:** SOPS with age encryption
