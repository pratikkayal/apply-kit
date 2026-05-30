# ApplyKit — Implementation Strategy & Task List

## Sequencing principle

Build **bottom-up** so every layer is testable before the layer above depends on
it: primitives → storage → providers → agents/engine → onboarding → CLIs → docs.
Each module lands with its tests. Nothing ships that hasn't run green under
`node --test`.

## Build order (dependency-ordered)

1. **Project scaffold** — `package.json` (ESM, `node --test`, dep: `yaml`),
   `.gitignore`, `.env.example`, directory skeleton. Install deps; confirm the
   empty test command runs.
2. **Profile schema** (`src/profile/schema.mjs`) — shape, `createEmptyProfile`,
   `validateProfile`, `mergeProfile`. Pure, no I/O → trivially testable first.
3. **Tracker CSV adapter** (`src/tracker/csv.mjs`) — port + generalize the
   RFC-4180 parser; documented column schema; `bootstrapTracker`.
4. **Profile store + attachments** (`src/profile/store.mjs`,
   `attachments.mjs`) — per-user dirs under `data/users/<id>/`, YAML load/save,
   attachment import/catalogue, tracker bootstrap.
5. **Provider layer** (`src/providers/*`) — `base`, `openai`, `anthropic`,
   `bedrock`, `kiro`, `local`, `index` factory + `describe()` capabilities.
6. **Core engine** (`src/core/logger.mjs`, `pipeline.mjs`, `orchestrator.mjs`) —
   FSM + event-driven orchestrator, domain-agnostic.
7. **Agents** (`src/agents/*`) — `base`, config-driven `evaluator`,
   offline-first `scanner`, `resume`, `application`, `followup`.
8. **Resume builder** (`src/resume/builder.mjs`) — fact cards, grounded
   `ResumeSpec`, identity-parameterized validation, Markdown renderer.
9. **Onboarding** (`src/onboarding/*`) — `questions`, `prompter`
   (Readline+Scripted), `intake` orchestration.
10. **CLIs** (`bin/onboard.mjs`, `bin/apply.mjs`, `bin/resume.mjs`) — thin
    wrappers over the library.
11. **Examples & config** — `examples/sample-user/profile.yml` (synthetic),
    `config/scoring.example.yml`, `config/profile.example.yml`.
12. **Tests** — unit + e2e, including the no-personal-data guard.
13. **Top-level docs** — `README.md`, `docs/ONBOARDING.md`.

## Testing strategy (enforced, hermetic)

- Runner: `node --test` (default discovery finds every `*.test.mjs`
  recursively and skips `node_modules`; works across Node 20 and 22). No watch mode.
- **No network:** provider tests stub `global.fetch`.
- **No native deps:** resume output is Markdown; no pdfinfo/pdftotext.
- **Isolation:** every test that writes uses a temp `data/` dir via env override
  (`APPLYKIT_DATA_DIR`) and cleans up.
- **Invariant test:** `no-personal-data.test.mjs` greps tracked +
  untracked-but-not-ignored files (via `git grep --untracked
  --exclude-standard`) for the original author's identifiers and fails on any
  match. Scope note: this is a regression guard against the *specific* source
  identifiers, not a general PII scanner; it requires a git repo.

## Quality gates before "done"

- `npm test` fully green (unit + e2e).
- `npm run onboard` works end-to-end with the scripted demo (`--demo`).
- `npm run resume -- --profile examples/sample-user/profile.yml --company "Acme"`
  produces a grounded Markdown resume.
- No tracked file contains personal data from the source repo.
- `job-applications` working tree remains untouched (verified via `git status`).

## Complete task list (atomic, in order)

- [ ] T1  Scaffold: package.json, .gitignore, .env.example, dir skeleton; npm install `yaml`.
- [ ] T2  `src/profile/schema.mjs` + `tests/unit/profile-schema.test.mjs`.
- [ ] T3  `src/tracker/csv.mjs` + `tests/unit/tracker-csv.test.mjs`.
- [ ] T4  `src/profile/store.mjs` + `src/profile/attachments.mjs` + tests.
- [ ] T5  `src/providers/base.mjs` + `openai.mjs` + `anthropic.mjs`.
- [ ] T6  `src/providers/bedrock.mjs` + `kiro.mjs` + `local.mjs`.
- [ ] T7  `src/providers/index.mjs` factory + `tests/unit/providers.test.mjs` (fetch-stubbed).
- [ ] T8  `src/core/logger.mjs` + `src/core/pipeline.mjs` + `tests/unit/pipeline.test.mjs`.
- [ ] T9  `src/agents/base.mjs` + `evaluator.mjs` (config-driven) + tests.
- [ ] T10 `src/agents/scanner.mjs` (offline-first) + `application.mjs` + `followup.mjs`.
- [ ] T11 `src/core/orchestrator.mjs` + `tests/e2e/orchestrator.e2e.test.mjs`.
- [ ] T12 `src/resume/builder.mjs` + `tests/unit/resume-builder.test.mjs`.
- [ ] T13 `src/onboarding/{questions,prompter,intake}.mjs` + `tests/e2e/onboarding.e2e.test.mjs`.
- [ ] T14 `bin/{onboard,apply,resume}.mjs` CLIs.
- [ ] T15 `examples/sample-user/profile.yml` + `config/*.example.yml`.
- [ ] T16 `tests/unit/no-personal-data.test.mjs` invariant guard.
- [ ] T17 `README.md` + `docs/ONBOARDING.md`.
- [ ] T18 Run full suite; fix to green; run CLIs as smoke tests.

## Self-critique dimensions (for the review pass)

Architecture & coupling · Security/PII (secrets, leakage, attachment paths) ·
Provider correctness (auth, request/response shaping, error handling) ·
Extensibility · Developer experience (CLI ergonomics, errors) · Test coverage &
hermeticity · Edge cases (empty profile, missing files, malformed CSV) ·
Documentation accuracy.
