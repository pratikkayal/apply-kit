import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createEmptyProfile,
  validateProfile,
  mergeProfile,
  slugifyUserId,
  SCHEMA_VERSION,
} from "../../src/profile/schema.mjs";

describe("profile schema", () => {
  it("createEmptyProfile is structurally valid except for required identity", () => {
    const p = createEmptyProfile();
    assert.equal(p.schemaVersion, SCHEMA_VERSION);
    assert.throws(() => validateProfile(p), /identity.name is required/);
  });

  it("validates a complete profile", () => {
    const p = mergeProfile(createEmptyProfile(), {
      identity: { name: "Alex Doe", email: "alex@example.com" },
    });
    assert.equal(validateProfile(p), true);
  });

  it("rejects an invalid email", () => {
    const p = mergeProfile(createEmptyProfile(), { identity: { name: "A", email: "not-an-email" } });
    assert.throws(() => validateProfile(p), /valid email/);
  });

  it("rejects a bad schemaVersion", () => {
    const p = mergeProfile(createEmptyProfile(), { identity: { name: "A", email: "a@b.co" } });
    p.schemaVersion = 999;
    assert.throws(() => validateProfile(p), /unsupported schemaVersion/);
  });

  it("rejects experience without a company", () => {
    const p = mergeProfile(createEmptyProfile(), {
      identity: { name: "A", email: "a@b.co" },
      experience: [{ role: "Engineer", bullets: [] }],
    });
    assert.throws(() => validateProfile(p), /experience\[0\].company is required/);
  });

  it("rejects an attachment with an unknown kind", () => {
    const p = mergeProfile(createEmptyProfile(), {
      identity: { name: "A", email: "a@b.co" },
      attachments: [{ kind: "passport", path: "x" }],
    });
    assert.throws(() => validateProfile(p), /attachments\[0\].kind/);
  });

  it("rejects an unknown provider preference", () => {
    const p = mergeProfile(createEmptyProfile(), {
      identity: { name: "A", email: "a@b.co" },
      preferences: { provider: "skynet" },
    });
    assert.throws(() => validateProfile(p), /preferences.provider/);
  });

  it("mergeProfile replaces arrays and deep-merges objects without mutating base", () => {
    const base = createEmptyProfile();
    const merged = mergeProfile(base, {
      identity: { name: "A" },
      skills: ["x"],
      links: { github: "g" },
    });
    assert.equal(merged.identity.name, "A");
    assert.equal(merged.identity.email, ""); // preserved from base
    assert.deepEqual(merged.skills, ["x"]);
    assert.equal(merged.links.github, "g");
    // base untouched
    assert.equal(base.identity.name, "");
    assert.deepEqual(base.skills, []);
  });

  it("slugifyUserId normalizes names and rejects empties", () => {
    assert.equal(slugifyUserId("Alex Doe!!"), "alex-doe");
    assert.equal(slugifyUserId("  Multiple   Spaces  "), "multiple-spaces");
    assert.throws(() => slugifyUserId("***"), /could not derive/);
  });
});
