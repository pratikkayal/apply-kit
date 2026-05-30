# ApplyKit — Design Document

> A generalized, multi-user, multi-provider job-application automation toolkit.
> Refactored from a single-user, personal job-application workspace into a
> product anyone can onboard into.

## 1. Background & Motivation

The source project (`job-applications`) is a powerful but **single-user** system.
Its orchestration engine (scan → evaluate → generate → apply → follow-up) is
well-architected, but the repository hard-codes one person's identity, profile,
tracked companies, scoring weights, and even PDF layout assertions
(the layout validator asserts the original author's literal name and phone
prefix). It cannot serve a second user without forking and rewriting data files.

**ApplyKit** keeps the strong parts of that architecture (pluggable LLM
providers, an event-driven orchestrator, a persisted pipeline state machine,
agent abstractions, a CSV tracker) and generalizes everything else:

1. **No personal data.** Nothing in the repo identifies a real person. Only
   synthetic example profiles and fixtures ship.
2. **Multi-user.** Each person gets an isolated workspace under
   `data/users/<userId>/`.
3. **Onboarding intake.** A new person is interviewed for everything ApplyKit
   needs: identity, socials, LinkedIn, links, target roles, past resumes &
   cover letters (as attachments), and any freeform notes they want to add.
4. **Four LLM provider families on day one:** OpenAI, Anthropic, **Amazon
   Bedrock**, and **Kiro** (plus a local/Ollama option for offline dev).
5. **Config-driven, not hard-coded.** Scoring weights, target roles, and
   filters come from each user's profile/preferences, not from source constants.

## 2. Goals & Non-Goals

### Goals
- A clean, dependency-light Node.js (ESM) codebase that runs and tests with no
  native binaries and no network access.
- A provider abstraction that treats OpenAI / Anthropic / Bedrock / Kiro / local
  uniformly behind one interface, selectable by config or env.
- A guided onboarding flow that is **interactive** (TTY prompts) *and*
  **scriptable** (answers injected programmatically) so it is fully testable.
- A grounded resume/cover-letter generator that emits Markdown (deterministic,
  reviewable, no PDF toolchain required) while preserving the source's
  "every claim cites profile evidence" guarantee.
- Thorough automated tests: unit + end-to-end.

### Non-Goals (intentionally deferred)
- Auto-submitting applications. ApplyKit is **human-in-the-loop**; it prepares
  materials and updates the tracker, it never clicks "submit".
- Browser scraping / Puppeteer. The scanner ships an offline-first default and
  standard ATS adapters; headless browsers are out of scope for this pass.
- PDF rendering. Markdown output is the contract; a PDF renderer can be layered
  on later behind the same `ResumeSpec`.
- A web UI. The first deliverable is a library + CLIs.

## 3. Personal-data removal strategy

| Source (personal)                          | ApplyKit (generalized)                                  |
|--------------------------------------------|---------------------------------------------------------|
| the author's master profile YAML (a real person) | `examples/sample-user/profile.yml` (synthetic "Alex Doe")|
| `job_applications.csv` (47 KB real rows)    | Generated per-user empty tracker with a header schema   |
| `applications/<38 companies>/`              | Created on demand under `data/users/<id>/applications/` |
| `portals.yml` (43 KB real targets)          | `config/scoring.example.yml` generic weights            |
| Hard-coded `POSITIVE/NEGATIVE/COMPANY_BONUS`| `ScoringConfig` loaded from user preferences            |
| `validateResumeLayout` asserts real name    | Layout/grounding checks parameterized by `spec.identity`|

A repository guard test (`tests/unit/no-personal-data.test.mjs`) greps the
tracked source for the original author's identifiers and **fails** if any leak
in. This makes the "no personal data" requirement an enforced invariant, not a
one-time cleanup.

## 4. Architecture overview

```
                         ┌─────────────────────────────┐
        CLIs             │  bin/onboard.mjs             │  guided intake
   (thin wrappers)       │  bin/apply.mjs               │  run pipeline / stage
                         │  bin/resume.mjs              │  one resume
                         └──────────────┬──────────────┘
                                        │
   ┌───────────────┐   ┌────────────────▼───────────────┐   ┌──────────────────┐
   │  Onboarding   │   │          Orchestrator           │   │     Providers     │
   │  intake +     │──▶│  scan→evaluate→generate→apply→  │◀──│ openai/anthropic/ │
   │  questions    │   │  followup  (+ Pipeline FSM)     │   │ bedrock/kiro/local│
   └──────┬────────┘   └───────┬─────────────┬───────────┘   └──────────────────┘
          │                    │             │
   ┌──────▼────────┐   ┌───────▼──────┐  ┌───▼─────────┐
   │ Profile store │   │   Agents     │  │  Resume     │
   │ (multi-user)  │   │ scanner/eval │  │  builder    │
   │ + attachments │   │ resume/app/  │  │ (grounded,  │
   │               │   │ followup     │  │  Markdown)  │
   └──────┬────────┘   └──────┬───────┘  └─────────────┘
          │                   │
   ┌──────▼───────────────────▼─────────────────────────┐
   │   Storage: data/users/<id>/  +  CSV tracker adapter │
   └─────────────────────────────────────────────────────┘
```

