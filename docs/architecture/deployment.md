# SWAR Native Deployment Architecture

Status: FROZEN - Phase B  
Date: 2026-08-28

## Deployment decision

SWAR uses native processes and services. Docker, Docker Compose, Testcontainers, container-only setup, and Kubernetes are prohibited for the SIH build. Detailed installation and version pinning belong to Phase D/X after official compatibility verification.

## Native development topology

```mermaid
flowchart TB
    subgraph Workstation[Native development workstation]
        Android[Android Studio and devices/emulators]
        Node[Node.js and npm process\nNestJS]
        Python[Python virtual environment\nFastAPI, PyTorch and LiveKit RTC]
        PG[(Native PostgreSQL service)]
        LK[Native LiveKit server executable]
        PS[PowerShell start, stop and health scripts\nPhase D]
    end

    PS -->|Local process control; OS user authorization; service arguments and health endpoints| Node
    PS -->|Local process control; OS user authorization; virtual-environment command and health endpoints| Python
    PS -->|Native service control; OS/database authorization; start and health status| PG
    PS -->|Native process control; OS user authorization; LiveKit config path and health status| LK
    Android -->|HTTPS/WSS plus WebRTC; development credentials and participant JWTs; API/events/media| Node
    Android -->|WebRTC DTLS-SRTP; short-lived participant JWT; media and track metadata| LK
    Node -->|PostgreSQL protocol; development DB role; tenant metadata and transactions| PG
    Node -->|HTTPS/TLS where configured; LiveKit API credential; room/grant commands| LK
    Node -->|Private HTTP loopback in development or HTTPS when configured; development service credential; analysis commands/evidence| Python
    Python -->|WebRTC DTLS-SRTP; subscribe-only participant JWT; bound caller frames| LK
```

Development may use loopback HTTP only where Phase D explicitly documents the local trust boundary and production-equivalent service authentication. Non-loopback and production traffic requires TLS. Safe placeholder secrets may be documented in `.env.example`; real secrets never enter source.

## Production-oriented non-container topology

```mermaid
flowchart LR
    Edge[Enterprise TLS and WebRTC ingress]
    Nest[NestJS native service\nmanaged process/service account]
    PG[(Native/managed PostgreSQL\nleast-privilege DB role)]
    LK[LiveKit native service\nmedia service account]
    ML[FastAPI/PyTorch native service\nrestricted analysis account]
    Keys[Approved secret/key store]

    Edge -->|HTTPS/WSS over TLS; user JWT and RBAC; public API and security events| Nest
    Edge -->|WebRTC DTLS-SRTP; short-lived participant JWT; authorized media| LK
    Nest -->|PostgreSQL protocol over TLS; DB service credential; tenant-scoped transactions| PG
    Nest -->|LiveKit server API over HTTPS/TLS; API credential; rooms, grants and lifecycle control| LK
    LK -->|HTTPS/TLS; verified webhook signature; participant and track lifecycle| Nest
    Nest -->|Private HTTPS/TLS; backend service credential and analysis grant; analysis/session commands| ML
    ML -->|Private HTTPS/TLS; ML service credential and idempotency key; versioned evidence/errors| Nest
    ML -->|WebRTC DTLS-SRTP; subscribe-only participant JWT; bound caller frames| LK
    Keys -->|Authenticated secret/key interface; service identity; runtime secrets and voiceprint encryption operations| Nest
    Keys -->|Authenticated secret interface; service identity; approved checkpoint access when required| ML
```

## Process and persistence rules

| Process/service | Run identity | Persistence | Restart behavior |
|---|---|---|---|
| NestJS | Dedicated least-privilege service account | PostgreSQL only for durable state; structured non-sensitive logs | Reconcile calls/bindings/holds before accepting evidence after restart. |
| PostgreSQL | Dedicated database service identity | Approved durable metadata and encrypted voiceprints | Backups/restores must preserve tenant scope and encryption metadata; no raw audio. |
| LiveKit | Dedicated media service identity | Runtime/config state; SWAR recording disabled by default | Lifecycle reconciliation with NestJS; participant grants remain short-lived. |
| FastAPI/PyTorch | Dedicated restricted analysis account | Governed checkpoints/config only; no call audio/session persistence | All per-call buffers lost/cleared; require new authorized analysis session. |
| Android/React | End-user context | Secure session/client state only | Reauthenticate/reconnect and fetch authoritative current state. |

## Network segmentation

- Public: NestJS HTTPS/WSS and LiveKit WebRTC/signalling only.
- Private: PostgreSQL and FastAPI; no direct frontend routes.
- Management: native service/health/secret operations under operator least privilege.
- Data: decoded audio is confined to LiveKit runtime and ML memory; voiceprint ciphertext is confined to NestJS/PostgreSQL/key boundary.

## Scaling and feasibility

The SIH target is a native single-node or small fixed deployment using PostgreSQL-backed or single-process coordination, with no Redis requirement. Supported concurrency, hardware, model placement, latency, and restart recovery remain `VALIDATION REQUIRED` for Phases D/O/Y. Future regional/on-premises pools or SIP/contact-centre adapters require separate architecture decisions and do not alter the SIH scope.
