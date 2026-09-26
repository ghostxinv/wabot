import fs from "node:fs";
import { config } from "./config.js";

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export function loadSystemPrompt() {
  try {
    const raw = fs.readFileSync(config.systemPromptFile, "utf8");
    const marker = raw.lastIndexOf("\n---\n");
    const body = marker > -1 ? raw.slice(marker + 5) : raw;
    return body.trim();
  } catch {
    return "You are a helpful assistant.";
  }
}

export async function ask(history, systemPrompt, retries = 3) {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not set. Create a .env file.");

  const generationConfig = {
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
  };
  if (/gemini-(3|2\.5)/.test(MODEL)) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: history,
    generationConfig,
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ],
  };

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${URL}?key=${API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45000),
      });

      if (res.status === 503 && attempt < retries - 1) {
        await sleep(3000);
        continue;
      }

      const data = await res.json();

      if (!res.ok) {
        const msg = data?.error?.message || res.statusText;
        if (attempt < retries - 1 && res.status >= 500) {
          await sleep(2000);
          continue;
        }
        throw new Error(`Gemini ${res.status}: ${msg}`);
      }

      const blocked = data?.promptFeedback?.blockReason;
      if (blocked) throw new Error(`Prompt blocked: ${blocked}`);

      const parts = data?.candidates?.[0]?.content?.parts;
      const text = parts?.map((p) => p.text || "").join("").trim();
      if (!text) throw new Error("Gemini returned an empty reply");
      return text;
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await sleep(2000);
    }
  }
  throw new Error("Gemini request failed");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