### Module map (`src/`)
- `providers/` — `base`, `openai`, `anthropic`, `bedrock`, `kiro`, `local`,
  `index` (factory). All HTTP via global `fetch` (mockable in tests); each
  resolves its own config from constructor options or env vars.
- `profile/schema.mjs` — canonical profile shape + `validateProfile`,
  `createEmptyProfile`, `mergeProfile`.
- `profile/store.mjs` — `ProfileStore`: per-user dirs, load/save YAML
  (validate-on-load), list/exists, tracker bootstrap.
- `profile/attachments.mjs` — import & catalogue past resumes / cover letters /
  docs into a user's `attachments/` (archive-only; see §8).
- `onboarding/questions.mjs` — canonical question-id list + `demoAnswers`.
- `onboarding/prompter.mjs` — `ReadlinePrompter` (TTY) and `ScriptedPrompter`
  (array/map of answers; `failOnExhaustion` for piped input) sharing one
  interface.
- `onboarding/intake.mjs` — drives the interview (inline `required`/`validate`
  re-prompting) → builds + validates a profile → persists via `ProfileStore`.
- `tracker/csv.mjs` — generalized RFC-4180 CSV adapter (readAll/appendRow/
  updateRow) with a documented column schema and formula-injection guarding.
- `core/logger.mjs`, `core/pipeline.mjs` (FSM), `core/orchestrator.mjs`.
- `agents/base.mjs`, `scanner.mjs` (offline-first + Greenhouse/Lever/Ashby),
  `evaluator.mjs` (config-driven scoring), `application.mjs`, `followup.mjs`.
- `resume/builder.mjs` — fact cards, grounded `ResumeSpec`, Markdown renderer,
  identity-parameterized validation.

## 5. The Provider abstraction

One interface, five implementations:

```js
class LLMProvider {
  async complete(prompt, options) {}          // -> string
  async embed(text) {}                         // -> number[]
  async structured(prompt, schema, options) {} // -> object
  describe() {}                                 // -> {name, model, capabilities}
}
```

`createProvider(name, options)` resolves `name` (or `LLM_PROVIDER` env) to one of:

| name        | Transport                                                     | Auth env                                   |
|-------------|---------------------------------------------------------------|--------------------------------------------|
| `openai`    | `POST {baseUrl}/chat/completions`                              | `OPENAI_API_KEY`                           |
| `anthropic` | `POST {baseUrl}/messages` (`anthropic-version` header)         | `ANTHROPIC_API_KEY`                        |
| `bedrock`   | `POST bedrock-runtime.{region}.amazonaws.com/model/{id}/invoke`| `AWS_BEARER_TOKEN_BEDROCK` (Bedrock API key)|
| `kiro`      | OpenAI-compatible gateway (configurable base URL)              | `KIRO_API_KEY` (+ `KIRO_BASE_URL`)         |
| `local`     | Ollama `POST {baseUrl}/generate`                               | none                                       |

Design choices:
- **Bedrock** uses the modern **Bedrock API key / bearer-token** flow against the
  Bedrock Runtime REST endpoint, so no AWS SDK or SigV4 signing dependency is
  needed. It formats requests for Anthropic Claude on Bedrock (the common case)
  and is model-configurable.
- **Kiro** is implemented as an **OpenAI-compatible** client because Kiro's LLM
  gateway exposes a chat-completions-shaped surface; the base URL, model, and
  key are configurable so it can also point at a Bedrock-backed gateway.
- Capabilities are advertised via `describe()` so callers can degrade
  gracefully. **Anthropic** and **Kiro** report `embed: false` (chat-only);
  **OpenAI**, **Bedrock** (Titan), and **local** report `embed: true`.

## 6. Profile schema (generalized)

