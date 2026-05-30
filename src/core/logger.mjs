/**
 * Minimal leveled logger. Level is read from LOG_LEVEL (debug|info|warn|error).
 * Writes structured-ish lines to stderr so stdout stays clean for CLI output.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function currentLevel() {
  return LEVELS[(process.env.LOG_LEVEL || "info").toLowerCase()] ?? LEVELS.info;
}

function emit(level, scope, message, meta) {
  if (LEVELS[level] < currentLevel()) return;
  const ts = new Date().toISOString();
  const base = `${ts} ${level.toUpperCase()} [${scope}] ${message}`;
  if (meta !== undefined) {
    process.stderr.write(`${base} ${safeJson(meta)}\n`);
  } else {
    process.stderr.write(`${base}\n`);
  }
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const logger = {
  debug: (scope, message, meta) => emit("debug", scope, message, meta),
  info: (scope, message, meta) => emit("info", scope, message, meta),
  warn: (scope, message, meta) => emit("warn", scope, message, meta),
  error: (scope, message, meta) => emit("error", scope, message, meta),
};
