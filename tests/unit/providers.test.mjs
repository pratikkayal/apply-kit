import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  createProvider,
  SUPPORTED_PROVIDERS,
  OpenAIProvider,
  AnthropicProvider,
  BedrockProvider,
  KiroProvider,
  LocalProvider,
  NotImplementedError,
} from "../../src/providers/index.mjs";
import { parseJsonResponse } from "../../src/providers/base.mjs";

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

/** Install a fetch stub that records the last call and returns `body`. */
function stubFetch(body, { ok = true, status = 200 } = {}) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init, parsedBody: init?.body ? JSON.parse(init.body) : undefined });
    return {
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  return calls;
}

describe("provider factory", () => {
  it("resolves every supported provider name", () => {
    const expected = {
      openai: OpenAIProvider,
      anthropic: AnthropicProvider,
      bedrock: BedrockProvider,
      kiro: KiroProvider,
      local: LocalProvider,
    };
    for (const name of SUPPORTED_PROVIDERS) {
      assert.ok(createProvider(name) instanceof expected[name], `${name} should resolve`);
    }
  });

  it("honors LLM_PROVIDER and an explicit override", () => {
    process.env.LLM_PROVIDER = "anthropic";
    assert.ok(createProvider() instanceof AnthropicProvider);
    assert.ok(createProvider("bedrock") instanceof BedrockProvider);
  });

  it("treats 'ollama' as an alias for local", () => {
    assert.ok(createProvider("ollama") instanceof LocalProvider);
  });

  it("throws for an unknown provider", () => {
    assert.throws(() => createProvider("nonexistent"), /Unknown LLM provider/);
  });
});

describe("interface compliance", () => {
  for (const name of SUPPORTED_PROVIDERS) {
    it(`${name} implements the interface and describe()`, () => {
      const p = createProvider(name);
      assert.equal(typeof p.complete, "function");
      assert.equal(typeof p.embed, "function");
      assert.equal(typeof p.structured, "function");
      const d = p.describe();
      assert.equal(d.name, name);
      assert.equal(typeof d.capabilities.complete, "boolean");
    });
  }
});

describe("OpenAI request shaping", () => {
  it("posts to chat/completions with bearer auth and returns content", async () => {
    const calls = stubFetch({ choices: [{ message: { content: "hi" } }] });
    const p = new OpenAIProvider({ apiKey: "k", model: "gpt-x" });
    const out = await p.complete("hello");
    assert.equal(out, "hi");
    assert.match(calls[0].url, /\/chat\/completions$/);
    assert.equal(calls[0].init.headers.Authorization, "Bearer k");
    assert.equal(calls[0].parsedBody.model, "gpt-x");
    assert.equal(calls[0].parsedBody.messages[0].content, "hello");
  });

  it("complete() without an API key throws", async () => {
    const p = new OpenAIProvider({ apiKey: "" });
    await assert.rejects(() => p.complete("x"), /API key is not configured/);
  });

  it("structured() parses JSON content", async () => {
    stubFetch({ choices: [{ message: { content: '{"score":4}' } }] });
    const p = new OpenAIProvider({ apiKey: "k" });
    assert.deepEqual(await p.structured("x", {}), { score: 4 });
  });

  it("surfaces non-2xx as an error", async () => {
    stubFetch({ error: "bad" }, { ok: false, status: 401 });
    const p = new OpenAIProvider({ apiKey: "k" });
    await assert.rejects(() => p.complete("x"), /openai API error 401/);
  });
});

describe("Anthropic request shaping", () => {
  it("posts to /messages with x-api-key + version and parses text block", async () => {
    const calls = stubFetch({ content: [{ type: "text", text: "claude" }] });
    const p = new AnthropicProvider({ apiKey: "ak", model: "claude-x" });
    const out = await p.complete("hi");
    assert.equal(out, "claude");
    assert.match(calls[0].url, /\/messages$/);
    assert.equal(calls[0].init.headers["x-api-key"], "ak");
    assert.equal(calls[0].init.headers["anthropic-version"], "2023-06-01");
  });

  it("does not support embeddings", async () => {
    const p = new AnthropicProvider({ apiKey: "ak" });
    assert.equal(p.describe().capabilities.embed, false);
    await assert.rejects(() => p.embed("x"), NotImplementedError);
  });
});

