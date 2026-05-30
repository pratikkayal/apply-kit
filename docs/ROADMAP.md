# ApplyKit — Roadmap & Improvement Task List

> Status: **preliminary**. The current code is a solid, tested foundation
> (98 hermetic tests, real demo runs), but it is an MVP. This document is the
> prioritized backlog to take it from "works on the happy path" to "production
> ready". Items are grouped by theme and tagged **P0** (correctness/safety
> before real use), **P1** (high value), **P2** (later / nice-to-have).
>
> Checkboxes are intentionally unchecked — this is the work *ahead*.

## Guiding principles for refinement

- Keep the suite **hermetic** (no network, no native deps in unit tests).
- Preserve the **anti-fabrication** guarantee: nothing reaches a resume that
  isn't grounded in profile evidence.
- Stay **human-in-the-loop**: never auto-submit.
- Every new capability lands with tests and honest docs.

---

## 1. Resume generation depth

The headline feature is currently *deterministic transcription*. To be genuinely
useful it needs selection, tailoring, and richer output.

- [ ] **P1 — JD-driven bullet selection & ranking.** Today bullets are sliced to
  the first N. Select/rank by relevance to the job description (keyword + later
  embedding similarity), not document order. (`src/resume/builder.mjs`)
- [ ] **P1 — LLM-authored, grounded bullets.** Optional path where the provider
  rewrites bullets for a JD, then each generated bullet is mapped back to a
  fact card and **must pass `validateResumeSpec`** (the validator already has
  teeth for this). Falls back to transcription when no provider is configured.
- [ ] **P1 — Parse imported attachments into evidence.** Resumes/cover letters
  are currently archived but unused. Extract text (txt/md now; PDF/docx later)
  into fact cards so uploaded history contributes to generation.
  (`src/profile/attachments.mjs`, `src/resume/builder.mjs`)
- [ ] **P2 — Multiple output formats.** HTML and LaTeX/PDF renderers consuming
  the same `ResumeSpec` (PDF behind an optional dependency / system check so
  the core stays toolchain-free).
- [ ] **P2 — ATS keyword-coverage report.** Score a generated resume against a
  JD and surface missing keywords for the user to address.
- [ ] **P2 — Length/one-page budgeting.** Token/line budgeting per section.

## 2. Provider layer hardening

- [ ] **P0 — Retries with backoff + jitter** on 429/5xx, with a max-attempts
  cap. (`src/providers/base.mjs` `fetchJson`)
- [ ] **P1 — Streaming completions** (`completeStream`) for responsive CLIs.
- [ ] **P1 — Token & cost accounting** per call, surfaced in run reports.
- [ ] **P1 — Structured-output validation.** Validate `structured()` results
  against the provided JSON schema (e.g. a tiny validator) instead of
  prompt-only enforcement.
- [ ] **P1 — Bedrock SigV4 option.** Support IAM/SigV4 in addition to the
  bearer-token API key, for environments without Bedrock API keys.
  (`src/providers/bedrock.mjs`)
- [ ] **P2 — Model registry & capability matrix** (context window, max tokens,
  embed support) to validate model names and pick defaults.
- [ ] **P2 — Don't fail silently.** `complete()` returning `""` on an
  unexpected response shape should log/surface the anomaly.
- [ ] **P2 — Provider contract tests** against recorded response fixtures.

## 3. Onboarding & profile

- [ ] **P1 — Prefill from an uploaded resume.** Parse an imported resume to
  pre-populate experience/skills, then let the user confirm/edit — drastically
  reduces typing. (`src/onboarding/intake.mjs`)
- [ ] **P1 — Declarative question schema.** Move prompts into a data structure
  with `{ id, prompt, type, required, validate, transform }` (DESIGN §7's
  original intent) so questions are testable/reorderable and validation is
  centralized. (`src/onboarding/questions.mjs`)
- [ ] **P1 — Edit/update flow.** `onboard --edit <user>` to amend an existing
  profile rather than only create.
- [ ] **P1 — More inline validators.** URL validation for links; phone format
  hints. (currently only email is validated)
- [ ] **P2 — Profile schema versioning & migrations.** `schemaVersion` exists;
  add a migration path for future shape changes. (`src/profile/schema.mjs`)
- [ ] **P2 — LinkedIn / data import** (where ToS-compliant) and resume PDF import.
- [ ] **P2 — Web onboarding wizard** over the same intake library.
- [ ] **P2 — i18n** for prompts and generated materials.

## 4. Orchestration & scanning

- [ ] **P1 — Live ATS scanning, productionized.** Caching, per-host rate limits,
  retry/backoff, and ETag/If-Modified-Since. Currently offline-first with a raw
  fetch. (`src/agents/scanner.mjs`)
