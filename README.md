# ApplyKit

A generalized, **multi-user**, **multi-provider** job-application automation
toolkit. ApplyKit interviews a new person, builds a structured profile, and runs
a human-in-the-loop pipeline that discovers roles, scores fit, and generates
grounded application materials.

It is a clean-room refactor of a single-user job-application workspace into
something anyone can onboard into — with **no personal data** in the repo and an
enforced test that keeps it that way.

> Human-in-the-loop by design: ApplyKit prepares materials and updates your
> tracker. It never auto-submits an application.

## Highlights

- **Onboarding intake** — a guided interview captures identity, socials,
  LinkedIn, links, target roles, skills, experience, past resumes & cover
  letters (imported as attachments), and any freeform notes.
- **Five LLM providers** behind one interface: **OpenAI, Anthropic, Amazon
  Bedrock, Kiro**, and a local (Ollama) option.
- **Multi-user** — each person gets an isolated workspace under
  `data/users/<id>/` (profile, tracker, attachments, applications).
- **Grounded resumes** — every resume bullet cites evidence in your profile;
  validation rejects placeholders, unsupported skills, and ungrounded claims.
  Output is clean Markdown (no PDF toolchain required).
- **Config-driven scoring** — fit weights come from *your* profile, not
  hard-coded constants.
- **Orchestration engine** — an event-driven pipeline (`scan → evaluate →
  generate → apply → followup`) over a persisted state machine.

## Requirements

- Node.js >= 20 (uses the built-in test runner and global `fetch`)
- One dependency: [`yaml`](https://www.npmjs.com/package/yaml)

## Quick start

```bash
npm install

# 1) Onboard yourself (interactive)
npm run onboard

# ...or try it instantly with a synthetic demo user (no real data)
npm run onboard -- --demo --user demo

# 2) Generate a grounded resume (the shipped example profile needs no setup)
npm run resume -- --profile examples/sample-user/profile.yml \
  --company "Acme" --title "Senior Backend Engineer"

# 3) Run the pipeline for a user (offline-first; a clean no-op without targets)
npm run apply -- --user demo
```

Copy `.env.example` to `.env` and fill in keys for whichever provider(s) you use.

## CLIs

| Command | What it does |
|---------|--------------|
| `npm run onboard` | Interview a new person; writes their profile + workspace. `--demo` runs non-interactively; `--user <id>` sets the id. |
| `npm run resume` | Generate a Markdown resume. `--user <id>` or `--profile <yml>`, plus `--company`, `--title`, `--jd <file>`, `--out <file>`. |
| `npm run apply` | Run the orchestration pipeline for `--user <id>` (optional `--provider`). |

## Providers

Selectable via `LLM_PROVIDER` or `createProvider(name)`:

| name | Transport | Auth |
|------|-----------|------|
| `openai` | `POST /chat/completions` | `OPENAI_API_KEY` |
| `anthropic` | `POST /messages` | `ANTHROPIC_API_KEY` |
| `bedrock` | Bedrock Runtime `…/model/<id>/invoke` (API key / bearer token, no SigV4) | `AWS_BEARER_TOKEN_BEDROCK` |
| `kiro` | OpenAI-compatible gateway | `KIRO_API_KEY` + `KIRO_BASE_URL` |
| `local` | Ollama `POST /generate` | none |

All providers expose `complete`, `embed`, `structured`, and `describe()`.
Providers without embeddings (Anthropic, Kiro) report `embed: false` and throw a
typed `NotImplementedError`.

## Repository layout

```
bin/                CLI entry points (onboard, resume, apply)
src/
  providers/        base + openai/anthropic/bedrock/kiro/local + factory
  profile/          schema, multi-user store, attachments
  onboarding/       questions, prompter (Readline + Scripted), intake
  tracker/          CSV tracker adapter (RFC-4180, formula-injection safe)
  core/             logger, pipeline state machine, orchestrator
  agents/           base, scanner, evaluator, application, followup
  resume/           grounded resume builder (Markdown)
config/             profile.example.yml, scoring.example.yml
examples/           synthetic sample-user profile (safe to read/run)
docs/               DESIGN.md, STRATEGY.md, ONBOARDING.md
tests/              unit/ + e2e/ (Node test runner)
data/               per-user runtime workspaces (gitignored)
```

## How resumes stay honest

ApplyKit does **deterministic, grounded transcription** — it never invents
content. Every resume bullet is copied from your profile and carries an
evidence reference back to a fact card; `validateResumeSpec` rejects any bullet
whose text drifts from its cited evidence, any skill not in your profile, and
any placeholder text. This is the anti-fabrication guarantee that protects the
output if bullets are ever hand-edited or authored by an LLM.

> Note: imported resumes/cover letters are **archived for reference** today;
> they are not yet parsed into resume evidence. Only structured profile fields
> become resume content.

## Testing

```bash
npm test
```

Tests are hermetic: no network (providers stub `global.fetch`), no native
binaries (resumes render to Markdown), and all writes go to temp dirs. A guard
test (`tests/unit/no-personal-data.test.mjs`) fails if any tracked file contains
identifiers from the original single-user project.

## Design & strategy

See [`docs/DESIGN.md`](docs/DESIGN.md), [`docs/STRATEGY.md`](docs/STRATEGY.md),
and [`docs/ONBOARDING.md`](docs/ONBOARDING.md).
