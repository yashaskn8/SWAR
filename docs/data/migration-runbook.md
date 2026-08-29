# SWAR native PostgreSQL migration runbook

Version: 1.0.0  
Effective: 2026-08-28  
Owner: backend control plane  
Applies to: Phase F migration `20260828000000_initial_swar_schema`

This runbook is forward-only and uses native PostgreSQL. It never uses Docker, Testcontainers, `prisma db push`, or `prisma migrate reset`. Never edit or delete a migration after it has been applied.

## Safety contract

- Confirm the target database name and host before every backup, status, deploy, or recovery action. Production changes require an approved change record and a tested backup.
- Supply `DATABASE_URL` through the approved process environment. Do not print it, commit it, or paste real credentials into commands, tickets, or logs.
- Run migrations with a dedicated least-privilege deployment identity. The application identity must not acquire schema-owner privileges in production.
- Stop if `prisma migrate status` reports a failed, divergent, or unknown migration. Preserve the database and evidence; do not reset it.
- Do not seed production. `prisma/seed.ts` refuses any `SWAR_ENV` other than `development` or `test`.
- The initial schema stores encrypted voiceprint envelopes only. It has no raw-call-audio, PCM, waveform, tensor, or plaintext-embedding column.

## Deterministic local verification

From `backend/`, run:

```powershell
npm ci
npm run prisma:validate
npm run test:database:native
```

`test:database:native` creates a randomly named cluster only below the operating-system temporary directory, binds it to loopback on a free port, applies the committed migration, runs the seed twice, executes the database tests, verifies a second deploy is a no-op, stops PostgreSQL, and deletes only the validated temporary cluster path. It does not inspect, modify, stop, or delete an existing PostgreSQL cluster.

## Pre-deployment checks

1. Confirm Phases D and E remain `COMPLETE` in [phase status](../implementation/phase-status.md).
2. Review the committed SQL and checksum:

   ```powershell
   Get-FileHash .\prisma\migrations\20260828000000_initial_swar_schema\migration.sql -Algorithm SHA256
   npm run prisma:validate
   npm run db:migrate:status
   ```

3. Verify the target explicitly without exposing credentials:

   ```powershell
   psql --dbname "$env:DATABASE_URL" --no-psqlrc --command "SELECT current_database(), current_user, inet_server_addr(), version();"
   ```

4. Create and verify a PostgreSQL-native backup using the organization-approved encrypted backup destination. Do not place backups in the repository. For an empty first deployment, record that the database was confirmed empty instead.
5. Confirm the application version being deployed is compatible with both the pre-migration and post-migration schema for the duration of the rollout. The initial Phase F migration has no preceding application data.

## Apply and verify

Run from `backend/` with the approved `DATABASE_URL` already present:

```powershell
npm ci
npm run prisma:generate
npm run db:migrate:status
npm run db:migrate:deploy
npm run db:migrate:status
```

The successful initial result is exactly one finished migration named `20260828000000_initial_swar_schema` and `Database schema is up to date`. Start the backend only after status passes. Backend startup performs a bounded connectivity query and fails with `DATABASE_UNAVAILABLE` without logging the connection string.

## Development/test seed

The seed contains only fictional, disabled/inert records. It contains no real person, usable credential, audio, embedding, voiceprint ciphertext, checkpoint, or claimed model result.

```powershell
$env:SWAR_ENV = 'development'
npm run db:seed
npm run db:seed
```

The second run must be a no-op at the entity-count level. Never set a production process to a seed-enabled environment.

## Failed deployment recovery

1. Stop application rollout and retain the PostgreSQL log, Prisma output, migration name, application revision, timestamps, and non-sensitive correlation/change identifiers.
2. Run `npm run db:migrate:status`. Do not rerun blindly when the migration is marked failed.
3. Inspect `_prisma_migrations` read-only and compare the committed migration checksum. Never update that table directly.
4. If the failed migration made no durable schema change, an authorized operator may use `npx prisma migrate resolve --rolled-back 20260828000000_initial_swar_schema`, then deploy a reviewed forward correction. Record the inspection evidence first.
5. If a DBA completed an exact reviewed migration manually, reconcile only after comparing every statement, using `npx prisma migrate resolve --applied <migration_name>`. This is reconciliation, not a substitute for migration review.
6. If partial changes exist, produce a reviewed forward repair migration or restore the verified backup into a newly created database and switch the approved connection after validation. Never use `migrate reset`, delete data, or drop the existing database to hide a failure.

## Application rollback

Rolling back application code does not automatically roll back the database. Deploy backward-compatible additive migrations whenever possible. For a migration that cannot remain during application rollback, restore the verified pre-deployment backup to a new database, validate it, and perform an approved connection cutover. Destructive down-migration scripts are not included in the repository.

## Exit evidence

Record the migration checksum, native PostgreSQL version, pre/post `migrate status`, backup verification, database integration test outcome, application smoke result, and change approval. Record no database URL, secret, token hash, ciphertext, private audio, or call content.
