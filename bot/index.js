import "dotenv/config";
import fs from "node:fs";
import http from "node:http";
import { config } from "./config.js";
import { ask, loadSystemPrompt } from "./gemini.js";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidGroup,
  isJidBroadcast,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import pino from "pino";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ownerNumbers = new Set(config.ownerNumbers.filter(Boolean));
const blockedNumbers = new Set(config.blockedNumbers.filter(Boolean));

const systemPrompt = loadSystemPrompt();
const history = new Map();
const cooldown = new Map();
let userDaily = new Map();
let botDaily = { day: dayKey(), count: 0 };

const pausedState = loadPaused();
loadCounters();

function loadCounters() {
  try {
    const c = JSON.parse(fs.readFileSync(config.countersFile, "utf8"));
    if (c.bot && c.bot.day === dayKey()) botDaily = c.bot;
    if (c.users && typeof c.users === "object") {
      userDaily = new Map(
        Object.entries(c.users).filter(([, v]) => v && v.day === dayKey())
      );
    }
  } catch {
    /* first run */
  }
}

function saveCounters() {
  try {
    fs.writeFileSync(
      config.countersFile,
      JSON.stringify({ bot: botDaily, users: Object.fromEntries(userDaily) })
    );
  } catch {
    /* ignore */
  }
}

const flood = new Map();
const silenced = new Map();

function checkFlood(sender) {
  const now = Date.now();
  const until = silenced.get(sender);
  if (until) {
    if (now < until) return true;
    silenced.delete(sender);
  }
  const hits = (flood.get(sender) || []).filter((t) => now - t < config.floodWindowMs);
  hits.push(now);
  flood.set(sender, hits);
  if (hits.length > config.floodMessages) {
    silenced.set(sender, now + config.floodSilenceMinutes * 60000);
    console.log(`Silenced ${sender} for flooding`);
    return true;
  }
  return false;
}

function loadOrders() {
  try {
    return JSON.parse(fs.readFileSync(config.ordersFile, "utf8"));
  } catch {
    return [];
  }
}

function saveOrder(jid, fields) {
  const orders = loadOrders();
  orders.push({ at: new Date().toISOString(), chat: jid, ...fields });
  fs.writeFileSync(config.ordersFile, JSON.stringify(orders, null, 2));
  return orders.length;
}

function extractOrder(text) {
  const match = text.match(/<<<ORDER>>>\s*([\s\S]*?)\s*<<<END>>>/);
  if (!match) return { text, order: null };

  const order = {};
  for (const line of match[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > -1) {
      const key = line.slice(0, i).trim().toLowerCase();
      const val = line.slice(i + 1).trim();
      if (key && val && val !== "...") order[key] = val;
    }
  }

  const clean = text.replace(match[0], "").trim();
  return { text: clean, order: Object.keys(order).length ? order : null };
}

async function notifyOwner(sock, text) {
  for (const num of ownerNumbers) {
    try {
      await sock.sendMessage(`${num}@s.whatsapp.net`, { text });
    } catch (e) {
      console.error("Owner notify failed:", e.message);
    }
  }
}

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadPaused() {
  try {
    return JSON.parse(fs.readFileSync(config.pausedFile, "utf8"));
  } catch {
    return { all: false, chats: [] };
  }
}

function savePaused() {
  fs.writeFileSync(config.pausedFile, JSON.stringify(pausedState, null, 2));
}

function isPaused(jid) {
  return pausedState.all || pausedState.chats.includes(jid);
}

function bumpDaily(map, key) {
  const day = dayKey();
  const entry = map.get(key);
  if (!entry || entry.day !== day) {
    map.set(key, { day, count: 1 });
    saveCounters();
    return 1;
  }
  entry.count += 1;
  saveCounters();
  return entry.count;
}

function getDaily(map, key) {
  const entry = map.get(key);
  return entry && entry.day === dayKey() ? entry.count : 0;
}

function getHistory(jid) {
  const now = Date.now();
  const entry = history.get(jid);
  if (!entry || now - entry.last > config.historyTtlMinutes * 60000) {
    history.delete(jid);
    return [];
  }
  entry.last = now;
  return entry.msgs;
}

