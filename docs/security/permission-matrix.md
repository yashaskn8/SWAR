# Authentication and authorization permission matrix

Status: Phase G frozen engineering contract  
Authority: `FR-AUTH-001` through `FR-AUTH-004`, the root engineering contract, and the Phase G prompt.

SWAR authorizes an authenticated organization membership, not an email address, request header, display name, or caller-supplied role. Every protected resource check requires both an explicit permission and an exact `organizationId` match.

## Persona mapping

| Product persona | Persisted organization role | Notes |
|---|---|---|
| Organization owner | `OWNER` | Full tenant administration and recovery authority. |
| Organization administrator | `ADMIN` | Tenant administration except ownership recovery/transfer. |
| Fraud/security analyst | `SECURITY_ANALYST` | Reads calls/evidence and handles interventions; cannot manage members or voiceprints. |
| Enterprise caller/call operator | `CALL_OPERATOR` | Creates and operates controlled calls. This role does not establish the expected-speaker identity. |
| Enrollment operator | `ENROLLMENT_OPERATOR` | Runs consented enrollment and revocation workflows. |
| Enterprise customer/member | `MEMBER` | Participates in authorized calls and reads only resources exposed by a membership-scoped workflow. |

Internal ML subscribers and verified LiveKit webhooks are service identities. They never receive a user role or use the public access-token verifier.

## Permission matrix

Legend: `Y` means the role may attempt the operation; the service must still enforce tenant and resource-state rules. `-` means deny.

| Permission | OWNER | ADMIN | SECURITY_ANALYST | CALL_OPERATOR | ENROLLMENT_OPERATOR | MEMBER |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `organization.read` | Y | Y | Y | Y | Y | Y |
| `organization.manage` | Y | Y | - | - | - | - |
| `membership.manage` | Y | Y | - | - | - | - |
| `device.manage.self` | Y | Y | Y | Y | Y | Y |
| `call.create` | Y | Y | Y | Y | - | - |
| `call.read` | Y | Y | Y | Y | Y | Y |
| `call.end` | Y | Y | Y | Y | - | - |
| `enrollment.manage` | Y | Y | - | - | Y | - |
| `voiceprint.delete` | Y | Y | - | - | Y | - |
| `risk-event.read` | Y | Y | Y | Y | - | - |
| `intervention.resolve` | Y | Y | Y | - | - | - |
| `risk-policy.read` | Y | Y | Y | - | - | - |
| `risk-policy.manage` | Y | Y | - | - | - | - |
| `audit.read` | Y | Y | Y | - | - | - |

## Enforcement rules

- Login selects one active organization membership by verified organization slug, normalized email, password, and pre-registered active device.
- Access tokens contain identifiers only. Guards reload the active user, membership, device, session, and current roles from PostgreSQL for every request; role removal, device revocation, and logout therefore take effect without trusting stale token roles.
- Resource services call the reusable tenant authorization assertion even after controller guards. Cross-tenant access is denied with the same public response as a missing resource.
- Refresh tokens are opaque bearer credentials. Only a keyed digest is stored; rotation is single-use and replay revokes the token family.
- Authentication errors are generic and logs/audit metadata exclude passwords, raw tokens, secrets, email addresses, and private call content.

## Administration recovery

`VALIDATION REQUIRED`: the SIH prototype has no public bootstrap or owner-recovery endpoint. Initial owners are provisioned through an authorized native administrative procedure. A production recovery design requires verified enterprise ownership, dual control, auditable approval, and credential-delivery requirements before implementation.

## Signing-key rotation plan

The native SIH build uses separate symmetric access-signing and refresh-digest secrets. Rotation is fail-closed: revoke active refresh families, replace both secrets through the native secret-delivery procedure, restart the backend, and require users to authenticate again. Previously issued access tokens then fail signature verification rather than remaining accepted under an undocumented old key.

`VALIDATION REQUIRED`: production rolling rotation needs an approved key-management service, `kid`-addressed active/retiring verification keys, overlap bounded by the measured access-token lifetime, refresh-family migration/revocation rules, and an exercised rollback procedure. No key-management provider or zero-downtime rotation capability is claimed for the SIH build.
