export interface LlmClient {
  /** Single-turn completion. Returns raw text. */
  complete(system: string, user: string): Promise<string>;
}

/** Deterministic client for demo mode and tests. No network, no key. */
export class MockLlm implements LlmClient {
  async complete(_system: string, user: string): Promise<string> {
    return `[mock] ${user.slice(0, 200)}`;
  }
}

/** Any OpenAI-compatible chat-completions endpoint. */
export class OpenAiCompatibleLlm implements LlmClient {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey: string,
  ) {}

  async complete(system: string, user: string): Promise<string> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.4,
      }),
    });
    if (!res.ok) {
      throw new Error(`LLM request failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM returned empty completion");
    return content;
  }
}
