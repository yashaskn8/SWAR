# SWAR Dataset License Review Protocol

Status: Phase K contract, version 1.0.0
Requirements: MLR-GOV-001, NFR-PRIV-001, NFR-SEC-003

## Approval evidence

Before `APPROVED_FOR_LOCAL_RESEARCH`, a source entry must record:

- the official dataset owner/publisher page and immutable version or DOI where available;
- the complete license or usage agreement, identifier, review date, permitted uses, attribution, redistribution, non-commercial, access, deletion, and retention obligations;
- inherited source-corpus and generator obligations;
- whether an authorized person must accept terms or request access;
- the collection consent statement or the provider-documented reuse basis for human-derived speech;
- exact provider archive filenames and checksums; and
- a purpose-limited SWAR role such as identity training, identity evaluation, spoof training, spoof evaluation, robustness evaluation, or OOD candidate.

`VALIDATION_REQUIRED` is mandatory when any item is missing or ambiguous. A repository, paper, dataset card, public link, or permissive code license does not prove the audio has the same license.

## Handling rules

- Do not commit downloaded license-gated files, access forms, email addresses, tokens, credentials, or signed agreements containing personal information.
- Record only non-sensitive authority URLs, license identifiers, decisions, blockers, and content hashes in Git.
- Keep dataset archives/audio in an access-controlled directory outside the repository.
- Attribute and redistribute only as the reviewed source terms permit.
- Re-review when the source version, host, terms, intended role, or project/commercial context changes.
- Reject production or external distribution until deployment-specific legal review approves it.

The project may describe this as a privacy-aligned governance process. It does not establish automatic legal or DPDP compliance.