```yaml
schemaVersion: 1
identity:
  name: ""            # required
  email: ""           # required
  phone: ""
  location: ""
links:                # arbitrary socials; linkedin/github first-class
  linkedin: ""
  github: ""
  website: ""
  twitter: ""
  other: []           # [{label, url}]
summary: ""
targetRoles: []       # drives scoring keywords
skills: []            # [string]
experience:           # [{company, role, location, period, context, bullets[]}]
education:            # [{institution, degree, field, period}]
publications:         # [{title, venue, summary, url}]
preferences:
  provider: ""        # openai | anthropic | bedrock | kiro | local
  locations: { allow: [], block: [] }
  scoring: { positive: {term: weight}, negative: {term: weight}, companyBonus: {} }
attachments:          # catalogued past resumes / cover letters / freeform
  - { id, kind: resume|cover-letter|other, label, path, importedAt }
freeform: []          # [{label, content}] anything the user wants to add
```

`validateProfile` enforces required identity fields and structural types and is
used by both onboarding and the resume builder.

## 7. Onboarding intake flow

`intake({ prompter, store, userId })`:
1. Ask identity (name*, email*, phone, location).
2. Ask socials/links (LinkedIn, GitHub, website, X, and a repeatable "any other
   link" loop).
3. Ask target roles, skills, summary.
4. Ask to **import past resumes / cover letters** (file paths → copied into the
   user's `attachments/`, catalogued with kind + label). Imports are **archived
   for reference today** — they are not yet parsed into resume evidence (see §8).
5. Ask for **freeform additions** ("anything else you want ApplyKit to know?")
   in a repeatable loop.
6. Ask for **LLM provider** preference (openai/anthropic/bedrock/kiro/local).
7. Build → `validateProfile` → `store.saveProfile` → bootstrap the user's
   tracker + applications dir.

Required fields (name, email) re-prompt until provided, and email is validated
inline. Driven by the injected `prompter`, intake is identical for a human at a
terminal, a scripted test, and piped stdin. The `Prompter` interface (`ask`,
`confirm`, `select`) has two implementations:
- `ReadlinePrompter` for real terminal use.
- `ScriptedPrompter` for tests/automation/piped input (answers supplied up
  front; `failOnExhaustion` makes a too-short piped input fail fast rather than
  loop), enabling full end-to-end coverage with **zero** interactivity.

## 8. Resume generation (grounded, Markdown)

ApplyKit performs **deterministic, grounded transcription** — it never
fabricates content. It selects and formats facts straight from the profile;
the value-add is structure, keyword-aware skill ordering, and an enforced
anti-fabrication guarantee, not generative writing.

- Build **fact cards** from `experience`/`publications` with **unique** ids
  (`ACME-0-001`, role-index-scoped) and `sourcePath` evidence refs
  (`experience[0].bullets[1]`).
- Build a `ResumeSpec` (identity, summary, selected experience, skills grid)
  where **every bullet carries `evidenceRefs`**.
- `validateResumeSpec` fails on: missing identity/summary/skills, no content
  section at all, placeholder text (`lorem ipsum`/`PLACEHOLDER`), bullets
  without evidence refs, evidence refs pointing at unknown cards, **a bullet
  whose text drifts from its cited card's claim** (the teeth: this rejects any
  externally-authored/hand-edited/future-LLM bullet that isn't backed by
  evidence), and skills not present in the profile. All checks are
  **parameterized by `spec.identity`** — no hard-coded names.
- Education and publications are **optional**, so early-career / career-changer
  users (skills + education, no work history) can still generate a resume.
- `renderMarkdown(spec)` emits a clean, ATS-friendly Markdown resume, omitting
  empty sections.

> **Attachments are archive-only today.** Imported resumes/cover letters are
> stored safely but not parsed into fact cards; only structured profile fields
> become resume evidence. Parsing attachments into evidence is a documented
> future extension.

## 9. Testing strategy

All tests use the Node built-in runner, are hermetic, and avoid network/native
deps:
- **Providers:** factory resolution, interface compliance, and request shaping
  verified by stubbing `global.fetch` (assert URL/headers/body, return canned
  responses). No real API calls.
- **Profile/onboarding:** `ScriptedPrompter` drives a full intake into a temp
  `data/` dir; assert the persisted profile, attachments catalogue, and tracker
  bootstrap.
- **Tracker:** round-trip CSV incl. quoted fields/newlines; append dedupe;
  update-by-key.
- **Pipeline/orchestrator:** state-machine transition legality; an offline
  end-to-end run with a mock provider produces all five stage results.
- **Resume:** grounding/validation failures and a successful Markdown render.
- **No-personal-data guard:** repo grep invariant.

## 10. Extensibility

- New provider = new file implementing `LLMProvider` + one factory case.
- New attachment kind / question = one entry in `questions.mjs`.
- PDF output = a renderer consuming the existing `ResumeSpec`.
- Web UI / scheduler = layer over the same orchestrator (as the source did).