describe("Bedrock request shaping", () => {
  it("invokes the runtime model endpoint with bearer token and Anthropic schema", async () => {
    const calls = stubFetch({ content: [{ type: "text", text: "bedrock" }] });
    const p = new BedrockProvider({ apiKey: "bk", region: "eu-west-1", model: "anthropic.claude-3" });
    const out = await p.complete("hi");
    assert.equal(out, "bedrock");
    assert.match(calls[0].url, /bedrock-runtime\.eu-west-1\.amazonaws\.com\/model\/anthropic\.claude-3\/invoke$/);
    assert.equal(calls[0].init.headers.Authorization, "Bearer bk");
    assert.equal(calls[0].parsedBody.anthropic_version, "bedrock-2023-05-31");
  });

  it("embeds via the Titan model with inputText", async () => {
    const calls = stubFetch({ embedding: [0.1, 0.2] });
    const p = new BedrockProvider({ apiKey: "bk" });
    const vec = await p.embed("hello");
    assert.deepEqual(vec, [0.1, 0.2]);
    assert.match(calls[0].url, /titan-embed/);
    assert.equal(calls[0].parsedBody.inputText, "hello");
  });

  it("reports embed capability true (Titan-backed)", () => {
    assert.equal(new BedrockProvider({ apiKey: "bk" }).describe().capabilities.embed, true);
  });

  it("requires a bearer token", async () => {
    const p = new BedrockProvider({ apiKey: "" });
    await assert.rejects(() => p.complete("x"), /AWS_BEARER_TOKEN_BEDROCK/);
  });
});

describe("Kiro request shaping", () => {
  it("posts OpenAI-compatible chat to the configured gateway", async () => {
    const calls = stubFetch({ choices: [{ message: { content: "kiro" } }] });
    const p = new KiroProvider({ apiKey: "kk", baseUrl: "https://gw.example/v1/", model: "kiro-x" });
    const out = await p.complete("hi");
    assert.equal(out, "kiro");
    // trailing slash on baseUrl is tolerated
    assert.equal(calls[0].url, "https://gw.example/v1/chat/completions");
    assert.equal(calls[0].init.headers.Authorization, "Bearer kk");
  });

  it("requires base URL and key", async () => {
    await assert.rejects(() => new KiroProvider({ apiKey: "k", baseUrl: "" }).complete("x"), /base URL/);
    await assert.rejects(() => new KiroProvider({ apiKey: "", baseUrl: "https://x" }).complete("x"), /API key/);
  });

  it("reports embed capability false", () => {
    assert.equal(new KiroProvider({ apiKey: "k", baseUrl: "https://x" }).describe().capabilities.embed, false);
  });
});

describe("fetchJson timeout", () => {
  it("surfaces a clear timeout error when the request aborts", async () => {
    const realFetch = global.fetch;
    process.env.APPLYKIT_HTTP_TIMEOUT_MS = "5";
    // Simulate an abort: reject with a TimeoutError-like error.
    global.fetch = async () => {
      const e = new Error("aborted");
      e.name = "TimeoutError";
      throw e;
    };
    try {
      const p = new OpenAIProvider({ apiKey: "k" });
      await assert.rejects(() => p.complete("x"), /timed out after 5ms/);
    } finally {
      global.fetch = realFetch;
      delete process.env.APPLYKIT_HTTP_TIMEOUT_MS;
    }
  });
});

describe("Local (Ollama) request shaping", () => {
  it("posts to /generate and returns response", async () => {
    const calls = stubFetch({ response: "local" });
    const p = new LocalProvider({ baseUrl: "http://h/api", model: "llama" });
    assert.equal(await p.complete("hi"), "local");
    assert.match(calls[0].url, /\/generate$/);
    assert.equal(calls[0].parsedBody.model, "llama");
  });
});

describe("parseJsonResponse helper", () => {
  it("parses raw JSON", () => {
    assert.deepEqual(parseJsonResponse('{"a":1}', "test"), { a: 1 });
  });
  it("parses JSON inside code fences", () => {
    assert.deepEqual(parseJsonResponse('```json\n{"a":1}\n```', "test"), { a: 1 });
  });
  it("parses JSON embedded in prose", () => {
    assert.deepEqual(parseJsonResponse('Sure! {"a":1} done', "test"), { a: 1 });
  });
  it("throws with a snippet on unparseable content", () => {
    assert.throws(() => parseJsonResponse("not json", "test"), /not valid JSON/);
  });
});
