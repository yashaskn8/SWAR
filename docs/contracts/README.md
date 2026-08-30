# Machine-readable contracts

Status: FROZEN - Phase J  
Contract version: 1.0.0  
Frozen: 2026-08-29

This directory contains SWAR's authoritative transport contracts:

- [REST and callback OpenAPI](public-rest.openapi.yaml) is generated from NestJS controllers and checked in as a drift-tested snapshot.
- [Security WebSocket AsyncAPI](security-events.asyncapi.yaml) defines subscription, acknowledgement, replay, and outbound event payloads.
- [Backend-to-ML OpenAPI](ml-control.openapi.yaml) defines signed analysis and ephemeral-enrollment
  control; analysis create uses the exact-binding v2 schema while v1 remains historical.
- [ML-to-backend OpenAPI](ml-evidence.openapi.yaml) defines authenticated, bound, idempotent evidence ingestion.
- [JSON Schemas](schemas/) define shared error, security-event, ML-control, and evidence payloads.
- [Versioning](versioning.md) defines compatibility, replay, optional-field, enum, and score semantics.

The contracts use fictional labelled examples only. Public examples contain no audio, embedding, ciphertext, password, access token, refresh token, service credential, or private call content. Session and join-token response fields are marked sensitive/read-only because the client needs those short-lived credentials; they must never be logged or replay-cached.

Run `npm run contracts:generate` from `backend/` after controller changes, then `npm run test:contract`. A snapshot change must be reviewed together with these source contracts and [the adapter contract](../backend/api-contracts.md). Do not hand-maintain a second schema with alternate field names.
