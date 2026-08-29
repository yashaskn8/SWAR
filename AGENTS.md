SWAR Repository Engineering Contract

This file governs every coding-agent operation in the SWAR repository. It must remain at the repository root as AGENTS.md.

Contract version: 1.0.0
Architecture freeze date: 2026-08-28

1. Mandatory startup protocol

Before planning, editing, generating code, installing dependencies, running migrations, or changing configuration:

Read this file completely.

Search for any more specific AGENTS.md files below the target directory and read them completely.

Inspect the repository. Do not assume a file or implementation is absent.

Read the current phase prompt and every dependency artifact named by it.

Run the existing relevant tests and static checks when feasible before editing.

State any blocking inconsistency using the format in Section 4.

Implement only the current phase. Stop at its exit gate.

If this root file is missing, truncated, or unreadable, stop and report the problem. Do not reconstruct it from memory.

2. Project identity

Project: SWAR - Synthetic-voice Warning and Authentication in Real-time

Problem statement: SIH26104 - AI-Powered Real-Time Detection and Prevention of Voice Cloning Impersonation Attacks.

One-sentence product definition:

SWAR is an enterprise-controlled WebRTC voice-security system that checks whether a caller resembles the expected speaker, checks whether the speech appears synthetic, combines evidence over time, and warns or holds a sensitive action when impersonation risk becomes high.

The product is not a generic deepfake classifier. It is the combination of:

controlled secure calling,

expected-speaker verification,

synthetic-speech detection,

audio-quality awareness,

temporal risk reasoning,

user intervention,

enterprise security events,

privacy-preserving evidence handling.

3. Source-of-truth order

Resolve conflicts in this order:

The user's latest explicit instruction.

This root AGENTS.md.

Approved files under docs/requirements/, docs/architecture/, docs/contracts/, docs/security/, and docs/decisions/.

The submitted SIH presentation and technical report.

The active Phase A-Z implementation prompt.

Existing implementation details that do not conflict with higher sources.

Never silently redesign the system. If a higher source is technically impossible or internally inconsistent, use Section 4 and propose the smallest correction.

4. Required consistency-report format

Use exactly:

CONTRACT CONSISTENCY ISSUE
<exact conflicting or impossible requirement>

WHY IT MATTERS
<concrete technical, security, product, or delivery consequence>

MINIMAL CORRECTION
<smallest change that preserves the approved product intent>

Do not implement the correction unless the active phase or user authorizes it.

5. Non-negotiable product boundaries

5.1 Controlled calls only

SWAR protects calls inside an enterprise-controlled WebRTC environment such as a banking, fintech, enterprise-support, or executive-hotline application.

Do not claim or implement interception of arbitrary GSM, VoLTE, carrier, or third-party phone calls.

5.2 Real-time intervention, not zero-latency prevention

The target runtime uses approximately 4-second speech windows with approximately 1-second stride. Actual time-to-first-intervention is measured end to end.

Do not claim that the first word is blocked or that latency is a fixed number before measurement.

5.3 Backend first

Phases A-Q must pass before Phase R begins. Do not implement Android screens, React dashboard features, or frontend production code during Phases A-Q, except empty repository scaffolding and machine-readable API contract artifacts explicitly required by a phase.

Frontend implementation is allowed only in Phases R and S. Phase T connects the already completed layers.

6. Strict no-Docker rule

Docker cannot be installed on the development desktop.

Never add or require:

Dockerfile,

docker-compose.yml or compose.yaml,

docker build, docker run, or docker compose commands,

container-only local setup,

Testcontainers,

CI jobs that require the project to build or run its own containers.

Native local development uses:

Android Studio and Gradle,

Node.js and npm,

Python virtual environments and pip/pyproject,

native PostgreSQL,

native livekit-server executable,

PowerShell startup scripts.

Production examples must also provide a non-container path. Do not introduce Kubernetes for the SIH build.

7. Frozen repository ownership

