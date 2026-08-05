# @foundry/kcl-corpus

Extracts FOUNDRY's KCL into a content-addressed corpus for model training.

There are no `.kcl` files on disk in this repository — every piece of KCL is
either a `CadDoc` JSON blob in Postgres or a TypeScript string constant. These
extractors turn those sources into `CorpusRecord`s and write them through
`CorpusSinkPort`, so the Supabase adapter in `./sink` is the only file that
imports a vendor SDK.

## Sources

| Extractor              | Source                                            | Status                     |
| ---------------------- | ------------------------------------------------- | -------------------------- |
| `extractRepoConstants` | Shipped templates in `packages/cad/src/doc.ts`    | Implemented                |
| `extractSamples`       | External sample sets, e.g. `KittyCAD/kcl-samples` | Implemented                |
| `extractDesignDoc`     | `DesignDoc` rows where `kind = MODEL3D`           | Implemented                |
| Chat / run-event pairs | `ChatMessage.parts`, `ChatRunEvent.chunk`         | **Gated** — see Governance |

## Two traps worth knowing

- **`CadDoc.script` is a compat mirror** of the active component. Counting it
  duplicates one component per document, so `extractDesignDoc` reads
  `components[]` only.
- **`DesignDoc` is last-write-wins** (`@@unique([projectId, branchId, kind])`),
  so it holds head state with no revision history. Edit and repair sequences
  exist only in the chat and run-event streams.

## Governance

Project and branch ids are HMAC-pseudonymized via `pseudonymize(id, salt)`
before reaching the sink; the salt is held outside the corpus database so the
mapping cannot be brute-forced from a leaked copy.

Prompts and other user-authored text are **not** extracted yet. That step needs
a legal basis for training use (terms coverage and/or a workspace-level
opt-out), plus redaction of emails, URLs, tokens, and names. Do not enable it
without that sign-off.

The corpus lives in its own `kcl` schema, deliberately not exposed through
PostgREST, with RLS enabled and no permissive policies — service-role only.

## Usage

```bash
# Emit Phase 1 records as JSON (repo constants; optional sample directory)
pnpm --filter @foundry/kcl-corpus --silent emit
pnpm --filter @foundry/kcl-corpus --silent emit ../kcl-samples
```

Migration for the target database: `migrations/0001_kcl_schema.sql`.
