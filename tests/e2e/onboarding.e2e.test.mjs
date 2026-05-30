import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ScriptedPrompter } from "../../src/onboarding/prompter.mjs";
import { runIntake } from "../../src/onboarding/intake.mjs";
import { demoAnswers } from "../../src/onboarding/questions.mjs";
import { ProfileStore } from "../../src/profile/store.mjs";
import { validateProfile } from "../../src/profile/schema.mjs";

let dir;
let store;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "applykit-onboard-"));
  store = new ProfileStore({ dataDir: dir });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("onboarding e2e", () => {
  it("runs the demo answer set end-to-end and persists a valid profile + tracker", async () => {
    const prompter = new ScriptedPrompter({ answers: demoAnswers() });
    const { userId, profile, profilePath } = await runIntake({ prompter, store, userId: "demo" });

    assert.equal(userId, "demo");
    assert.equal(validateProfile(profile), true);
    assert.equal(profile.identity.name, "Alex Doe");
    assert.equal(profile.links.linkedin, "https://linkedin.com/in/alexdoe-example");
    assert.deepEqual(profile.targetRoles, ["Senior Software Engineer", "Backend Engineer"]);
    assert.equal(profile.preferences.provider, "openai");
    // persisted artifacts
    assert.ok(existsSync(profilePath));
    assert.ok(existsSync(store.trackerPath("demo")));
    assert.ok(store.exists("demo"));
  });

  it("captures repeatable links, an experience entry, an imported attachment, and freeform notes", async () => {
    const resumeFile = path.join(dir, "old-resume.pdf");
    writeFileSync(resumeFile, "%PDF fake");

    const prompter = new ScriptedPrompter({
      answers: demoAnswers({
        // one extra link
        more_links: [true, false],
        link_label: "Scholar",
        link_url: "https://scholar.example/alex",
        // one experience entry with two bullets
        add_experience: [true, false],
        exp_company: "Globex",
        exp_role: "Senior Engineer",
        exp_period: "2021 - Present",
        exp_location: "Remote",
        exp_context: "Payments team",
        exp_add_bullet: [true, true, false],
        exp_bullet: ["Built payments API", "Cut latency 45%"],
        // import one attachment
        add_attachment: [true, false],
        attachment_path: resumeFile,
        attachment_kind: "resume",
        attachment_label: "Old resume",
        // one freeform note
        add_freeform: [true, false],
        freeform_label: "Visa",
        freeform_content: "EU + US authorized",
      }),
    });

    const { profile } = await runIntake({ prompter, store, userId: "alex" });

    assert.deepEqual(profile.links.other, [{ label: "Scholar", url: "https://scholar.example/alex" }]);
    assert.equal(profile.experience.length, 1);
    assert.deepEqual(profile.experience[0].bullets, ["Built payments API", "Cut latency 45%"]);
    assert.equal(profile.attachments.length, 1);
    assert.equal(profile.attachments[0].kind, "resume");
    assert.equal(profile.attachments[0].label, "Old resume");
    // attachment file actually copied into the workspace
    assert.ok(existsSync(path.join(store.userDir("alex"), profile.attachments[0].path)));
    assert.deepEqual(profile.freeform, [{ label: "Visa", content: "EU + US authorized" }]);
  });

  it("re-prompts until required identity fields are provided", async () => {
    // name empty first, then provided; email empty first, then provided.
    const prompter = new ScriptedPrompter({
      answers: demoAnswers({
        name: ["", "Alex Doe"],
        email: ["", "alex@example.com"],
      }),
    });
    const { profile } = await runIntake({ prompter, store, userId: "alex" });
    assert.equal(profile.identity.name, "Alex Doe");
    assert.equal(profile.identity.email, "alex@example.com");
  });

  it("re-prompts on an invalid email, then accepts a valid one", async () => {
    const prompter = new ScriptedPrompter({
      answers: demoAnswers({ email: ["not-an-email", "good@example.com"] }),
    });
    const { profile } = await runIntake({ prompter, store, userId: "alex" });
    assert.equal(profile.identity.email, "good@example.com");
  });

  it("fails fast (no infinite loop) when piped input is exhausted", async () => {
    // Simulates `printf "" | applykit-onboard`: a queue with too few answers and
    // failOnExhaustion must throw rather than spin on a required field.
    const prompter = new ScriptedPrompter({ queue: [], failOnExhaustion: true });
    await assert.rejects(() => runIntake({ prompter, store, userId: "x" }), /input exhausted/);
  });
});