project-root/
|-- frontend/        # Android and React UI/client code only
|-- backend/         # NestJS APIs, auth, business logic, DB access, jobs, integrations
|-- ml/              # Independent FastAPI/PyTorch inference and evaluation code
|-- infrastructure/  # Native setup, LiveKit/PostgreSQL/proxy/service configuration
|-- docs/            # Requirements, architecture, contracts, security, evaluation, demo
|-- tests/           # Shared contract and end-to-end tests only
|-- .github/         # Non-container CI workflows
|-- .env.example
|-- AGENTS.md
`-- README.md

Ownership rules:

frontend/ must never contain NestJS, FastAPI, Prisma, SQL, PyTorch, model checkpoints, server secrets, or risk-decision logic.

backend/ must never contain React, Jetpack Compose, Android resources, PyTorch models, waveform preprocessing, or model checkpoints.

ml/ must never authenticate end users, access PostgreSQL, own tenant authorization, choose transaction actions, or contain frontend code.

infrastructure/ contains configuration and startup/deployment scripts only, not domain logic.

tests/ at root contains only cross-service contract, media-binding, and end-to-end tests. Unit tests remain with their owning service.

Frontend communicates with NestJS only through documented public REST/WebSocket APIs and through the authorized WebRTC media plane. It never accesses PostgreSQL or FastAPI directly.

8. Approved technology stack

Frontend:

Android, Kotlin, Jetpack Compose, Coroutines/Flow, AndroidX Security.

LiveKit Android SDK as the WebRTC client implementation.

Retrofit or Ktor plus OkHttp WebSocket for documented backend communication.

React, TypeScript strict mode, Vite, TanStack Query, React Router, Vitest, Testing Library.

Backend:

Node.js, npm, TypeScript strict mode, NestJS.

Prisma and PostgreSQL.

JWT access tokens plus rotated/revocable refresh sessions.

Argon2id for password hashing.

Standard WebSocket through NestJS for security events.

Structured logs with request/correlation IDs.

PostgreSQL-backed or single-process scheduled jobs; no Redis requirement for the SIH single-node build.

ML service:

Python virtual environment, pyproject.toml, FastAPI, Pydantic.

PyTorch, NumPy, and verified audio-processing dependencies.

LiveKit Python RTC raw-track subscription.

ECAPA-TDNN for expected-speaker similarity.

RawNet2 for the fast spoof path.

AASIST for asynchronous deep spoof evidence.

Dependency versions must be verified against current official documentation before pinning. Model checkpoint licenses, sources, hashes, expected sample formats, and score direction must be verified before use.

Do not introduce Kafka, Kubernetes, a vector database, an LLM, RAG, blockchain, Redis, or another platform merely for prestige.

9. Frozen media and analysis path

Authenticated enterprise caller
  -> backend-authorized LiveKit room
  -> one published caller participant/track SID
  -> customer Android subscription
  -> restricted ML subscriber to the same participant/track SID
  -> transient PCM normalization and rolling windows
  -> ECAPA + RawNet2 fast evidence
  -> AASIST deep evidence
  -> NestJS risk policy and temporal state
  -> warning / hold / step-up / security event

NestJS controls call authorization, participant identity, short-lived room grants, signed webhook verification, and the binding among callId, roomName, participantIdentity, and trackSid.

The ML service must reject an analysis request if the participant or track does not match the backend-authorized binding.

The caller client must never self-assert the trusted employee identity used for risk decisions.

10. Model semantics

10.1 ECAPA-TDNN

ECAPA answers: "How similar is this speech to the enrolled expected speaker?"

It does not prove liveness or physical presence. A convincing AI clone of Rahul can produce high Rahul similarity. That is expected.

10.2 RawNet2 and AASIST

RawNet2 supplies fast synthetic/spoof evidence. AASIST supplies deeper asynchronous evidence.

Neither model automatically overrides the other. Raw model logits must not be presented as probabilities until their semantics and calibration are verified.

Every model result must include:

model name and version,

checkpoint hash,

score name and direction,

input window sequence and time range,

processing latency,

readiness/error state.

10.3 Audio quality

The ML service must estimate whether there is enough reliable speech. Noise, clipping, discontinuity, inadequate speech duration, unsupported format, and corrupt audio can produce INSUFFICIENT_EVIDENCE.

Poor audio must not automatically produce CRITICAL.

11. Risk contract

The approved user-facing states are:

Identity evidence

Spoof evidence

State

Meaning

High

Low

VERIFIED

Expected-speaker similarity with no strong spoof evidence

Low

Low

UNVERIFIED

Trusted identity not established; never call this SAFE

Low

High

HIGH_RISK

Strong spoof evidence without trusted identity confirmation

High

High

CRITICAL

Likely synthetic impersonation of the trusted identity

Technical model calibration belongs in ml/. Context-aware policy, temporal state, hysteresis, intervention, and audit belong in backend/.

Do not duplicate a second business risk engine in the ML service or frontend.

Initial engineering thresholds are provisional until validation. Store threshold and policy versions with every risk event.

12. Privacy and security rules

Obtain explicit consent before trusted-speaker enrollment.

Use several enrollment samples where the workflow permits.

Store encrypted embeddings, not reusable plaintext voiceprints.

Do not persist full call audio by default.

Keep live audio and trusted embeddings in memory only for the required session duration.

Clear transient buffers at call/enrollment termination and on error.

Never place raw audio, embeddings, access tokens, passwords, API secrets, or private call content in logs.

Scope every tenant-owned database operation by organization_id.

Prevent IDOR and cross-tenant access at service/repository boundaries, not only controllers.

Validate and authenticate LiveKit webhooks and backend-ML internal requests.

Use idempotency for evidence, risk events, call actions, and retries.

Apply least-privilege, short-lived media and analysis grants.

Support voiceprint consent revocation and deletion.

Say "privacy- and DPDP-aligned design" unless legal review establishes compliance.

13. Public and internal contracts

Public REST base path: /api/v1.

Required public operations include:

authentication session create, refresh, and revoke,

call create, join-token issue, and end,

trusted-speaker enrollment and voiceprint deletion,

active calls and risk-event queries,

step-up/callback verification,

authorized risk-policy retrieval/update.

Realtime endpoint: /ws/security.

Required server events include:

risk.state.changed,

intervention.required,

call.ended,

dashboard.risk-event.created.

Backend-ML contracts include:

analysis session create/stop,

ephemeral enrollment inference,

FAST evidence,

DEEP evidence,

INSUFFICIENT_EVIDENCE,

PIPELINE_ERROR.

Machine-readable contracts under docs/contracts/ are authoritative. Generate or validate client/service types from them. Add drift tests. Do not maintain hand-written duplicate schemas with different field names.

14. Minimum persistent entities

The domain model must account for:

organizations,

users,

organization memberships and roles,

devices,

refresh sessions,

trusted speakers,

enrollment consents,

encrypted voiceprints,

calls and call participants,

media tracks and track bindings,

analysis sessions,

risk policies,

risk events,

interventions and alerts,

model versions,

audit logs.

Do not add a persistent raw-call-audio entity unless the user explicitly changes the privacy contract.

15. No-bluff engineering policy

Never invent:

model accuracy, precision, recall, EER, FAR, FRR, or latency,

dataset availability, license, size, language coverage, or provenance,

model checkpoint compatibility or score semantics,

government or bank-core integrations,

production scale or legal compliance,

results from tests that were not run.

Classify uncertain statements as one of:

VERIFIED FROM PROJECT DOCUMENTS,

VERIFIED FROM EXTERNAL DOCUMENTATION,

ENGINEERING DECISION,

ASSUMPTION REQUIRING VALIDATION,

FUTURE ENTERPRISE INTEGRATION.

Use VALIDATION REQUIRED when evidence is missing. Do not conceal missing evidence with a plausible number.

16. Placeholder and development-stub policy

Production paths may not contain pass, unfinished TODO behavior, fake ML results, hardcoded risk outcomes, or mock API responses.

One narrow exception is allowed for the Phase M end-to-end development stub:

it must live in an explicitly named development/test module,

it must run only when both environment and provider settings select development/test stub mode,

every emitted event must be labelled as stub-generated,

production startup must fail if stub mode is selected,

tests must prove the production block,

the removal/replacement phase must be documented.

Test doubles remain allowed inside test code.

17. Configuration and secrets

.env.example documents required server variables with safe placeholders.

Commit no .env, Android signing key, JWT private key, LiveKit secret, database password, voiceprint key, or model-download credential.

Validate server environment variables at startup and fail with a precise error.

Frontend configuration may contain public base URLs only.

The Android app receives a short-lived room token, never a media-server API secret.

Use separate development/test/production modes. Production mode must reject development stubs and insecure default secrets.

18. Coding standards

General:

Prefer small cohesive modules with explicit interfaces.

Preserve existing naming, module patterns, and error envelopes unless the active phase changes the contract.

Keep functions typed and validate all external inputs.

Handle errors at the correct boundary. Do not swallow exceptions.

Use structured logs without sensitive payloads.

Make retries bounded and idempotent.

Do not edit unrelated user changes.

TypeScript/NestJS:

Enable strict TypeScript.

Use DTO validation and stable error codes.

Keep controllers thin; domain logic belongs in services/domain modules.

Keep Prisma access in repositories/services under backend/.

Use transactions for multi-record state changes.

Python/ML:

Use type hints for public interfaces.

Use Pydantic for service boundaries.

Make preprocessing deterministic where required.

Record random seeds, data manifest versions, model versions, and hashes.

Keep training/evaluation transformations consistent with inference.

Release tensors, sessions, audio buffers, and embeddings on close/error.

Frontend:

Use strict TypeScript and typed Kotlin DTOs.

Represent loading, empty, offline, permission, expired-session, and server-error states.

Do not compute trusted risk decisions locally.

Use text/icon status cues in addition to color.

Ensure scalable text, accessibility labels, and keyboard navigation on the dashboard.

19. Testing and verification contract

Every phase must add or update tests relevant to its changes. Do not say "test thoroughly".

The complete system ultimately requires:

unit tests,

database/repository integration tests,

API and contract tests,

auth/RBAC/tenant-isolation tests,

ML preprocessing/model-adapter tests,

calibration and OOD evaluation tests,

WebRTC participant/track-binding tests,

Android and dashboard tests,

shared E2E tests,

security tests,

performance and failure-recovery tests.

The four mandatory orchestration scenarios are:

Genuine trusted speaker: high identity + low spoof -> VERIFIED.

Unknown genuine speaker: low identity + low spoof -> UNVERIFIED.

Trusted voice clone: high identity + high spoof -> CRITICAL -> warning + hold.

Weak/insufficient audio -> continue monitoring without accusation.

These scenarios prove orchestration only. They do not prove scientific detector performance.

20. Phase execution rules

For every Phase A-Z prompt:

Verify that dependency-phase exit gates are complete.

If a dependency is incomplete, stop and list the missing artifacts. Do not bypass it.

Inspect existing files and reuse valid abstractions.

Give a concise implementation plan before editing.

Modify only files required for the active phase plus necessary contract/test/documentation updates.

Run relevant checks after editing.

Update docs/implementation/phase-status.md with evidence, not a bare DONE label.

Stop after satisfying the current phase acceptance criteria.

Do not start the next phase automatically.

A phase is complete only when applicable work is:

IMPLEMENTED + TESTED + INTEGRATED + DOCUMENTED + VERIFIED

21. Required phase handoff format

Every coding-agent phase response must end with:

Repository inspection summary.

Dependency-gate result.

Contract consistency issues, if any.

Files created or changed and why.

Contracts or migrations changed.

Tests/checks run, with actual outcomes.

Acceptance-criteria checklist.

Security/privacy verification.

Remaining VALIDATION REQUIRED items.

Exact next phase unlocked.

Do not claim success if a required command was not run. State the reason and the remaining verification command.

22. Safety and change control

Preserve unrelated user work and dirty-worktree changes.

Do not run destructive Git or filesystem commands unless the user explicitly requests them.

Do not delete migrations, model evidence, or data manifests to make a test pass.

Do not rotate or create real credentials without authorization.

Do not perform external deployment, messaging, or account changes unless explicitly requested.

Stop when permissions, credentials, legal consent, checkpoint license, or dataset license are required and unavailable.

23. Backend-first phase gate

The implementation order is mandatory:

A Requirements
-> B Architecture
-> C Repository
-> D Native environment
-> E Domain model
-> F Database
-> G Authentication
-> H Backend platform
-> I Domain workflows
-> J APIs/contracts
-> K Data acquisition/governance
-> L Audio preprocessing
-> M ML baseline and development loop
-> N Real model integration
-> O Evaluation/calibration
-> P ML serving and server-side media subscriber
-> Q Risk engine and interventions
-> R Frontend foundation
-> S Frontend workflows
-> T End-to-end integration
-> U Security hardening
-> V Complete test engineering
-> W MLOps and CI
-> X Native deployment
-> Y Observability and resilience
-> Z SIH readiness

Do not begin Phase R until the Phase Q exit gate proves that the backend can accept authenticated call/evidence events, compute stable risk state, create interventions, and publish versioned security events without a frontend.