function pushHistory(jid, role, text) {
  let entry = history.get(jid);
  if (!entry) {
    entry = { msgs: [], last: Date.now() };
    history.set(jid, entry);
    if (history.size > config.historyMaxChats) {
      const oldest = history.keys().next().value;
      history.delete(oldest);
    }
  }
  entry.msgs.push({ role, parts: [{ text }] });
  entry.last = Date.now();
  while (entry.msgs.length > config.historyTurns * 2) entry.msgs.shift();
}

function pruneHistory() {
  const cutoff = Date.now() - config.historyTtlMinutes * 60000;
  for (const [jid, entry] of history) {
    if (entry.last < cutoff) history.delete(jid);
  }
}

function unwrap(msg) {
  if (!msg) return null;
  if (msg.ephemeralMessage) return unwrap(msg.ephemeralMessage.message);
  if (msg.viewOnceMessage) return unwrap(msg.viewOnceMessage.message);
  if (msg.viewOnceMessageV2) return unwrap(msg.viewOnceMessageV2.message);
  if (msg.viewOnceMessageV2Extension) return unwrap(msg.viewOnceMessageV2Extension.message);
  if (msg.documentWithCaptionMessage) return unwrap(msg.documentWithCaptionMessage.message);
  if (msg.editedMessage) return unwrap(msg.editedMessage.message);
  return msg;
}

function textOf(msg) {
  const m = unwrap(msg);
  if (!m) return "";
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    ""
  ).trim();
}

function handleCommand(text, jid, sock) {
  const [cmd, ...rest] = text.slice(1).toLowerCase().split(/\s+/);
  const scope = rest[0];

  if (cmd === "pause") {
    if (scope === "all") pausedState.all = true;
    else if (!pausedState.chats.includes(jid)) pausedState.chats.push(jid);
    savePaused();
    return `Bot paused${scope === "all" ? " everywhere" : " for this chat"}. Send !resume to hand back.`;
  }

  if (cmd === "resume") {
    if (scope === "all") pausedState.all = false;
    else pausedState.chats = pausedState.chats.filter((c) => c !== jid);
    savePaused();
    return `Bot resumed${scope === "all" ? " everywhere" : " for this chat"}.`;
  }

  if (cmd === "status") {
    return [
      `Status: ${pausedState.all ? "PAUSED (all)" : "running"}`,
      `Paused chats: ${pausedState.chats.length}`,
      `Bot messages today: ${botDaily.count}/${config.maxBotMessagesPerDay}`,
      `Silenced senders: ${silenced.size}`,
      `Chats in memory: ${history.size}`,
    ].join("\n");
  }

  if (cmd === "orders") {
    const orders = loadOrders();
    if (!orders.length) return "No orders collected yet.";
    const recent = orders.slice(-5).reverse();
    return [
      `Last ${recent.length} of ${orders.length} order(s):`,
      "",
      ...recent.map((o, i) =>
        [
          `#${orders.length - i} [${o.at}]`,
          `  name: ${o.name || "-"}`,
          `  business: ${o.business || "-"} (${o.industry || "-"})`,
          `  requirements: ${o.requirements || "-"}`,
          `  assets: ${o.assets || "-"}`,
          `  budget: ${o.budget || "-"}`,
          `  chat: ${o.chat}`,
          "",
        ].join("\n")
      ),
    ].join("\n");
  }

  return null;
}

async function reply(sock, jid, text) {
  const delay =
    config.minReplyDelayMs + Math.random() * (config.maxReplyDelayMs - config.minReplyDelayMs);
  await sock.sendPresenceUpdate("composing", jid);
  await sleep(delay);
  await sock.sendMessage(jid, { text });
  await sock.sendPresenceUpdate("paused", jid);
}

