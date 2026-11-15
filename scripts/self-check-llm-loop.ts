import assert from "assert";
import http from "http";

// LLM agent-loop self-check (bug fix 4.6.2). Drives the REAL runConversation
// against a local mock of Gemini's OpenAI-compatible endpoint: the first
// response is a tool call shaped exactly like Gemini 3's (no `content` key,
// thought signature in extra_content), the second is the final text. Proves
// the loop executes the tool, echoes the signature back, and returns the reply.
// No DB, no network: the unknown tool name short-circuits before Prisma.
//   npm run check:llm

let calls = 0;
let echoed: { content?: unknown; tool_calls?: Array<{ extra_content?: unknown }> } | null = null;

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk: Buffer) => {
    raw += chunk.toString();
  });
  req.on("end", () => {
    calls += 1;
    res.setHeader("Content-Type", "application/json");
    if (calls === 1) {
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "function-call-1",
                    type: "function",
                    function: { name: "no_such_tool", arguments: "{}" },
                    extra_content: { google: { thought_signature: "sig-abc" } },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        })
      );
      return;
    }
    const body: unknown = JSON.parse(raw);
    const messages =
      typeof body === "object" && body && "messages" in body ? body.messages : [];
    const assistant = Array.isArray(messages)
      ? messages.find((m) => typeof m === "object" && m && m.role === "assistant")
      : null;
    echoed = assistant ?? null;
    res.end(
      JSON.stringify({
        choices: [
          {
            message: { role: "assistant", content: "Halo Kak, ada yang bisa dibantu?" },
            finish_reason: "stop",
          },
        ],
      })
    );
  });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const addr = server.address();
if (!addr || typeof addr === "string") throw new Error("mock server did not bind");

// The runtime reads these at module load, so set them before the import.
process.env.LLM_BASE_URL = `http://127.0.0.1:${addr.port}`;
process.env.LLM_API_KEY = "test-key";
process.env.LLM_CHAT_MODEL = "test-model";
process.env.DATABASE_URL = "postgresql://user:pass@127.0.0.1:5432/none";

const { runConversation } = await import("@csq/core/services/llm-runtime");
const result = await runConversation({
  tenantId: "tenant",
  agentId: "agent",
  conversationId: "conversation",
  history: [],
  userMessage: "halo",
});

assert.strictEqual(calls, 2);
assert.strictEqual(result.reply, "Halo Kak, ada yang bisa dibantu?");
assert.strictEqual(result.toolCalls.length, 1);
assert.strictEqual(result.toolCalls[0].tool, "no_such_tool");
if (!echoed) throw new Error("assistant message was not echoed back");
assert.strictEqual(echoed.content, null);
assert.deepStrictEqual(echoed.tool_calls?.[0]?.extra_content, {
  google: { thought_signature: "sig-abc" },
});

server.close();
console.log("llm loop self-check passed");
