# Frontend Placeholder

This directory is reserved for Android and React client code. Phase C contains documentation-only placeholders; production frontend implementation is forbidden until the Phase Q backend exit gate passes and Phase R begins.

- `android/`: future Kotlin/Jetpack Compose/LiveKit Android client.
- `dashboard/`: future React/TypeScript analyst dashboard.

Clients will communicate with NestJS public REST/WebSocket contracts and the authorized LiveKit media plane only. They will not access FastAPI or PostgreSQL directly and will not compute trusted risk decisions.

