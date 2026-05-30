import { LLMProvider, fetchJson, parseJsonResponse } from "./base.mjs";

/**
 * Kiro provider.
 *
 * Kiro exposes an OpenAI-compatible chat-completions surface through a
 * configurable gateway. Point `KIRO_BASE_URL` at the gateway and set
 * `KIRO_API_KEY`; the model is configurable via `KIRO_MODEL`. Because the wire
 * format is OpenAI-compatible, the same gateway can be backed by Bedrock or
 * another upstream without changing this client.
 */

const DEFAULT_MODEL = "kiro-default";

export class KiroProvider extends LLMProvider {
  constructor(options = {}) {
    super(options);
    this.apiKey = options.apiKey || process.env.KIRO_API_KEY || "";
    this.baseUrl = options.baseUrl || process.env.KIRO_BASE_URL || "";
    this.model = options.model || process.env.KIRO_MODEL || process.env.LLM_MODEL || DEFAULT_MODEL;
  }

  get name() {
    return "kiro";
  }

  describe() {
    return {
      name: this.name,
      model: this.model,
      capabilities: { complete: true, embed: false, structured: true },
    };
  }

  _requireConfig() {
    if (!this.baseUrl) {
      throw new Error("Kiro base URL is not configured. Set KIRO_BASE_URL or pass { baseUrl }.");
    }
    if (!this.apiKey) {
      throw new Error("Kiro API key is not configured. Set KIRO_API_KEY or pass { apiKey }.");
    }
  }

  _headers() {
    this._requireConfig();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  _chatUrl() {
    // Tolerate base URLs supplied with or without a trailing slash.
    return `${this.baseUrl.replace(/\/$/, "")}/chat/completions`;
  }

  async complete(prompt, options = {}) {
    const data = await fetchJson(
      this._chatUrl(),
      {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({
          model: options.model || this.model,
          messages: [{ role: "user", content: prompt }],
          temperature: options.temperature ?? this.temperature,
          max_tokens: options.maxTokens ?? this.maxTokens,
        }),
      },
      this.name,
    );
    return data.choices?.[0]?.message?.content || "";
  }

  async structured(prompt, schema, options = {}) {
    const data = await fetchJson(
      this._chatUrl(),
      {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({
          model: options.model || this.model,
          messages: [
            { role: "system", content: `Respond with valid JSON matching this schema. No other text.\n${JSON.stringify(schema)}` },
            { role: "user", content: prompt },
          ],
          temperature: options.temperature ?? 0.3,
          max_tokens: options.maxTokens ?? this.maxTokens,
        }),
      },
      this.name,
    );
    return parseJsonResponse(data.choices?.[0]?.message?.content || "{}", this.name);
  }
}
