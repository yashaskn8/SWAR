# SWAR Runtime Data Flows

Status: FROZEN - Phase B  
Date: 2026-08-28

## 1. Authorized call, analysis, risk, and intervention sequence

```mermaid
sequenceDiagram
    autonumber
    actor Caller as Caller Android
    actor Customer as Customer Android
    participant Nest as NestJS
    participant DB as PostgreSQL
    participant LK as LiveKit
    participant ML as FastAPI/PyTorch
    participant Action as Protected action

    Customer->>Nest: P=HTTPS/TLS, A=access JWT, D=create-call command
    Nest->>DB: P=PostgreSQL/TLS, A=DB service credential, D=tenant-scoped call transaction
    DB-->>Nest: P=PostgreSQL/TLS, A=DB service credential, D=callId and authorized identities
    Nest->>LK: P=HTTPS/TLS, A=LiveKit API credential, D=create room and participant grants
    LK-->>Nest: P=HTTPS/TLS, A=LiveKit API credential, D=room result
    Nest-->>Caller: P=HTTPS/TLS, A=access JWT response authorization, D=short-lived caller participant JWT
    Nest-->>Customer: P=HTTPS/TLS, A=access JWT response authorization, D=short-lived customer participant JWT
    Caller->>LK: P=WebRTC DTLS-SRTP, A=caller participant JWT, D=Opus caller audio track
    Customer->>LK: P=WebRTC DTLS-SRTP, A=customer participant JWT, D=room subscription
    LK-->>Nest: P=HTTPS/TLS, A=verified webhook signature, D=caller participant and published track SID
    Nest->>DB: P=PostgreSQL/TLS, A=DB service credential, D=authoritative call-room-participant-track binding
    Nest->>ML: P=private HTTPS/TLS, A=backend service credential plus analysis grant, D=create session with exact binding
    ML->>LK: P=WebRTC DTLS-SRTP, A=subscribe-only participant JWT, D=join authorized room
    LK-->>ML: P=WebRTC DTLS-SRTP, A=subscriber grant, D=frames and participant/track metadata
    ML->>ML: P=in-process, A=validated analysis binding, D=bounded PCM quality and rolling windows
    ML-->>Nest: P=private HTTPS/TLS, A=ML service credential plus idempotency key, D=FAST or INSUFFICIENT_EVIDENCE revision
    Nest->>DB: P=PostgreSQL/TLS, A=DB service credential, D=atomic evidence, assessment, tagged transition/action decision, audit and outbox
    ML-->>Nest: P=private HTTPS/TLS, A=ML service credential plus idempotency key, D=DEEP revision for same window
    Nest->>DB: P=PostgreSQL/TLS, A=DB service credential, D=atomic revision supersession and deterministic risk/outbox recomputation
    alt policy requires warning or hold
        DB-->>Nest: P=PostgreSQL/TLS, A=tenant/call scope, D=durable stable-ID security-event outbox
        Nest-->>Customer: P=WSS/TLS, A=authorized membership plus call access, D=versioned risk/intervention event and replay cursor
        Customer-->>Nest: P=WSS/TLS, A=same tenant/call authorization, D=stable event acknowledgement
        Nest->>Action: P=HTTPS/TLS, A=service credential plus action idempotency key, D=call/action-bound hold
        Action-->>Nest: P=HTTPS/TLS, A=service credential, D=hold status
        Nest->>DB: P=PostgreSQL/TLS, A=DB service credential, D=intervention action and audit transaction
    else no intervention
        Nest->>DB: P=PostgreSQL/TLS, A=DB service credential, D=current versioned risk state
    end
    Caller->>LK: P=WebRTC DTLS-SRTP, A=caller participant JWT, D=leave or unpublish
    LK-->>Nest: P=HTTPS/TLS, A=verified webhook signature, D=track or participant ended
    Nest->>ML: P=private HTTPS/TLS, A=backend service credential plus idempotency key, D=stop analysis
    ML->>ML: P=in-process, A=session authorization, D=clear PCM windows tensors and embeddings
    Nest-->>Customer: P=WSS/TLS, A=authorized access session, D=call.ended event
```

### Binding invariants

1. NestJS creates the authoritative tuple `(organization_id, call_id, room_name, caller_participant_identity, caller_track_sid)`.
2. The ML session grant names that tuple and an expiry; a room grant alone is insufficient authorization to analyze an arbitrary track.
3. The ML subscriber ignores non-audio, customer, screen-share, unexpected, and unbound tracks.
4. If the caller publishes multiple audio tracks, analysis does not guess: NestJS policy selects exactly one binding or stops with an explicit binding error.
5. If the caller republishes after reconnect, the new `track_sid` is quarantined until a verified webhook and authorized binding revision replace the old SID. Old and new audio never merge silently.
6. The customer hears the LiveKit-routed caller track; SWAR does not create a separate client-upload analysis stream.
7. Engineering `DEMO` and `SHADOW` modes remain explicit at evidence, assessment, transition, action,
   and event boundaries. Only independently promoted calibrated evidence may enter `PRODUCTION`.
