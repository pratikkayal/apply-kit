import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ProfileStore } from "../../src/profile/store.mjs";
import { importAttachment } from "../../src/profile/attachments.mjs";
import { createEmptyProfile, mergeProfile } from "../../src/profile/schema.mjs";

let dir;
let store;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "applykit-store-"));
  store = new ProfileStore({ dataDir: dir });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function validProfile(extra = {}) {
  return mergeProfile(createEmptyProfile(), {
    identity: { name: "Alex Doe", email: "alex@example.com" },
    ...extra,
  });
}

describe("ProfileStore", () => {
  it("ensureWorkspace creates dirs and a bootstrapped tracker", () => {
    const id = store.ensureWorkspace("Alex Doe");
    assert.equal(id, "alex-doe");
    assert.ok(existsSync(store.attachmentsDir(id)));
    assert.ok(existsSync(store.applicationsDir(id)));
    assert.ok(existsSync(store.trackerPath(id)));
  });

  it("saves and loads a profile round-trip", () => {
    const p = validProfile({ skills: ["Node.js"] });
    const saved = store.saveProfile("alex", p);
    assert.ok(existsSync(saved));
    assert.ok(store.exists("alex"));
    const loaded = store.loadProfile("alex");
    assert.equal(loaded.identity.name, "Alex Doe");
    assert.deepEqual(loaded.skills, ["Node.js"]);
  });

  it("saveProfile rejects an invalid profile", () => {
    assert.throws(() => store.saveProfile("bad", createEmptyProfile()), /identity.name is required/);
  });

  it("listUsers returns only dirs with a profile", () => {
    store.saveProfile("alex", validProfile());
    store.ensureWorkspace("no-profile-yet");
    assert.deepEqual(store.listUsers(), ["alex"]);
  });

  it("loadProfile throws for an unknown user", () => {
    assert.throws(() => store.loadProfile("ghost"), /no profile for user/);
  });
});

describe("importAttachment", () => {
  it("copies a file into attachments and returns a portable catalogue entry", () => {
    const id = store.ensureWorkspace("alex");
    const src = path.join(dir, "my-resume.pdf");
    writeFileSync(src, "%PDF-1.4 fake");
    const entry = importAttachment({
      sourcePath: src,
      kind: "resume",
      attachmentsDir: store.attachmentsDir(id),
      label: "Main resume",
    });
    assert.equal(entry.kind, "resume");
    assert.equal(entry.label, "Main resume");
    assert.equal(entry.originalName, "my-resume.pdf");
    assert.match(entry.path, /^attachments\//);
    // file actually copied; original preserved
    assert.ok(existsSync(path.join(store.userDir(id), entry.path)));
    assert.ok(existsSync(src));
  });

  it("rejects an unknown kind and a missing source", () => {
    const id = store.ensureWorkspace("alex");
    assert.throws(
      () => importAttachment({ sourcePath: "x", kind: "passport", attachmentsDir: store.attachmentsDir(id) }),
      /kind must be one of/,
    );
    assert.throws(
      () => importAttachment({ sourcePath: "/nope/missing.pdf", kind: "resume", attachmentsDir: store.attachmentsDir(id) }),
      /source not found/,
    );
  });
});
