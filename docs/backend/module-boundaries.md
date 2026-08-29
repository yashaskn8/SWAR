# Backend platform module boundaries

Status: Phase H platform contract with Phase I domain boundary  
Authority: `FR-API-001`, `FR-AUD-002`, `FR-AUD-003`, `NFR-SEC-001`, and the frozen Phase B component architecture.

## Dependency direction

The backend uses one-way dependencies:

1. `config/` validates process configuration and imports no feature module.
2. `database/` owns Prisma lifecycle and transactions; it imports no controller or feature service.
3. `common/` owns transport-neutral errors, validation, logging, request context, guards, and idempotency support. Compatibility guard entry points may re-export the Phase G auth guards, but common platform services do not call domain workflows.
4. `modules/auth/` and `modules/health/` may use configuration, common services, and database providers.
5. Later domain feature modules may use configuration/common/database/auth abstractions, but must not import another feature controller or create dependency cycles.
6. Public and internal adapters remain separate. Frontends never call FastAPI or PostgreSQL directly.
7. Phase I application services may depend on auth, audit, configuration, repositories, and provider ports. Provider adapters must not call application services or own durable domain state.
8. The Phase I workflows expose no controller. Phase J may add transport adapters that call these services, but transport DTOs must not become the durable Prisma or provider contract.

The deterministic platform test constructs the relative TypeScript import graph and rejects cycles. Existing repository-boundary tests separately reject frontend, ML, container, and cross-layer imports.

## Platform contracts

- Public routes use `/api/v1`; operational health remains `/health` and `/health/ready`.
- Every error response is `{ code, message, requestId, details? }`. Details contain validated field names only and never stack traces or dependency messages.
- A syntactically valid incoming `x-request-id` may be propagated; otherwise the backend generates a UUID and returns it as `x-request-id`.
- Logs are newline-delimited JSON with allowlisted metadata. Authorization, cookies, tokens, passwords, secrets, embeddings, waveform/PCM/audio data, voiceprint material, ciphertext, database credentials, stack traces, and request bodies are excluded or redacted.
- Liveness never probes dependencies. Readiness probes PostgreSQL, the configured ML health endpoint, and LiveKit reachability using bounded timeouts.
- The Phase H idempotency service is a bounded single-process request replay/coalescing layer for explicitly selected non-sensitive responses. Durable domain mutations still require their PostgreSQL idempotency keys and transactions; the memory layer is never their source of truth.
- CORS uses an explicit origin allowlist. Wildcard-with-credentials is prohibited, and production origins/transports require TLS schemes.

## Stable platform error codes

| Condition | HTTP status | Code |
|---|---:|---|
| Invalid or malformed request | 400 | `VALIDATION_FAILED` |
| Authentication failure | 401 | Phase G authentication code |
| Authorization failure | 403 | `FORBIDDEN` |
| Missing tenant resource | 404 | `NOT_FOUND` |
| State or idempotency conflict | 409 | `CONFLICT` or `IDEMPOTENCY_KEY_CONFLICT` |
| Unsupported content type | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| Oversized body | 413 | `PAYLOAD_TOO_LARGE` |
| Rate limit | 429 | `RATE_LIMITED` or Phase G `AUTH_RATE_LIMITED` |
| Dependency timeout | 504 | `DEPENDENCY_TIMEOUT` |
| Dependency unavailable | 503 | `DEPENDENCY_UNAVAILABLE` |
| Unhandled failure | 500 | `INTERNAL_ERROR` |

## Validation required

- Production CORS origins and TLS termination addresses require deployment approval.
- Readiness polling intervals and platform timeout values require measurement on the deployment network; environment values are engineering configuration, not performance claims.
- Multi-node HTTP replay caching would require a separately approved shared store or database design. The SIH single-node layer does not claim cross-process replay.
- The Phase I workflow and provider boundaries, recovery states, privacy invariants, and demo-adapter restriction are specified in [Backend domain workflows](domain-workflows.md).
