import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { documentAiLabel, documentAiProvider } from "@/lib/document-reader";

// AI assistance beyond document reading (appeal letters, plan of care suggestions...). It uses the same provider and
// the same practice switch as document reading: Settings → Practice → "Use AI assistance". Everything it writes is a
// draft for a person to review; nothing is saved or sent until they accept it.

export class AiUnavailable extends Error {}

// The provider that will answer for this practice, or why AI assistance can't be used.
export async function aiProviderFor(practiceId: string) {
  const settings = await prisma.practiceSettings.findUnique({ where: { practiceId }, select: { documentAiEnabled: true } });
  if (!settings?.documentAiEnabled) throw new AiUnavailable("AI assistance is switched off. Turn it on in Settings → Practice.");
  const provider = documentAiProvider();
  if (!provider) throw new AiUnavailable("No AI key is configured on this server (OPENAI_API_KEY or ANTHROPIC_API_KEY).");
  return provider;
}

async function openAiText(system: string, prompt: string, maxTokens: number) {
  const res = await fetch(`${(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "")}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_DOCUMENT_MODEL || "gpt-6-luna",
      store: false,
      instructions: system,
      input: prompt,
      max_output_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string };
    output?: { type: string; content?: { type: string; text?: string }[] }[];
  } | null;
  if (!res.ok) throw new Error(body?.error?.message || `OpenAI returned ${res.status}`);
  const parts = (body?.output ?? []).flatMap((o) => (o.type === "message" ? (o.content ?? []) : []));
  if (parts.some((p) => p.type === "refusal")) throw new Error("The AI declined this request.");
  return parts
    .filter((p) => p.type === "output_text")
    .map((p) => p.text ?? "")
    .join("\n");
}

async function claudeText(system: string, prompt: string, maxTokens: number) {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: process.env.CAREHUB_TEXT_MODEL || process.env.CAREHUB_DOCUMENT_MODEL || "claude-opus-5-5",
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") throw new Error("The AI declined this request.");
  return response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

// One drafted answer in plain text. Throws AiUnavailable when AI assistance is off or has no key.
export async function aiDraft(input: { practiceId: string; system: string; prompt: string; maxTokens?: number }) {
  const provider = await aiProviderFor(input.practiceId);
  const maxTokens = input.maxTokens ?? 4000;
  const text = provider === "OPENAI" ? await openAiText(input.system, input.prompt, maxTokens) : await claudeText(input.system, input.prompt, maxTokens);
  const clean = text.trim();
  if (!clean) throw new Error("The AI returned an empty answer. Try again.");
  return { text: clean, provider: documentAiLabel[provider] };
}