- [ ] **P1 — Cross-run dedupe & incremental scans.** Persist seen job URLs so
  re-runs only surface new postings.
- [ ] **P1 — Scheduler.** A `scheduler` to run the pipeline on a cadence
  (the source had this concept) with locking so runs don't overlap.
- [ ] **P2 — More ATS adapters** (Workday, SmartRecruiters, Recruitee) and an
  opt-in headless-browser fallback behind a flag for non-API boards.
- [ ] **P2 — Pluggable domains.** Re-introduce a domain abstraction
  (jobs / grants / accelerators) cleanly if multi-domain is desired.

## 5. Tracker & data layer

- [ ] **P0 — Concurrency-safe writes.** The CSV adapter does read-modify-write
  with no locking; concurrent runs can clobber. Add file locking or move to
  SQLite. (`src/tracker/csv.mjs`)
- [ ] **P1 — Optional SQLite backend** behind the same tracker interface for
  larger datasets and queries.
- [ ] **P1 — Tracker schema validation** (status enum, required columns) with a
  `tracker:lint` command.
- [ ] **P2 — Reporting & analytics** (funnel: discovered → applied → interview)
  and export.

## 6. Security & privacy

- [ ] **P0 — Secret handling review.** Document that keys live only in env/`.env`
  (gitignored); add a pre-commit/`secrets:scan` check to catch accidental key
  commits.
- [ ] **P1 — Encryption at rest** option for `data/users/*/profile.yml` (PII).
- [ ] **P1 — PII-safe logging** audit; ensure user content/keys never hit logs.
- [ ] **P1 — Broaden the PII guard.** `no-personal-data.test.mjs` checks a fixed
  token list; add structural checks (e.g. no emails/phones outside `examples/`)
  and document its scope. (`tests/unit/no-personal-data.test.mjs`)
- [ ] **P2 — `npm audit` in CI** and a dependency policy.
- [ ] **P2 — Attachment content scanning** (size/type limits, malware-safe
  handling) before parsing.

## 7. Testing & quality

- [ ] **P1 — Coverage thresholds** in CI (`node --test --experimental-test-coverage`).
- [ ] **P1 — Mock ATS server** for end-to-end scanner tests without the network.
- [ ] **P1 — Lint & format.** Add ESLint + Prettier configs and a `lint` script;
  wire into CI.
- [ ] **P1 — Type-checking.** JSDoc + `tsc --checkJs` (or migrate to TS) for
  editor/CI type safety without changing the runtime.
- [ ] **P2 — Property-based tests** for the CSV parser and scoring.
- [ ] **P2 — Mutation testing** to validate the suite's strength.

## 8. Cover letters & follow-ups

- [ ] **P1 — Grounded cover letters.** Apply the same evidence-grounding +
  validation the resume builder uses; today the cover letter is a free
  `complete()` call that can drift. (`src/agents/application.mjs`)
- [ ] **P2 — Templates & tone presets**; persist drafts under the user's
  `applications/<role>/`.
- [ ] **P2 — Follow-up scheduling** with reminders and per-company cadence.

## 9. Observability & DX

- [ ] **P1 — Run reports.** Persist a per-run JSON/Markdown summary (counts,
  scores, costs, errors) under the user's workspace.
- [ ] **P1 — `LICENSE`, `CONTRIBUTING.md`, `CHANGELOG.md`.** Repo is currently
  unlicensed; pick a license before any external use.
- [ ] **P2 — Published types / API docs** if ApplyKit is consumed as a library.
- [ ] **P2 — Structured logging** (JSON lines) toggle for machine consumption.

## 10. Architecture follow-ups (from the first review)

- [ ] **P1 — Per-user default pipeline state.** `new Pipeline()` defaults to a
  single shared state file; library consumers (not the CLI) could collide.
  Make the per-user path the default or required. (`src/core/pipeline.mjs`)
- [ ] **P2 — Config module.** A single `src/config/settings.mjs` resolving
  provider + paths, instead of each provider reading env independently.
- [ ] **P2 — Event/typed errors.** Introduce typed error classes and a richer
  orchestrator event payload (timings, ids).

---

## Suggested next milestone (a focused "v0.2")

A coherent slice that delivers the most user-visible refinement:

1. **Parse imported resumes into evidence** (§1) + **prefill onboarding** (§3).
2. **JD-driven bullet selection** and **optional LLM-authored grounded bullets** (§1).
3. **Grounded cover letters** (§8).
4. **Retries/backoff** (§2) + **concurrency-safe tracker** (§5) for reliability.
5. **ESLint/Prettier + coverage + type-checking** (§7) to lock in quality.

Each ships with tests and updated docs, preserving the hermetic-suite and
anti-fabrication invariants.
