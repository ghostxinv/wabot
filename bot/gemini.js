import fs from "node:fs";
import { config } from "./config.js";

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
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

// Free tier allows ~20 requests/minute. Space our own calls out so we never
// burst into that, and so several customers messaging at once don't collide.
let nextAllowedAt = 0;
async function ensureGap() {
  const now = Date.now();
  const wait = Math.max(0, nextAllowedAt - now);
  nextAllowedAt = Math.max(now, nextAllowedAt) + config.minGeminiIntervalMs;
  if (wait > 0) await sleep(wait);
}

function backoffMs(res, message, attempt) {
  const header = Number(res.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000 + 500, 90000);
  const m = message.match(/retry in ([\d.]+)\s*s/i);
  if (m) return Math.min(Number(m[1]) * 1000 + 1500, 90000);
  return Math.min(10000 * (attempt + 1), 90000);
}

export async function ask(history, systemPrompt, retries = 5) {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not set. Create a .env file.");

  const generationConfig = {
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
  };
  // Lite models reject the thinkingConfig field outright.
  if (/gemini-(3|2\.5)/.test(MODEL) && !/lite/i.test(MODEL)) {
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
      await ensureGap();
      const res = await fetch(`${URL}?key=${API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45000),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = data?.error?.message || res.statusText;

        // Self-heal: some models reject thinkingConfig, drop it and retry.
        if (res.status === 400 && /thinkingConfig/i.test(msg) && generationConfig.thinkingConfig) {
          delete generationConfig.thinkingConfig;
          attempt -= 1;
          continue;
        }

        const retriable = res.status === 429 || res.status === 503 || res.status >= 500;

        if (retriable && attempt < retries - 1) {
          const wait = backoffMs(res, msg, attempt);
          console.warn(
            `Gemini ${res.status} (attempt ${attempt + 1}/${retries}), waiting ${Math.round(wait / 1000)}s`
          );
          await sleep(wait);
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
      if (attempt === retries - 1 || !/Gemini (429|5\d\d)/.test(err.message)) throw err;
      await sleep(3000);
    }
  }
  throw new Error("Gemini request failed");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
