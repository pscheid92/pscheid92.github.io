---
title: pgharden
description: "Security hardening and CIS benchmark auditing tool for PostgreSQL. Scan your database configuration and get actionable recommendations."
language: Go
github: https://github.com/pscheid92/pgharden
kind: CLI
topics: [security, cis-benchmark, postgresql, cli, hardening]
---

## Why I Built This

I saw the release of [pgdsat](https://github.com/darold/pgdsat) 2.0 and wanted to use it to audit my operator-managed PostgreSQL instances (Zalando Operator, CloudNativePG). The problem: pgdsat is a Perl tool that breaks when system libraries are missing or filesystem access isn't available — which is the norm in containerized and cloud-managed deployments. I wanted something that ships as a single binary, detects missing capabilities gracefully, and respects that managed platforms like RDS or Aurora have different sane defaults.

## What It Does

pgharden runs **90 security checks** across 8 categories against a live PostgreSQL connection:

1. **Installation and Patches** — repositories, systemd, checksums, version, extensions
2. **Directory and File Permissions** — umask, PGDATA, pg_hba.conf, socket permissions
3. **Logging and Auditing** — log destinations, syslog, pgAudit, debug settings
4. **User Access and Authorization** — superusers, SECURITY DEFINER, RLS, public schema
5. **Connection and Login** — authentication methods, SSL, CIDR ranges, password encryption
6. **PostgreSQL Settings** — runtime parameters, TLS, ciphers, FIPS, timeouts
7. **Replication** — replication users, WAL archiving, streaming parameters
8. **Special Configuration** — backup tools, external file references

## Key Design Decisions

- **Environment-aware** — auto-detects platform (bare metal, container, managed cloud), PostgreSQL version, and user privileges. Checks that can't run are gracefully skipped rather than failing.
- **Source-attributed** — each check declares its origin (currently CIS PostgreSQL 16 Benchmark). Filter with `--source cis` to run only benchmark checks.
- **Three output formats** — colored terminal text for interactive use, JSON for CI/CD pipelines, and self-contained HTML reports for sharing with teams.
- **Zero dependencies** — single static binary, connects via pgx. No `psql`, no Perl, no runtime needed.

## Architecture

**Check system** uses a registry pattern. Each check implements a common interface with an ID, CIS benchmark reference, platform/privilege requirements, and a `Run` method. A reusable `SettingCheck` type eliminates boilerplate for the 28 checks that compare PostgreSQL settings against expected values, supporting comparators like `eq`, `neq`, `contains`, and `oneof`.

**Environment detection** runs before any checks. It queries the database to determine PostgreSQL version, user privileges (superuser, RDS superuser, pg_monitor), and platform. Platform detection follows a priority chain: RDS/Aurora (via `rds_superuser` role and `aurora_version()`), Kubernetes (via archive/restore command patterns), container (`.dockerenv` or cgroup markers), or bare metal as fallback. Checks that can't run on the detected platform or privilege level are gracefully skipped with a reason.

**HBA parsing** supports `include`, `include_if_exists`, and `include_dir` directives with loop detection (max depth 10). On PostgreSQL 15+, it reads from the `pg_hba_file_rules` system view; on older versions, it falls back to filesystem access.

**Exit codes** are CI/CD-friendly: 0 for all checks passed, 1 for critical findings, 2 for non-critical failures.

## Usage

```bash
# Run a scan
pgharden -H localhost -U postgres -d postgres

# HTML report
pgharden -H localhost -U postgres -d postgres -f html -o report.html

# Only CIS benchmark checks
pgharden -H localhost -U postgres -d postgres --source cis

# Only logging section
pgharden -H localhost -U postgres -d postgres --section 3
```

Works out of the box against RDS, Aurora, containers, and non-superuser roles.

## Tech Stack

 - **Language:** Go
 - **Database driver:** pgx (pure Go, no C dependencies)
 - **Build:** Single static binary, no runtime dependencies
