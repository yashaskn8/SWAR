# ADR-005: Native No-Docker Development and Deployment Path

Status: Accepted  
Date: 2026-08-28  
Decision owners: SWAR delivery and architecture owner  
Requirements: NFR-COMP-001, NFR-SEC-003, NFR-REL-002

## Context

Docker cannot be installed on the development desktop, and the repository contract prohibits Dockerfile, Compose, Testcontainers, container-only setup, and CI that builds/runs project containers. SWAR still needs reproducible Node, Python, PostgreSQL, and LiveKit development plus a credible non-container deployment path.

## Decision

Use native tooling and processes:

- Android Studio/Gradle and devices/emulators;
- Node.js/npm for NestJS;
- Python virtual environments and `pyproject.toml` for FastAPI/PyTorch;
- native PostgreSQL service;
- native LiveKit server executable;
- PowerShell scripts for local start/stop/health in Phase D;
- native service managers/process managers for production-oriented deployment in Phase X.

Versions are pinned only after current official compatibility verification. Secrets remain outside source, and `.env.example` contains safe placeholders only. Production rejects development stubs and insecure default secrets.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Docker/Compose or Testcontainers | Explicitly prohibited and unavailable on the development desktop. |
| Kubernetes | Unnecessary for the SIH build and prohibited as prestige infrastructure. |
| Container-only production instructions | Would provide no usable path for the required native environment. |
| Replace PostgreSQL/LiveKit with mocks | Would fail the real persistence/media and binding acceptance gates. |

## Consequences and trade-offs

- Positive: the documented path is runnable on the actual development machine and aligns with the project contract.
- Positive: native service boundaries remain the same as the production-oriented architecture.
- Cost: Phase D must explicitly verify local versions, service startup, ports, secrets, health, and cleanup without relying on container isolation.
- Cost: CI/integration tests must use service installations or managed runners rather than Testcontainers.
- Student feasibility: fewer platforms are introduced; operational scripts must still be deterministic and safe.

## Compatibility

This ADR deploys the controlled LiveKit architecture in ADR-001, the subscriber binding in ADR-002, the NestJS/ML split in ADR-003, and the transient data rules in ADR-004 without changing them.
