/**
 * Base agent. All pipeline agents extend this and implement execute().
 */
export class BaseAgent {
  constructor({ name, description }) {
    this.name = name;
    this.description = description;
    this._status = "idle";
    this._lastRun = null;
    this._lastError = null;
  }

  /**
   * @param {object} context - pipeline context (jobs, profile, provider, tracker, ...)
   * @returns {Promise<object>}
   */
  async execute(context) {
    throw new Error(`${this.constructor.name}.execute() not implemented`);
  }

  getStatus() {
    return {
      name: this.name,
      status: this._status,
      lastRun: this._lastRun,
      lastError: this._lastError,
    };
  }

  _setRunning() {
    this._status = "running";
  }
  _setComplete() {
    this._status = "idle";
    this._lastRun = new Date().toISOString();
    this._lastError = null;
  }
  _setError(error) {
    this._status = "error";
    this._lastRun = new Date().toISOString();
    this._lastError = error?.message || String(error);
  }
}
