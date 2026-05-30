import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildFactCards,
  buildResumeSpec,
  validateResumeSpec,
  renderMarkdown,
  generateResume,
} from "../../src/resume/builder.mjs";
import { createEmptyProfile, mergeProfile } from "../../src/profile/schema.mjs";

function richProfile(extra = {}) {
  return mergeProfile(createEmptyProfile(), {
    identity: { name: "Alex Doe", email: "alex@example.com", location: "Remote" },
    links: { github: "https://github.com/alexdoe", other: [{ label: "Scholar", url: "https://s/alex" }] },
    summary: "Backend engineer who ships reliable services.",
    targetRoles: ["Senior Backend Engineer"],
    skills: ["Node.js", "PostgreSQL", "AWS"],
    experience: [
      {
        company: "Globex",
        role: "Senior Software Engineer",
        location: "Remote",
        period: "2021 - Present",
        context: "Payments platform team.",
        bullets: ["Built an idempotent payments API.", "Cut p99 latency by 45% via partitioning."],
      },
    ],
    education: [{ institution: "State University", degree: "B.S.", field: "CS", period: "2013 - 2017" }],
    publications: [{ title: "Idempotency Patterns", venue: "Journal", summary: "A survey." }],
    ...extra,
  });
}

describe("buildFactCards", () => {
  it("creates stable ids and sourcePath evidence refs", () => {
    const cards = buildFactCards(richProfile());
    const paths = cards.map((c) => c.sourcePath);
    assert.ok(paths.includes("experience[0].context"));
    assert.ok(paths.includes("experience[0].bullets[0]"));
    assert.ok(paths.includes("publications[0]"));
    assert.ok(cards.every((c) => typeof c.id === "string" && c.id.length > 0));
  });
  it("creates unique ids even for repeated employers", () => {
    const cards = buildFactCards(mergeProfile(createEmptyProfile(), {
      identity: { name: "A", email: "a@b.co" },
      experience: [
        { company: "Google", role: "SWE", bullets: ["First stint bullet."] },
        { company: "Google", role: "Staff SWE", bullets: ["Second stint bullet."] },
      ],
    }));
    const ids = cards.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, `ids must be unique, got ${ids.join(", ")}`);
  });
});

describe("buildResumeSpec / validateResumeSpec", () => {
  it("produces a grounded, valid spec where every bullet has evidence refs", () => {
    const spec = buildResumeSpec(richProfile(), { title: "Senior Backend Engineer", text: "node.js postgresql" });
    assert.equal(validateResumeSpec(spec), true);
    for (const role of spec.experience) {
      for (const bullet of role.bullets) {
        assert.ok(bullet.evidenceRefs.length > 0, "bullet must cite evidence");
      }
    }
  });

  it("reorders skills so JD keywords come first", () => {
    const spec = buildResumeSpec(richProfile(), { text: "we use postgresql heavily" });
    assert.equal(spec.skillsGrid[0], "PostgreSQL");
  });

  it("rejects a spec with no content sections at all", () => {
    // No experience, education, or publications -> not enough to build a resume.
    const spec = buildResumeSpec(mergeProfile(createEmptyProfile(), {
      identity: { name: "A", email: "a@b.co" },
      summary: "A short summary.",
      skills: ["X"],
    }));
    assert.throws(() => validateResumeSpec(spec), /at least one of experience, education, or publications/);
  });

  it("allows an early-career user with education but no experience", () => {
    const spec = buildResumeSpec(mergeProfile(createEmptyProfile(), {
      identity: { name: "Sam Lee", email: "sam@example.com" },
      summary: "Recent CS graduate seeking backend roles.",
      skills: ["Python", "SQL"],
      education: [{ institution: "State University", degree: "B.S.", field: "CS", period: "2021 - 2025" }],
    }));
    assert.equal(validateResumeSpec(spec), true);
    const md = renderMarkdown(spec);
    assert.doesNotMatch(md, /## Work Experience/); // no empty section
    assert.match(md, /## Education/);
  });

  it("rejects placeholder text (lorem ipsum) but allows legitimate 'TODO'", () => {
    assert.throws(
      () => validateResumeSpec(buildResumeSpec(richProfile({ summary: "lorem ipsum dolor sit amet" }))),
      /placeholder text/,
    );
    // A real bullet containing "TODO" must NOT trip the placeholder guard.
    const ok = richProfile();
    ok.experience[0].bullets = ["Built a TODO-list app used by 10k people."];
    assert.equal(validateResumeSpec(buildResumeSpec(ok)), true);
  });

  it("grounding has teeth: rejects a bullet whose text drifts from its cited evidence", () => {
    const spec = buildResumeSpec(richProfile());
    // Keep the (valid) evidence ref but mutate the bullet text — simulates an
    // externally-authored or hallucinated bullet that no longer matches.
    spec.experience[0].bullets[0].text = "Single-handedly increased revenue by 900%.";
    assert.throws(() => validateResumeSpec(spec), /not grounded in its cited evidence/);
  });

  it("rejects skills not supported by the profile", () => {
    const spec = buildResumeSpec(richProfile());
    spec.skillsGrid.push("Quantum Welding");
    assert.throws(() => validateResumeSpec(spec), /unsupported skill: Quantum Welding/);
  });

  it("rejects a bullet whose evidence ref is unknown", () => {
    const spec = buildResumeSpec(richProfile());
    spec.experience[0].bullets[0].evidenceRefs = ["GHOST-001"];
    assert.throws(() => validateResumeSpec(spec), /unknown evidence card: GHOST-001/);
  });

  it("validation is identity-parameterized (works for any name)", () => {
    const spec = buildResumeSpec(richProfile({ identity: { name: "Jordan Vega", email: "j@v.co" } }));
    assert.equal(validateResumeSpec(spec), true);
  });
});

describe("renderMarkdown / generateResume", () => {
  it("renders the expected sections and contact line", () => {
    const { markdown } = generateResume({
      profile: richProfile(),
      job: { company: "Acme", title: "Senior Backend Engineer", description: "node.js postgresql aws" },
    });
    assert.match(markdown, /^# Alex Doe/m);
    assert.match(markdown, /## Profile/);
    assert.match(markdown, /## Work Experience/);
    assert.match(markdown, /## Core Skills/);
    assert.match(markdown, /## Education/);
    assert.match(markdown, /## Selected Publications/);
    assert.match(markdown, /alex@example\.com/);
    assert.match(markdown, /github\.com\/alexdoe/);
    // no placeholder leakage
    assert.doesNotMatch(markdown, /TODO|TBD|lorem ipsum/i);
  });
});
