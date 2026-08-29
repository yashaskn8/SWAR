# SWAR backend domain workflows

Status: Phase I implemented contract  
Date: 2026-08-29  
Authority: `FR-CALL-001..006`, `FR-ENR-001..005`, `FR-INT-001..005`, `FR-AUD-001..003`, `NFR-PRIV-001..003`, and `NFR-SEC-001..003`.

Phase I implements transport-neutral NestJS application services and provider ports. It does not expose public HTTP, WebSocket, or frontend contracts; those belong to Phase J. It also contains no model execution, model score interpretation, risk threshold, or temporal risk policy.

## Authoritative state and tenant boundary

The executable transition maps in [`domain-state-machines.ts`](../../backend/src/modules/domain/domain-state-machines.ts) mirror the frozen [domain state machines](../data/state-machines.md). Every unlisted transition throws `IllegalDomainTransitionError`. Durable mutations use the Phase F tenant repositories, optimistic current-state checks, scoped idempotency keys, and serializable transactions where multiple records change together.

Every actor-facing workflow accepts an authenticated `AuthPrincipal`, evaluates the Phase G permission matrix before reading or mutating a tenant resource, and passes `organizationId` from the principal to the repository. Internal lifecycle handlers derive the tenant only after resolving an exact server-authorized room and participant identity.

## Workflow ownership

| Workflow | Service or port | Phase I guarantee |
|---|---|---|
| Call create, invite, answer, and end | [`CallsService`](../../backend/src/modules/calls/calls.service.ts) | Server-generated room and participant identities, role-specific least-privilege grants, authorized actor checks, idempotent persistence, and explicit cleanup states. |
| LiveKit room and participant control | [`LiveKitPort`](../../backend/src/integrations/livekit/livekit.port.ts) | Room creation/closure, participant removal, short-lived grants, and signed webhook verification remain behind a replaceable adapter. |
| Caller-track binding | [`TrackBindingService`](../../backend/src/modules/media/track-binding.service.ts) | Only a signature-verified lifecycle event may bind the exact authorized room, server participant identity, microphone track SID, and binding revision. Display metadata is never authoritative. |
| Analysis session control | [`AnalysisService`](../../backend/src/modules/analysis/analysis.service.ts) and [`MlControlPort`](../../backend/src/integrations/ml/ml-control.port.ts) | The backend authorizes the exact call/participant/track/binding tuple and retains state ownership; ML attaches or clears transient analysis only through the port. |
| Consent and voiceprint lifecycle | [`TrustedSpeakersService`](../../backend/src/modules/trusted-speakers/trusted-speakers.service.ts) | Explicit consent is required; revocation and deletion immediately revoke use, invalidate sessions, and make deletion clear ciphertext. |
| Transient enrollment | [`VoiceEnrollmentService`](../../backend/src/modules/voice-enrollment/voice-enrollment.service.ts) | Audio and plaintext embeddings are memory-only, cleared on every completion/error path, and an encrypted envelope is committed only after an atomic consent recheck. |
| Security-event publication | [`SecurityEventsService`](../../backend/src/modules/security-events/security-events.service.ts) | Approved event names, stable retry IDs, schema versions, and non-sensitive metadata are sent through a replaceable publisher port. |
| Protected-action intervention | [`InterventionsService`](../../backend/src/modules/interventions/interventions.service.ts) and [`InterventionPort`](../../backend/src/modules/interventions/intervention.port.ts) | Hold/release is authorized, idempotent at the provider boundary, and fail-closed without claiming a real enterprise integration. |
| Audit | [`AuditService`](../../backend/src/modules/audit/audit.service.ts) | Workflow success, rejection-relevant provider uncertainty, and cleanup failure use stable non-sensitive action/reason codes. |

## Provider failure and recovery contract

| Failure | Durable state after failure | Recovery behavior |
|---|---|---|
| LiveKit room creation fails | Call is `FAILED` and audited. | Start a new authorized call command; never represent the failed call as active. |
| Participant grant fails | Authorized participant record remains auditable. | Retry the same invitation idempotently after provider recovery or end the call. |
| ML analysis start is unknown/timed out | Session remains `STARTING`. | Retry the same exact session grant; the provider operation must be idempotent. |
| ML analysis stop is unknown/timed out | Session remains `STOPPING`, or is already durably `REVOKED` for binding/consent removal. | Retry cleanup; never accept new evidence for a revoked/superseded binding. |
| Security-event publication fails | Authoritative domain state remains committed and a publish-failure audit is recorded. | Retry with the same event idempotency key and therefore the same event ID. |
| Protected-action hold fails or times out | Intervention does not advance to `IN_PROGRESS`. | Keep the protected state and retry or escalate through an approved adapter. |
| Protected-action release fails or times out | Intervention remains `IN_PROGRESS`. | Continue the hold and retry only after independent verification remains valid. |

Provider exception text is not copied into audit metadata or public error payloads. The `DomainProviderError` identifies only the provider class, operation, and recoverable authoritative state.

## Demo-only protected-action adapter

[`DemoTransactionHoldAdapter`](../../backend/src/modules/interventions/demo-transaction-hold.adapter.ts) identifies every result as `SWAR_DEMO_TRANSACTION_HOLD`. It is an in-memory, fictional-action adapter for the SIH workflow demonstration, implements the same `InterventionPort` as a future enterprise provider, and refuses production construction. It is not a bank-core, payment-network, or legal-compliance integration.

## Security and privacy invariants

- Voice audio, transient embeddings, and encrypted voiceprints are sensitive biometric-like data.
- Enrollment audio and plaintext embeddings are zeroed and released after inference, validation failure, persistence conflict, or provider failure; raw audio is not persisted.
- Voiceprints use AES-256-GCM envelopes with a configured key version; no key, ciphertext, embedding, audio, token, provider exception, or call content is logged.
- Consent and voiceprint state is checked again inside the activation transaction, closing the revoke-during-enrollment race.
- LiveKit grants are bounded and least-privilege. The restricted ML profile may subscribe but cannot publish media/data or update participant metadata.
- Track republish supersedes the old binding and revokes its analysis sessions before a new binding revision becomes authoritative.
- The workflow layer contains no model scores, thresholds, detector outputs, or duplicate business risk engine.

## Verification and remaining validation

The focused test suite is [`domain-workflows.spec.ts`](../../backend/tests/unit/domain/domain-workflows.spec.ts). It enumerates all legal/unlisted state transitions and covers signed LiveKit input, least-privilege grants, server identities, authorization before provider access, provider compensation, analysis recovery, track republish, consent races, memory clearing, stable event retries, and demo intervention behavior.

VALIDATION REQUIRED:

- Phase P must supply and contract-test the real ML control adapter and LiveKit raw-track subscriber.
- Phase J must define the machine-readable REST, realtime, webhook, and backend-ML schemas without duplicating these domain types.
- Phase Q must supply temporal risk policy, intervention creation rules, event delivery/outbox integration, and a non-demo operational intervention configuration.
- LiveKit grant duration and analysis-session duration remain bounded engineering configuration pending measured end-to-end validation.
- A contracted enterprise protected-action adapter remains a future integration; the demo adapter must never be described as one.
