import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

const SYSTEM_PROMPT = (() => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "business.md"), "utf8");
    const marker = raw.lastIndexOf("\n---\n");
    return (marker > -1 ? raw.slice(marker + 5) : raw).trim();
  } catch {
    return "You are a helpful assistant.";
  }
})();

// --- conversation memory (short, per session) ------------------------------

const HISTORY_TTL_MS = 45 * 60 * 1000;
const HISTORY_MAX_TURNS = 16;
const history = new Map();

function getHistory(sessionId) {
  const entry = history.get(sessionId);
  if (!entry || Date.now() - entry.last > HISTORY_TTL_MS) {
    history.delete(sessionId);
    return [];
  }
  entry.last = Date.now();
  return entry.msgs;
}

function pushHistory(sessionId, role, text) {
  let entry = history.get(sessionId);
  if (!entry) {
    entry = { msgs: [], last: Date.now() };
    history.set(sessionId, entry);
  }
  entry.msgs.push({ role, parts: [{ text }] });
  entry.last = Date.now();
  while (entry.msgs.length > HISTORY_MAX_TURNS * 2) entry.msgs.shift();
}

// --- Gemini ----------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ask(contents) {
  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 900 },
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45000),
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      const text = data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || "")
        .join("")
        .trim();
      if (!text) throw new Error("Gemini returned an empty reply");
      return text;
    }

    const message = data?.error?.message || res.statusText;
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    throw new Error(`Gemini ${res.status}: ${message}`);
  }
  throw new Error("Gemini request failed");
}

// --- server ----------------------------------------------------------------

const app = express();
app.use(express.json({ limit: "16kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/chat", async (req, res) => {
  const message = String(req.body?.message || "").trim().slice(0, 4000);
  const sessionId = String(req.body?.sessionId || "");
  if (!message) return res.status(400).json({ error: "Empty message" });

  const msgs = getHistory(sessionId);

  try {
    const reply = await ask([...msgs, { role: "user", parts: [{ text: message }] }]);
    if (sessionId) {
      pushHistory(sessionId, "user", message);
      pushHistory(sessionId, "model", reply);
    }
    return res.json({ reply });
  } catch (err) {
    console.error("Reply failed:", err.message);
    return res.status(502).json({ error: "The assistant is unavailable right now. Please try again." });
  }
});

app.listen(PORT, () => {
  console.log(`Chat server listening on http://localhost:${PORT}`);
  if (!API_KEY) console.warn("GEMINI_API_KEY is not set — /api/chat will fail.");
});
