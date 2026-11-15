import assert from "assert";
import { chatCompletionResponseSchema } from "@csq/core/types/chat";

// LLM response-shape self-check (bug fix 4.6.2). Gemini's OpenAI-compatible
// layer omits `content` on tool-call messages and carries the Gemini 3 thought
// signature on the first tool call. Both must survive the parse, and the
// signature must survive the echo back, or every tool-using turn fails.
//   npm run check:llm

const toolCall = chatCompletionResponseSchema.parse({
  choices: [
    {
      message: {
        role: "assistant",
        tool_calls: [
          {
            id: "function-call-1",
            type: "function",
            function: {
              name: "knowledge_search",
              arguments: "{\"query\":\"kebijakan refund\"}",
            },
            extra_content: {
              google: { thought_signature: "sig-abc" },
            },
          },
        ],
      },
      finish_reason: "tool_calls",
    },
  ],
});
const first = toolCall.choices[0].message.tool_calls?.[0];
if (!first) throw new Error("tool call dropped");
assert.strictEqual(toolCall.choices[0].message.content, undefined);

// The runtime echoes the assistant message back; the signature has to be in
// that JSON or Gemini 3 answers 400 on the follow-up request.
const echoed = JSON.stringify({
  role: "assistant",
  content: toolCall.choices[0].message.content ?? null,
  tool_calls: toolCall.choices[0].message.tool_calls,
});
assert.ok(echoed.includes("\"thought_signature\":\"sig-abc\""));

// Plain text replies and explicit null content still parse.
const text = chatCompletionResponseSchema.parse({
  choices: [
    { message: { role: "assistant", content: "Halo Kak!" }, finish_reason: "stop" },
  ],
});
assert.strictEqual(text.choices[0].message.content, "Halo Kak!");

const nullContent = chatCompletionResponseSchema.parse({
  choices: [
    { message: { role: "assistant", content: null }, finish_reason: "stop" },
  ],
});
assert.strictEqual(nullContent.choices[0].message.content, null);

console.log("llm response-shape self-check passed");
