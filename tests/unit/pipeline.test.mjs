import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Pipeline, VALID_STATES } from "../../src/core/pipeline.mjs";

let dir;
let statePath;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "applykit-pipe-"));
  statePath = path.join(dir, "state.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("Pipeline state machine", () => {
  it("starts idle", () => {
    assert.equal(new Pipeline({ statePath }).getState().state, "idle");
  });

  it("allows the legal happy-path chain and persists history", () => {
    const p = new Pipeline({ statePath });
    p.transition("scanning");
    p.transition("evaluating");
    p.transition("generating_materials");
    p.transition("ready");
    p.transition("idle");
    assert.equal(p.getState().state, "idle");
    assert.ok(p.getState().history.length >= 5);
    // reloads from disk
    assert.equal(new Pipeline({ statePath }).getState().state, "idle");
  });

  it("rejects illegal transitions", () => {
    const p = new Pipeline({ statePath });
    assert.throws(() => p.transition("evaluating"), /Invalid transition: idle -> evaluating/);
  });

  it("rejects unknown states", () => {
    const p = new Pipeline({ statePath });
    assert.throws(() => p.transition("teleport"), /Invalid state/);
  });

  it("canTransition is a non-throwing predicate", () => {
    const p = new Pipeline({ statePath });
    assert.equal(p.canTransition("scanning"), true);
    assert.equal(p.canTransition("ready"), false);
    assert.equal(p.canTransition("bogus"), false);
  });

  it("error is reachable from running states and recovers to idle", () => {
    const p = new Pipeline({ statePath });
    p.transition("scanning");
    p.transition("error");
    assert.equal(p.getState().state, "error");
    p.transition("idle");
    assert.equal(p.getState().state, "idle");
  });

  it("reset forces idle", () => {
    const p = new Pipeline({ statePath });
    p.transition("scanning");
    p.reset();
    assert.equal(p.getState().state, "idle");
  });

  it("recovers from a corrupt state file", () => {
    writeFileSync(statePath, "{ not json");
    assert.equal(new Pipeline({ statePath }).getState().state, "idle");
  });

  it("exposes the documented state set", () => {
    assert.deepEqual(VALID_STATES, [
      "idle",
      "scanning",
      "evaluating",
      "generating_materials",
      "ready",
      "applying",
      "following_up",
      "error",
    ]);
  });

  it("can reach error from the post-ready stages and recover", () => {
    const p = new Pipeline({ statePath });
    p.transition("scanning");
    p.transition("evaluating");
    p.transition("generating_materials");
    p.transition("ready");
    p.transition("applying");
    p.transition("following_up");
    assert.equal(p.canTransition("error"), true);
    p.transition("error");
    assert.equal(p.getState().state, "error");
  });
});
