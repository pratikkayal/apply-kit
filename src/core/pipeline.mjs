import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Pipeline state machine.
 *
 * States: idle, scanning, evaluating, generating_materials, ready, error.
 * Transitions are validated; illegal transitions throw. State is persisted to
 * a JSON file so a long-running process can recover its place.
 */

export const VALID_STATES = [
  "idle",
  "scanning",
  "evaluating",
  "generating_materials",
  "ready",
  "applying",
  "following_up",
  "error",
];

export const VALID_TRANSITIONS = {
  idle: ["scanning"],
  scanning: ["evaluating", "error", "idle"],
  evaluating: ["generating_materials", "error", "idle"],
  generating_materials: ["ready", "error", "idle"],
  ready: ["applying", "idle", "scanning", "error"],
  applying: ["following_up", "error", "idle"],
  following_up: ["idle", "error"],
  error: ["idle", "scanning"],
};

const DEFAULT_STATE_FILE = "pipeline-state.json";

/** Resolve the default state file under the configured data dir. */
function defaultStatePath() {
  const root = process.env.APPLYKIT_DATA_DIR || "data";
  return path.join(root, DEFAULT_STATE_FILE);
}

export class Pipeline {
  constructor(options = {}) {
    this._statePath = options.statePath || process.env.APPLYKIT_PIPELINE_STATE || defaultStatePath();
    this._state = this._load();
  }

  _load() {
    try {
      if (existsSync(this._statePath)) {
        const data = JSON.parse(readFileSync(this._statePath, "utf8"));
        if (VALID_STATES.includes(data.state)) return data;
      }
    } catch {
      // corrupt file -> start fresh
    }
    return { state: "idle", lastTransition: null, history: [], currentRunId: null };
  }

  _persist() {
    const dir = path.dirname(this._statePath);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this._statePath, JSON.stringify(this._state, null, 2), "utf8");
  }

  /**
   * Transition to `newState`. Throws on invalid state or illegal transition.
   * @param {string} newState
   */
  transition(newState) {
    if (!VALID_STATES.includes(newState)) {
      throw new Error(`Invalid state: ${newState}. Valid: ${VALID_STATES.join(", ")}`);
    }
    const current = this._state.state;
    const allowed = VALID_TRANSITIONS[current] || [];
    if (!allowed.includes(newState)) {
      throw new Error(`Invalid transition: ${current} -> ${newState}. Allowed: ${allowed.join(", ")}`);
    }
    const timestamp = new Date().toISOString();
    this._state.history.push({ from: current, to: newState, timestamp });
    if (this._state.history.length > 50) this._state.history = this._state.history.slice(-50);
    this._state.state = newState;
    this._state.lastTransition = timestamp;
    this._persist();
  }

  /**
   * Non-throwing check of whether a transition is currently legal.
   * @param {string} newState
   * @returns {boolean}
   */
  canTransition(newState) {
    if (!VALID_STATES.includes(newState)) return false;
    return (VALID_TRANSITIONS[this._state.state] || []).includes(newState);
  }

  getState() {
    return { ...this._state };
  }

  reset() {
    this._state.state = "idle";
    this._state.lastTransition = new Date().toISOString();
    this._state.currentRunId = null;
    this._persist();
  }
}
