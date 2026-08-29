# SWAR

SWAR - Synthetic-voice Warning and Authentication in Real-time - protects enterprise-controlled LiveKit/WebRTC calls by keeping expected-speaker evidence, spoof evidence, audio quality, backend risk policy, and protected-action intervention in explicit service boundaries.

Phases A-F provide the frozen requirements/architecture, native development foundation, persistent domain schema, reviewed initial migration, and tenant-scoped repository layer. Authentication, public APIs, model inference, and frontend features remain intentionally unimplemented until their owning phases.

## Repository ownership

| Path | Owner | Phase C contents |
|---|---|---|
| `backend/` | NestJS control plane | Strict TypeScript toolchain and liveness endpoint only. |
| `ml/` | FastAPI/PyTorch analysis plane | Python toolchain and liveness endpoint only; no model loading. |
| `frontend/` | Android and React clients | Documentation-only placeholders until Phases R-S. |
| `infrastructure/` | Native configuration and process tooling | Documentation and repository-boundary checks only. |
| `docs/` | Requirements, architecture, contracts, security, evaluation, and demo evidence | Frozen Phase A/B evidence plus contract location. |
| `tests/` | Cross-service contract, media-binding, and end-to-end tests | Ownership documentation only in Phase C. |
| `.github/` | Non-container repository automation | Documentation-only placeholder until its owning CI phase. |

No root package manifest is permitted. Each service owns its dependencies and can be installed independently.

## Native engineering checks

Backend:

```powershell
Set-Location backend
npm ci
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

ML service:

```powershell
Set-Location ml
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m ruff check app tests
.\.venv\Scripts\python.exe -m ruff format --check app tests
.\.venv\Scripts\python.exe -m pytest
```

Repository boundaries:

```powershell
pwsh -NoProfile -File infrastructure/checks/repository-boundaries.ps1
pwsh -NoProfile -File infrastructure/checks/repository-boundaries.tests.ps1
```

The backend liveness endpoint is `GET /health` on the backend process. The ML liveness endpoint is `GET /health` on the FastAPI process. Native service configuration and canonical environment placeholders belong to Phase D.

Native database migration and repository verification:

```powershell
Set-Location backend
npm run prisma:validate
npm run test:database:native
```

See the [migration runbook](docs/data/migration-runbook.md) before applying a migration outside the disposable test harness.

## Dependency and lockfile policy

- `backend/package.json` and the committed `backend/package-lock.json` are the only Node dependency authorities for the backend. Use `npm ci` for reproducible installs and update both files together through npm.
- `ml/pyproject.toml` is the only Python dependency authority for the ML service in Phase C. Install into `ml/.venv`; never install project packages globally. An evaluated Python lock workflow may be added by its owning dependency phase, without creating a root environment.
- Frontend dependency manifests are forbidden before the Phase Q backend gate and Phase R.
- Exact package selections were checked against the official npm registry and PyPI on 2026-08-28. NestJS 11 is used because the installed Node 24.11.1 runtime does not meet the newly released NestJS 12 CLI generation minimum documented by NestJS; Phase D owns the native runtime upgrade decision.
- Model checkpoints, dataset packages, and audio corpora are not software dependencies and must follow the later governance gates.

## Change conventions

- Branches: use `phase/<letter>-<short-scope>` for phase work and `fix/<short-scope>` for bounded corrections.
- Commits: use imperative Conventional Commit subjects such as `feat(backend): add health foundation`; keep unrelated changes separate.
- Migrations: backend/Prisma owns database migrations beginning in Phase F. Never edit or delete an applied migration; add a forward migration and document compatibility or rollback behavior.
- Generated contracts: machine-readable sources under `docs/contracts/` become authoritative in Phase J. Generated clients/types must identify their source and must not be hand-edited or duplicated with different field names.
- Phase evidence: update only the active row in `docs/implementation/phase-status.md` after every required check passes.

## Security boundaries

Docker, Compose, Testcontainers, real secrets, raw audio, embeddings, checkpoints, and local databases must not be committed. The minimal services do not enable CORS. Voice audio and embeddings remain sensitive biometric-like data, and full call audio is not retained by default.

See [requirements](docs/requirements/requirements.md), [architecture](docs/architecture/system-context.md), and [phase status](docs/implementation/phase-status.md).
