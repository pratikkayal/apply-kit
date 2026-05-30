import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

import { createEmptyProfile, validateProfile, mergeProfile, slugifyUserId } from "./schema.mjs";
import { CsvTracker } from "../tracker/csv.mjs";

/**
 * Multi-user profile storage.
 *
 * Layout (rooted at the data dir, default ./data, overridable via
 * APPLYKIT_DATA_DIR or the `dataDir` option):
 *
 *   <dataDir>/users/<userId>/
 *     profile.yml          canonical profile
 *     tracker.csv          per-user application tracker
 *     attachments/         imported resumes / cover letters / docs
 *     applications/        per-role material folders (created on demand)
 */
export class ProfileStore {
  /**
   * @param {object} [options]
   * @param {string} [options.dataDir] - root data directory
   */
  constructor(options = {}) {
    this.dataDir = options.dataDir || process.env.APPLYKIT_DATA_DIR || "data";
    this.usersDir = path.join(this.dataDir, "users");
  }

  /** Absolute-ish path helpers for a user's workspace. */
  userDir(userId) {
    return path.join(this.usersDir, slugifyUserId(userId));
  }
  profilePath(userId) {
    return path.join(this.userDir(userId), "profile.yml");
  }
  trackerPath(userId) {
    return path.join(this.userDir(userId), "tracker.csv");
  }
  attachmentsDir(userId) {
    return path.join(this.userDir(userId), "attachments");
  }
  applicationsDir(userId) {
    return path.join(this.userDir(userId), "applications");
  }

  /** @returns {boolean} whether a profile exists for this user */
  exists(userId) {
    return existsSync(this.profilePath(userId));
  }

  /** @returns {string[]} all user ids that have a profile */
  listUsers() {
    if (!existsSync(this.usersDir)) return [];
    return readdirSync(this.usersDir)
      .filter((name) => {
        const p = path.join(this.usersDir, name);
        return statSync(p).isDirectory() && existsSync(path.join(p, "profile.yml"));
      })
      .sort();
  }

  /**
   * Create the directory skeleton for a user and a tracker with headers.
   * Idempotent.
   * @param {string} userId
   */
  ensureWorkspace(userId) {
    const id = slugifyUserId(userId);
    mkdirSync(this.userDir(id), { recursive: true });
    mkdirSync(this.attachmentsDir(id), { recursive: true });
    mkdirSync(this.applicationsDir(id), { recursive: true });
    new CsvTracker({ path: this.trackerPath(id) }).bootstrap();
    return id;
  }

  /**
   * Load a user's profile.
   * @param {string} userId
   * @returns {object}
   */
  loadProfile(userId) {
    const p = this.profilePath(userId);
    if (!existsSync(p)) throw new Error(`no profile for user "${userId}" at ${p}`);
    const parsed = YAML.parse(readFileSync(p, "utf8")) || {};
    const profile = mergeProfile(createEmptyProfile(), parsed);
    try {
      validateProfile(profile);
    } catch (err) {
      throw new Error(`profile for "${userId}" is invalid (${p}): ${err.message}`);
    }
    return profile;
  }

  /**
   * Validate and persist a user's profile (writes YAML). Ensures the workspace
   * exists first.
   * @param {string} userId
   * @param {object} profile
   * @returns {string} the resolved profile path
   */
  saveProfile(userId, profile) {
    validateProfile(profile);
    const id = this.ensureWorkspace(userId);
    const p = this.profilePath(id);
    writeFileSync(p, YAML.stringify(profile), "utf8");
    return p;
  }

  /** Get a CsvTracker bound to this user's tracker file. */
  tracker(userId) {
    return new CsvTracker({ path: this.trackerPath(userId) });
  }
}
