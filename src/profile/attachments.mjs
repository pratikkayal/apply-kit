import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { ATTACHMENT_KINDS } from "./schema.mjs";

/**
 * Import a past resume / cover letter / other document into a user's
 * attachments directory and return a catalogue entry to record in the profile.
 *
 * The source file is copied (never moved) so the user's originals are
 * untouched. The stored path is relative to the user's workspace so profiles
 * stay portable.
 *
 * @param {object} args
 * @param {string} args.sourcePath - path to the file the user is importing
 * @param {string} args.kind - one of ATTACHMENT_KINDS
 * @param {string} args.attachmentsDir - the user's attachments/ directory
 * @param {string} [args.label] - human label (defaults to the file name)
 * @returns {{ id, kind, label, path, originalName, importedAt }} catalogue entry
 */
export function importAttachment({ sourcePath, kind, attachmentsDir, label }) {
  if (!ATTACHMENT_KINDS.includes(kind)) {
    throw new Error(`attachment kind must be one of: ${ATTACHMENT_KINDS.join(", ")}`);
  }
  if (!sourcePath || !existsSync(sourcePath)) {
    throw new Error(`attachment source not found: ${sourcePath}`);
  }

  mkdirSync(attachmentsDir, { recursive: true });

  const originalName = path.basename(sourcePath);
  const ext = path.extname(originalName);
  const id = `${kind}-${randomUUID().slice(0, 8)}`;
  const storedName = `${id}${ext}`;
  const destPath = path.join(attachmentsDir, storedName);

  copyFileSync(sourcePath, destPath);

  return {
    id,
    kind,
    label: label || originalName,
    // Stored relative to the attachments dir so the profile is portable.
    path: path.join("attachments", storedName),
    originalName,
    importedAt: new Date().toISOString(),
  };
}
