export const config = {
  // --- WHO GETS THE BOT -------------------------------------------------
  // Full international format, no + or spaces. Commands: !pause !resume !status !orders
  ownerNumbers: ["923136900507"],

  // Numbers that never get a bot reply (staff, family, yourself).
  blockedNumbers: [],

  // --- SAFETY LIMITS ----------------------------------------------------
  // Tightened for use on a primary number: reply slower, cap daily volume.
  respondToGroups: false,
  respondToStatus: false,
  secondsBetweenReplies: 6,
  maxMessagesPerUserPerDay: 40,
  maxBotMessagesPerDay: 300,
  minReplyDelayMs: 1200,
  maxReplyDelayMs: 3500,

  // Flood protection: silences a sender who exceeds this
  floodMessages: 20,
  floodWindowMs: 5 * 60 * 1000,
  floodSilenceMinutes: 30,

  // Ignore messages older than this (they queued while the process was offline)
  maxMessageAgeSeconds: 3600,

  // --- MEMORY -----------------------------------------------------------
  historyTurns: 16,
  historyTtlMinutes: 45,
  historyMaxChats: 300,

  // --- PERSONALITY ------------------------------------------------------
  systemPromptFile: "business.md",
  temperature: 0.7,
  maxOutputTokens: 900,

  // Free tier allows 15 Gemini requests/minute on the lite model.
  // 4500ms keeps us at ~13/min, safely under the limit.
  minGeminiIntervalMs: 4500,

  // --- RUNTIME ----------------------------------------------------------
  authFolder: "./auth",
  pausedFile: "./.paused.json",
  ordersFile: "./orders.json",
  countersFile: "./.counters.json",
};
