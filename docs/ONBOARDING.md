# Onboarding Guide

ApplyKit onboards a **new person** through a guided interview and turns their
answers into a validated profile plus an isolated workspace.

## Running onboarding

```bash
# Interactive (prompts in your terminal)
npm run onboard

# Non-interactive demo with synthetic answers (no real data)
npm run onboard -- --demo --user demo

# Choose an explicit user id (otherwise derived from the entered name)
npm run onboard -- --user jordan
```

## What it asks

1. **Identity** — name (required), email (required), phone, location.
2. **Socials & links** — LinkedIn, GitHub, website, X, plus a repeatable
   "add another link" loop for anything else (Scholar, Dribbble, etc.).
3. **Target roles & skills** — comma-separated; target roles also drive fit
   scoring.
4. **Summary** — a one-line professional headline.
5. **Experience** (repeatable) — company, role, period, location, context, and
   achievement bullets. Bullets become grounded resume evidence.
6. **Education** (repeatable).
7. **Attachments** — import past resumes / cover letters / other documents by
   path. Files are **copied** into your workspace; originals are untouched.
8. **Freeform additions** (repeatable) — anything else you want ApplyKit to
   know (work authorization, preferences, achievements).
9. **Provider** — your preferred LLM provider.

## What it produces

```
data/users/<id>/
  profile.yml        validated canonical profile
  tracker.csv        per-user application tracker (header bootstrapped)
  attachments/       imported resumes / cover letters / docs
  applications/      per-role material folders (created on demand)
```

## Scripting / automating onboarding

Onboarding is driven through a `Prompter` interface with two implementations:

- `ReadlinePrompter` — real terminal prompts.
- `ScriptedPrompter` — answers supplied up front (used by `--demo` and tests).

Answers are keyed by question id (see `src/onboarding/questions.mjs`). For
repeatable loops, pass an **array** as the answer — each visit consumes the next
element, and a falsy gate ends the loop:

```js
import { ScriptedPrompter } from "./src/onboarding/prompter.mjs";
import { runIntake } from "./src/onboarding/intake.mjs";

const prompter = new ScriptedPrompter({
  answers: {
    name: "Jordan Vega",
    email: "jordan@example.com",
    target_roles: "Staff Engineer, Backend Engineer",
    skills: "Go, Kubernetes, gRPC",
    summary: "Distributed-systems engineer.",
    add_experience: [true, false],     // add exactly one experience entry
    exp_company: "Globex",
    exp_role: "Staff Engineer",
    exp_add_bullet: [true, false],     // one bullet
    exp_bullet: "Scaled service to 1M rps",
    provider: "bedrock",
  },
});

const { userId, profile } = await runIntake({ prompter, userId: "jordan" });
```

## After onboarding

```bash
# Generate a resume for a discovered role
npm run resume -- --user <id> --company "Acme" --title "Backend Engineer" \
  --jd path/to/job-description.txt --out out/acme.md

# Run the full pipeline
npm run apply -- --user <id> --provider openai
```
