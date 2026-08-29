# ADR-006: UUIDv7 identifiers and UTC timestamps

- Status: Accepted
- Date: 2026-08-28
- Decision owners: Backend and data architecture

## Context

SWAR needs non-sequential identifiers that can be created safely by independent backend processes while retaining useful index locality. The prior architecture did not freeze an identifier version. Timestamp semantics also need to be consistent across evidence, risk, intervention, and audit ordering.

## Decision

Persistent primary keys use PostgreSQL `uuid` columns populated by Prisma's UUIDv7 generator. Tenant-owned relations carry `organization_id` and use composite tenant/id foreign keys where Prisma can express them. UUID timestamp bits are not an authorization signal, secret, retention clock, or event-order authority.

All instants use UTC-capable PostgreSQL `timestamptz(6)` columns. Domain ordering uses explicit scoped sequence/revision fields plus event timestamps; `created_at` and UUID ordering are tie-breakers only where the owning contract says so.

## Alternatives considered

- Database sequences: rejected because they expose predictable global order and couple distributed writers to a central sequence.
- UUIDv4: acceptable for uniqueness but rejected for primary keys because random insertion has poorer index locality.
- ULID stored as text: rejected because it introduces a second encoding contract when PostgreSQL and Prisma natively support UUIDv7.
- Local timestamps without offsets: rejected because calls and evidence can cross system and timezone boundaries.

## Consequences and trade-offs

- IDs remain opaque to clients even though UUIDv7 contains coarse generation-time information.
- Explicit timestamps and scoped sequence numbers remain mandatory for lifecycle and evidence ordering.
- Phase F must verify database defaults and indexes on native PostgreSQL; it must not infer event order from UUID values.
- Any externally supplied identifier is parsed as a UUID and authorized within its organization before lookup.

## Compatibility

This decision preserves controlled WebRTC scope, server-authoritative caller/track binding, backend-owned temporal risk, no raw-audio retention, and native no-Docker development from ADR-001 through ADR-005.