async function handleMessage(sock, m) {
  if (!m.message || m.key.fromMe) return;

  const jid = m.key.remoteJid;
  if (!jid) return;
  if (isJidBroadcast(jid)) return;
  if (jid === "status@broadcast" && !config.respondToStatus) return;

  const isGroup = isJidGroup(jid);
  if (isGroup && !config.respondToGroups) return;

  const text = textOf(m.message);
  if (!text) return;

  const sender = (m.key.participant || jid).split(":")[0];
  const senderNum = sender.split("@")[0];
  const bareJid = jid.split(":")[0];

  if (blockedNumbers.has(senderNum)) return;

  const isOwner = ownerNumbers.has(senderNum);

  // Skip messages that queued up while the process was offline.
  const age = Date.now() / 1000 - Number(m.messageTimestamp || 0);
  if (!isOwner && age > config.maxMessageAgeSeconds) return;

  if (text.startsWith("!")) {
    if (!isOwner) return;
    const response = handleCommand(text, bareJid, sock);
    if (response) await sock.sendMessage(jid, { text: response });
    return;
  }

  if (isOwner || isPaused(bareJid)) return;
  if (checkFlood(senderNum)) return;

  const now = Date.now();
  const last = cooldown.get(bareJid) || 0;
  if (now - last < config.secondsBetweenReplies * 1000) return;

  if (botDaily.day !== dayKey()) {
    botDaily = { day: dayKey(), count: 0 };
    saveCounters();
  }
  if (botDaily.count >= config.maxBotMessagesPerDay) return;
  if (getDaily(userDaily, senderNum) >= config.maxMessagesPerUserPerDay) return;

  cooldown.set(bareJid, now);

  const hist = getHistory(bareJid);
  pushHistory(bareJid, "user", text.slice(0, 4000));

  try {
    const replyText = await ask(
      [...hist, { role: "user", parts: [{ text: text.slice(0, 4000) }] }],
      systemPrompt
    );

    const { text: cleanReply, order } = extractOrder(replyText);
    let outgoing = cleanReply || "Got it. A team member will confirm shortly.";

    if (order) {
      saveOrder(bareJid, order);
      outgoing = [cleanReply, "", "Noted. A team member will confirm the details and quote shortly."]
        .filter(Boolean)
        .join("\n")
        .trim();
      pushHistory(bareJid, "model", outgoing);
      await notifyOwner(
        sock,
        [
          "NEW ORDER ENQUIRY",
          `from: ${senderNum}`,
          `name: ${order.name || "-"}`,
          `business: ${order.business || "-"} (${order.industry || "-"})`,
          `requirements: ${order.requirements || "-"}`,
          `assets: ${order.assets || "-"}`,
          `budget: ${order.budget || "-"}`,
          "",
          "Reply in that chat to take over, or send !resume",
        ].join("\n")
      );
    } else {
      pushHistory(bareJid, "model", replyText);
    }

    bumpDaily(userDaily, senderNum);
    botDaily.count += 1;
    saveCounters();
    cooldown.set(bareJid, Date.now());
    await reply(sock, jid, outgoing);
  } catch (err) {
    console.error("Reply failed:", err.message);
    cooldown.delete(bareJid);
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(config.authFolder);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["Business Bot", "Chrome", "1.0.0"],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    shouldIgnoreJid: (jid) => isJidBroadcast(jid),
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\nScan this QR with WhatsApp (Linked Devices):\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("Connected. Bot is live.");
      return;
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;

      if (loggedOut) {
        console.error("Logged out. Delete the auth folder and scan the QR again.");
        process.exit(1);
      }

      const wait = code === DisconnectReason.restartRequired ? 500 : 4000;
      console.log(`Connection closed (${code ?? "?"}). Reconnecting in ${wait / 1000}s...`);
      await sleep(wait);
      startBot().catch((e) => {
        console.error("Reconnect failed:", e);
        process.exit(1);
      });
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      await handleMessage(sock, m).catch((e) => console.error("Handler error:", e.message));
    }
  });

  return sock;
}

const healthPort = process.env.PORT ? Number(process.env.PORT) : 0;
if (healthPort) {
  http
    .createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
    })
    .listen(healthPort, () => console.log(`Health check on :${healthPort}`));
}

setInterval(pruneHistory, 5 * 60 * 1000).unref();

process.on("uncaughtException", (e) => console.error("Uncaught:", e?.message || e));
process.on("unhandledRejection", (e) => console.error("Unhandled:", e?.message || e));

startBot().catch((e) => {
  console.error("Failed to start:", e);
  process.exit(1);
});