8. The evidence revision, risk assessment, optional tagged transition/intervention decision, audit,
   and outbox insert commit or roll back as one PostgreSQL transaction.

## 2. Enrollment, encrypted storage, revocation, and deletion

```mermaid
sequenceDiagram
    autonumber
    actor User as Authorized trusted speaker
    participant Nest as NestJS
    participant DB as PostgreSQL
    participant ML as FastAPI/PyTorch
    participant Key as Approved key boundary

    User->>Nest: P=HTTPS/TLS, A=access JWT plus enrollment role, D=consent purpose/version
    Nest->>DB: P=PostgreSQL/TLS, A=DB service credential, D=consent record transaction
    User->>Nest: P=HTTPS/TLS, A=access JWT plus enrollment session, D=bounded enrollment samples
    Nest->>ML: P=private HTTPS/TLS, A=backend service credential plus ephemeral grant, D=sample stream and consent/session IDs
    ML->>ML: P=in-process, A=enrollment grant, D=quality gate and transient ECAPA embeddings
    ML-->>Nest: P=private HTTPS/TLS, A=ML service credential, D=accepted embedding result plus model/hash/quality metadata
    Nest->>Key: P=key API or in-process key interface, A=server key authority, D=encrypt voiceprint
    Key-->>Nest: P=key API or in-process key interface, A=server key authority, D=ciphertext plus key version
    Nest->>DB: P=PostgreSQL/TLS, A=DB service credential, D=encrypted tenant-scoped voiceprint and consent link
    Nest-->>ML: P=private HTTPS/TLS, A=backend service credential, D=terminate ephemeral enrollment session
    ML->>ML: P=in-process, A=session authorization, D=clear samples tensors and plaintext embeddings
    Nest-->>User: P=HTTPS/TLS, A=access JWT response authorization, D=enrollment status without embedding
    User->>Nest: P=HTTPS/TLS, A=access JWT plus authorized lifecycle role, D=revoke or delete command
    Nest->>DB: P=PostgreSQL/TLS, A=DB service credential, D=revoke and delete ciphertext transaction
    Nest->>Key: P=key API or in-process key interface, A=server key authority, D=retire reference where applicable
    Nest->>DB: P=PostgreSQL/TLS, A=DB service credential, D=non-sensitive deletion audit record
    Nest-->>User: P=HTTPS/TLS, A=access JWT response authorization, D=deletion or revocation result
```

Enrollment samples and plaintext embeddings exist only in bounded request/session memory. They are cleared on success, rejection, timeout, cancellation, and error. The database receives ciphertext, key version, tenant/model/consent metadata, and audit references; it receives no plaintext embedding or full audio.

## 3. Protected-action step-up

```mermaid
sequenceDiagram
    actor Customer
    participant Nest as NestJS
    participant DB as PostgreSQL
    participant Verify as Independent verifier
    participant Action as Protected action

    Customer->>Nest: P=HTTPS/TLS, A=access JWT, D=transaction-bound step-up start
    Nest->>DB: P=PostgreSQL/TLS, A=DB service credential, D=challenge and active hold lookup
    Nest->>Verify: P=HTTPS/TLS, A=service credential plus challenge token, D=transaction-bound verification request
    Verify-->>Nest: P=HTTPS/TLS, A=verifier credential, D=signed/validated result
    alt verification succeeds and policy permits release
        Nest->>Action: P=HTTPS/TLS, A=service credential plus idempotency key, D=release exact held action
        Nest->>DB: P=PostgreSQL/TLS, A=DB service credential, D=release verification and audit transaction
    else verification fails, expires, or mismatches
        Nest->>DB: P=PostgreSQL/TLS, A=DB service credential, D=retained hold and failure audit
    end
    Nest-->>Customer: P=WSS/TLS, A=authorized access session, D=current action/intervention state
```

Caller audio, ECAPA similarity, and a client-side button cannot release a hold. The challenge must bind to the organization, user, call, protected action, expiry, nonce/idempotency state, and approved verification method.

## 4. Data minimization by hop

| Hop | Allowed payload | Explicitly forbidden |
|---|---|---|
| Android -> LiveKit | Authorized WebRTC media and participant metadata | LiveKit API secret; trusted-speaker assertion. |
| LiveKit -> ML | Decoded bound caller frames plus participant/track/timing metadata | Other participants/tracks; database records; business policy. |
| ML -> NestJS | Compact versioned identity/spoof/quality evidence and errors | Raw audio, full spectrograms, plaintext embeddings, private conversation content. |
| NestJS -> PostgreSQL | Tenant-scoped durable metadata, ciphertext voiceprints, policy/risk/intervention/audit | Raw call audio, plaintext voiceprints, secrets/tokens. |
| NestJS -> clients | Authorized call/risk/intervention state and non-sensitive reason codes | Service credentials, detailed probing thresholds, raw embeddings/audio. |
