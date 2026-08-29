# SWAR Native Windows Setup

Status: Phase D native-development contract  
Date: 2026-08-28

SWAR runs as native Windows processes and a native PostgreSQL service. The setup preserves the Phase B trust boundaries: the NestJS API and LiveKit signalling/media endpoints may be made reachable on a trusted LAN, while PostgreSQL and the ML API remain private. NFR-COMP-001 and ADR-005 govern this path.

## Verified tool inventory

The following locally installed versions were exercised on Windows 11 during Phase D. Versions were selected from current official release sources on 2026-08-28; later upgrades require the same compatibility and security review.

| Tool | Verified version | Local discovery |
|---|---:|---|
| Node.js | 24.11.1 | `PATH` |
| npm | 11.10.1 | `PATH` |
| Python | 3.12.3 | `PATH`; `ml/.venv` is preferred for the service |
| Eclipse Temurin JDK | 21.0.12.1 LTS | `%LOCALAPPDATA%\SWAR\tools\jdk-21.0.12.1+1` |
| Gradle | 9.7.1 | `%LOCALAPPDATA%\SWAR\tools\gradle-9.7.1` |
| PostgreSQL | 18.6 | EDB Windows binary archive under `%LOCALAPPDATA%\SWAR\tools\postgresql-18.6` |
| LiveKit Server | 1.13.5 | `%LOCALAPPDATA%\SWAR\tools\livekit-1.13.5` |

The scripts also discover conventional system installations and accept absolute `SWAR_*_PATH` overrides from `.env`. PostgreSQL's official Windows page links the EDB installer and binary archive; the archive is the supported local fallback when Windows Installer is unavailable. The local archive SHA-256 recorded during installation is an integrity observation, not a publisher signature; future re-downloads must be obtained from the official PostgreSQL/EDB link.

## First-time setup

1. Install supported Node.js/npm, Python, a JDK, Gradle, PostgreSQL, and the LiveKit Server executable. Do not place tool archives or executables in this repository.
2. In `backend/`, run `npm ci`.
3. Create `ml/.venv`, activate it, and run `python -m pip install -e ".[dev]"` from `ml/`.
4. Copy `.env.example` to the ignored `.env`. Replace every `replace_with_*` value with independently generated local values. Do not reuse production credentials.
5. Start a native PostgreSQL 18 service on the configured loopback host/port. Set its administrator credential only in `.env`, then run `infrastructure/local-windows/init-postgres.ps1`. This creates only `swar_app` and `swar`; Phase F owns schemas and migrations.
6. Run `infrastructure/local-windows/check-prerequisites.ps1`, then `start-all.ps1`. Stop the recorded processes with `stop-all.ps1`.

Scripts import `.env` without printing secret values. Existing process-level environment variables take precedence, which permits secret injection without a file. Example placeholders are rejected before database or LiveKit startup.

## LAN two-device configuration

Use a trusted private network. Set `BACKEND_HOST=0.0.0.0`, `LIVEKIT_BIND_ADDRESS=0.0.0.0`, and set `SWAR_LAN_IP` plus `LIVEKIT_NODE_IP` to the workstation's stable LAN IPv4. Update the public API, WebSocket, and LiveKit URLs to that IP. Keep `ML_HOST=127.0.0.1`, `POSTGRES_HOST=127.0.0.1`, and do not expose ports 8000 or 5432.

Allow only the required development firewall ingress from the trusted test subnet:

- TCP 3000 for NestJS and TCP 7880 for LiveKit signalling;
- TCP 7881 and UDP 7882 for LiveKit RTC media.

The committed LiveKit template has no credential. `start-livekit.ps1` generates an ignored runtime config using validated environment values. LAN reachability and firewall policy must be revalidated whenever the network changes. Public/non-loopback production traffic requires TLS and Phase X hardening.

## Lifecycle and recovery

`start-all.ps1` verifies versions, configured ports, and PostgreSQL readiness; runs the idempotent role/database bootstrap; then starts LiveKit, ML, and backend. A partial-start failure invokes bounded cleanup. Runtime logs, generated config, and process records are under ignored `.runtime/`.

`stop-all.ps1` validates the recorded PID, executable path, and start time before stopping it. It refuses stale or mismatched records and never searches for or terminates processes by name. If it reports a mismatch, inspect the JSON record and the current PID manually before removing stale state.

Common failures:

- **Tool missing:** install it or set its absolute `SWAR_*_PATH` override.
- **Port occupied:** identify the owner with `Get-NetTCPConnection`/`Get-NetUDPEndpoint`; stop it only if authorized, or deliberately change the corresponding local port.
- **PostgreSQL not ready:** start the configured native service and verify `pg_isready` before bootstrapping.
- **Health timeout:** inspect only `.runtime/logs/*.err.log`; logs must never contain passwords, tokens, voice audio, embeddings, or call content.
- **LAN device cannot connect:** verify the advertised LAN IP, trusted-subnet firewall scope, and TCP/UDP paths. Do not expose private services as a shortcut.

## Verification commands

Run from the repository root:

```powershell
pwsh -File infrastructure/local-windows/tests/native-environment.tests.ps1
pwsh -File infrastructure/local-windows/tests/native-smoke.ps1
pwsh -File infrastructure/checks/documentation.ps1
pwsh -File infrastructure/checks/repository-boundaries.ps1
```

The smoke test uses a temporary PostgreSQL cluster and test-only credentials, starts the three Phase D processes, probes them, stops only recorded PIDs, and removes its own bounded temporary directory. It does not create application schemas, persist audio, load models, or prove scientific performance.
