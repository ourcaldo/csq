// Reproduce the EXACT live runConversation request to find the 400 cause.
// Run: OPENCLAW_BASE_URL=https://openclaw-6hcs.onrender.com OPENCLAW_API_KEY='E4M1/...' npx tsx scripts/test-openclaw.ts
import prisma from "../src/lib/db";
import { listTools } from "../src/tools";
import { zodToJsonSchema } from "../src/lib/zod-to-json";
import { buildSystemPrompt, toChatHistory } from "../src/lib/prompt-builder";

const BASE_URL = process.env.OPENCLAW_BASE_URL ?? "https://openclaw-6hcs.onrender.com";
const TOKEN = process.env.OPENCLAW_API_KEY ?? "E4M1/Wmu9OZClEiykgrvcRa3ap35kTO4yI5+rAmw3JI=";
const CONV_ID = "62456a0f-b15e-46ad-a282-692657d01f65";

const allTools = listTools().map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: zodToJsonSchema(t.parameters),
  },
}));

async function send(messages: unknown[], tools: unknown) {
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ model: "openclaw/default", user: CONV_ID, messages, tools, tool_choice: "auto", stream: false }),
  });
  const text = await res.text();
  console.log("status", res.status, text.slice(0, 250));
}

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: { contains: "toko-kopi" } } });
  const agent = await prisma.agent.findFirst({ where: { tenantId: tenant!.id } });
  if (!tenant || !agent) throw new Error("demo tenant/agent not found");
  const systemPrompt = await buildSystemPrompt({ tenant, agent });
  console.log("system prompt length:", systemPrompt.length);

  const msgs = await prisma.message.findMany({ where: { conversationId: CONV_ID }, orderBy: { createdAt: "asc" }, take: 30 });
  const history = toChatHistory(msgs.map((m) => ({ direction: m.direction, senderType: m.senderType, body: m.body })));
  console.log("history msgs:", history.length, JSON.stringify(history));

  const fullMessages = [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: "whyy" }];

  console.log("\n=== real system prompt + history + ALL tools ===");
  await send(fullMessages, allTools);

  console.log("\n=== real system prompt + history + NO tools ===");
  await send(fullMessages, undefined);

  console.log("\n=== real system prompt + NO history + ALL tools ===");
  await send([{ role: "system", content: systemPrompt }, { role: "user", content: "whyy" }], allTools);

  await prisma.$disconnect();
}

main().catch((e) => console.error(e));
