# Infrastructure

This directory owns native configuration and process tooling only; it contains no domain logic. Phase D will add the native Windows environment for PostgreSQL, LiveKit, NestJS, and FastAPI.

Phase C provides repository checks under `checks/`:

```powershell
pwsh -NoProfile -File checks/repository-boundaries.ps1
pwsh -NoProfile -File checks/repository-boundaries.tests.ps1
```

Docker, Compose, Testcontainers, and container-only commands are prohibited.

