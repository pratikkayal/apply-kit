import { LLMProvider, fetchJson, parseJsonResponse } from "./base.mjs";

const DEFAULT_BASE_URL = "http://localhost:11434/api";
const DEFAULT_MODEL = "llama3";

/**
 * Local provider backed by an Ollama-compatible server. Useful for offline
 * development and CI smoke tests without any API key.
 */
export class LocalProvider extends LLMProvider {
  constructor(options = {}) {
    super(options);
    this.baseUrl = options.baseUrl || process.env.OLLAMA_URL || DEFAULT_BASE_URL;
    this.model = options.model || process.env.OLLAMA_MODEL || process.env.LLM_MODEL || DEFAULT_MODEL;
  }

  get name() {
    return "local";
  }

  async complete(prompt, options = {}) {
    const data = await fetchJson(
      `${this.baseUrl}/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: options.model || this.model,
          prompt,
          stream: false,
          options: { temperature: options.temperature ?? this.temperature },
        }),
      },
      this.name,
    );
    return data.response || "";
  }

  async embed(text) {
    const data = await fetchJson(
      `${this.baseUrl}/embeddings`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: text }),
      },
      this.name,
    );
    return data.embedding || [];
  }

  async structured(prompt, schema, options = {}) {
    const data = await fetchJson(
      `${this.baseUrl}/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: options.model || this.model,
          prompt: `Respond with valid JSON matching this schema. No other text.\nSchema: ${JSON.stringify(schema)}\n\nRequest: ${prompt}`,
          stream: false,
          format: "json",
          options: { temperature: options.temperature ?? 0.3 },
        }),
      },
      this.name,
    );
    return parseJsonResponse(data.response || "{}", this.name);
  }
}
