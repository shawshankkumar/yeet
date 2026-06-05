#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────
// granola-mcp.mjs — tiny MCP client for the Granola MCP server
//
// yeet's bash orchestrates fzf + publishing; this helper is the
// only Granola integration point. It speaks JSON-RPC-over-
// Streamable-HTTP to https://mcp.granola.ai/mcp and handles the
// OAuth 2.0 (Dynamic Client Registration) browser handshake,
// caching the token under ~/.config/yeet so later runs are silent.
//
// Commands:
//   node granola-mcp.mjs list [--limit N]   → JSON array [{id,title,date}]
//   node granola-mcp.mjs transcript <id>    → markdown on stdout
//   node granola-mcp.mjs account            → connected email/workspace
//   node granola-mcp.mjs introspect         → tool names + schemas (debug)
//   node granola-mcp.mjs logout             → forget cached token/client
//
// Exit codes:  0 ok · 1 generic error · 2 auth failed · 3 paid-plan required
// ──────────────────────────────────────────────────────────────

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SERVER_URL = process.env.YEET_MCP_URL || "https://mcp.granola.ai/mcp";
const OAUTH_PORT = parseInt(process.env.YEET_OAUTH_PORT || "33418", 10);
const CONFIG_DIR =
  process.env.YEET_CONFIG_DIR || path.join(os.homedir(), ".config", "yeet");
const CALLBACK_PATH = "/callback";
const REDIRECT_URI = `http://127.0.0.1:${OAUTH_PORT}${CALLBACK_PATH}`;

// Tool-name candidates, in preference order. The live server is the
// source of truth — we pick the first candidate it actually exposes.
const TOOL_CANDIDATES = {
  list: ["list_meetings", "list_recent_meetings", "meetings_list"],
  transcript: ["get_meeting_transcript", "get_transcript", "meeting_transcript"],
  notes: ["get_meetings", "get_meeting", "get_meeting_notes"],
  account: ["get_account_info", "account_info", "whoami"],
};

// ── tiny logger (stderr so stdout stays machine-parseable) ──
const isTTY = process.stderr.isTTY;
const c = (code, s) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const elog = (...a) => process.stderr.write(a.join(" ") + "\n");
const info = (m) => elog(c(36, "▸"), m);
const ok = (m) => elog(c(32, "✓"), m);
const warn = (m) => elog(c(33, "⚠"), m);

function die(msg, code = 1) {
  elog(c(31, "✗"), msg);
  process.exit(code);
}

// ── file-backed token / client store ──
fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
const f = (name) => path.join(CONFIG_DIR, name);
function readJSON(name) {
  try {
    return JSON.parse(fs.readFileSync(f(name), "utf8"));
  } catch {
    return undefined;
  }
}
function writeJSON(name, data) {
  fs.writeFileSync(f(name), JSON.stringify(data, null, 2), { mode: 0o600 });
}
function rm(name) {
  try {
    fs.unlinkSync(f(name));
  } catch {}
}

// ── OAuth client provider: persists everything to CONFIG_DIR ──
class FileOAuthProvider {
  constructor() {
    this._state = undefined;
  }
  get redirectUrl() {
    return REDIRECT_URI;
  }
  get clientMetadata() {
    return {
      client_name: "yeet",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  state() {
    if (!this._state) this._state = randomBytes(16).toString("hex");
    return this._state;
  }
  clientInformation() {
    return readJSON("client.json");
  }
  saveClientInformation(info) {
    writeJSON("client.json", info);
  }
  tokens() {
    return readJSON("tokens.json");
  }
  saveTokens(tokens) {
    writeJSON("tokens.json", tokens);
  }
  saveCodeVerifier(v) {
    writeJSON("verifier.json", { v });
  }
  codeVerifier() {
    const d = readJSON("verifier.json");
    if (!d) throw new Error("missing PKCE code verifier");
    return d.v;
  }
  invalidateCredentials(scope) {
    if (scope === "all" || scope === "client") rm("client.json");
    if (scope === "all" || scope === "tokens") rm("tokens.json");
    if (scope === "all" || scope === "verifier") rm("verifier.json");
    if (scope === "all" || scope === "discovery") rm("discovery.json");
  }
  saveDiscoveryState(s) {
    writeJSON("discovery.json", s);
  }
  discoveryState() {
    return readJSON("discovery.json");
  }
  // Called by the SDK to send the user to the browser. We open it and
  // also print the URL so headless/edge cases can copy-paste it.
  redirectToAuthorization(authorizationUrl) {
    const url = authorizationUrl.toString();
    info("Opening your browser to sign in to Granola…");
    elog("  " + c(2, "If it doesn't open, visit:"));
    elog("  " + c(36, url));
    openBrowser(url);
  }
}

function openBrowser(url) {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* user can still copy-paste the printed URL */
  }
}

// ── loopback server that catches the OAuth redirect ──
function startCallbackServer(expectedState) {
  let resolve, reject;
  const code = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const server = http.createServer((req, res) => {
    if (!req.url.startsWith(CALLBACK_PATH)) {
      res.writeHead(404).end();
      return;
    }
    const u = new URL(req.url, REDIRECT_URI);
    const err = u.searchParams.get("error");
    const got = u.searchParams.get("code");
    const state = u.searchParams.get("state");
    const html = (title, body) =>
      `<!doctype html><meta charset=utf8><title>${title}</title>` +
      `<body style="font-family:system-ui;text-align:center;padding:4rem">` +
      `<h2>${title}</h2><p>${body}</p></body>`;
    if (err) {
      res.writeHead(400, { "content-type": "text/html" });
      res.end(html("Sign-in failed", err));
      reject(new Error(`authorization error: ${err}`));
    } else if (expectedState && state !== expectedState) {
      res.writeHead(400, { "content-type": "text/html" });
      res.end(html("Sign-in failed", "state mismatch"));
      reject(new Error("OAuth state mismatch — possible CSRF, aborting"));
    } else if (got) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html("yeet ✓", "Signed in to Granola. You can close this tab."));
      resolve(got);
    } else {
      res.writeHead(400).end();
      reject(new Error("no authorization code in callback"));
    }
  });
  return new Promise((res, rej) => {
    server.once("error", (e) =>
      rej(
        e.code === "EADDRINUSE"
          ? new Error(
              `port ${OAUTH_PORT} is busy. Close whatever is using it, ` +
                `or set YEET_OAUTH_PORT to a free port.`,
            )
          : e,
      ),
    );
    server.listen(OAUTH_PORT, "127.0.0.1", () =>
      res({ server, code }),
    );
  });
}

// ── connect (handling the OAuth dance) ──
async function connect() {
  const provider = new FileOAuthProvider();
  const client = new Client(
    { name: "yeet", version: "2.0.0" },
    { capabilities: {} },
  );
  const newTransport = () =>
    new StreamableHTTPClientTransport(new URL(SERVER_URL), {
      authProvider: provider,
    });

  try {
    const transport = newTransport();
    await client.connect(transport);
    return { client, transport };
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) throw e;
  }

  // Interactive auth required: stand up the loopback catcher, wait for
  // the code the browser redirect delivers, finish the token exchange.
  // finishAuth needs a transport, and connect() needs a *fresh* one
  // (a transport can only be start()ed once).
  const { server, code } = await startCallbackServer(provider.state());
  try {
    const authCode = await Promise.race([
      code,
      new Promise((_, rej) =>
        setTimeout(
          () => rej(new Error("timed out waiting for browser sign-in (5 min)")),
          5 * 60 * 1000,
        ),
      ),
    ]);
    await newTransport().finishAuth(authCode);
    const transport = newTransport();
    await client.connect(transport);
    ok("Authenticated with Granola");
    return { client, transport };
  } finally {
    server.close();
  }
}

// ── resolve which of our candidate tool names the server exposes ──
async function resolveTools(client) {
  const { tools } = await client.listTools();
  const byName = new Map(tools.map((t) => [t.name, t]));
  const pick = (cands) => cands.find((n) => byName.has(n));
  return {
    available: [...byName.keys()],
    byName,
    list: pick(TOOL_CANDIDATES.list),
    transcript: pick(TOOL_CANDIDATES.transcript),
    notes: pick(TOOL_CANDIDATES.notes),
    account: pick(TOOL_CANDIDATES.account),
  };
}

// Build a call payload that respects the tool's schema: when the tool
// forbids extra properties, only send keys it actually declares.
function buildArgs(tool, desired) {
  const schema = tool?.inputSchema;
  if (!schema || schema.additionalProperties !== false) return desired;
  const allowed = Object.keys(schema.properties || {});
  const out = {};
  for (const k of allowed) if (k in desired) out[k] = desired[k];
  return out;
}

// flatten an MCP tool result's content blocks; prefer structuredContent
function resultPayload(res) {
  if (res?.structuredContent !== undefined) return res.structuredContent;
  const text = (res?.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isPaidPlanError(res, errText) {
  const hay = (
    (errText || "") +
    " " +
    JSON.stringify(res?.content || res || "")
  ).toLowerCase();
  return /paid|upgrade|subscription|not (allowed|permitted)|permission|forbidden|plan|premium|pro plan|business/.test(
    hay,
  );
}

// ── meeting normalization ────────────────────────────────────
// yeet's picker needs {id, title, date}. The Granola MCP server returns
// an XML-ish <meetings_data><meeting id title date>…</meeting> blob; we
// also keep a JSON path in case the shape ever changes / differs.
const pad = (n) => String(n).padStart(2, "0");
function formatDate(s) {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s).slice(0, 16);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}
function pickDate(m) {
  const cal = m.google_calendar_event || m.calendar_event || {};
  const start = (cal.start || {}).dateTime || (cal.start || {}).date;
  return (
    start ||
    m.start_time ||
    m.startTime ||
    m.scheduled_at ||
    m.date ||
    m.created_at ||
    m.createdAt ||
    m.updated_at ||
    ""
  );
}
function parseMeetingsXML(text) {
  const re =
    /<meeting\s+id="([^"]*)"\s+title="([^"]*)"\s+date="([^"]*)"/g;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ id: m[1], title: decodeXML(m[2]), date: formatDate(m[3]) });
  }
  return out;
}
function decodeXML(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
function normalizeMeetings(payload) {
  if (typeof payload === "string") {
    if (payload.includes("<meeting")) return parseMeetingsXML(payload);
    try {
      payload = JSON.parse(payload);
    } catch {
      return [];
    }
  }
  let items = payload;
  if (!Array.isArray(items) && items && typeof items === "object") {
    items =
      items.meetings ||
      items.data ||
      items.results ||
      items.items ||
      items.documents ||
      [];
  }
  if (!Array.isArray(items)) return [];
  return items
    .map((m) => ({
      id: m.id || m.meeting_id || m.document_id || m.uuid || "",
      title: m.title || m.name || m.subject || "Untitled",
      date: formatDate(pickDate(m)),
    }))
    .filter((m) => m.id);
}

// notes/summary fallback (free plan): turn one get_meetings result into
// readable markdown. Raw transcript stays paid-only.
function notesToMarkdown(payload) {
  if (typeof payload !== "string") return JSON.stringify(payload, null, 2);
  const grab = (tag) => {
    const m = payload.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
    return m ? decodeXML(m[1]).trim() : "";
  };
  const attr = (name) => {
    const m = payload.match(new RegExp(`${name}="([^"]*)"`));
    return m ? decodeXML(m[1]) : "";
  };
  const title = attr("title") || "Meeting notes";
  const date = attr("date");
  const participants = grab("known_participants");
  const summary = grab("summary") || grab("ai_summary") || grab("overview");
  const notes = grab("private_notes") || grab("notes");
  const parts = [`# ${title}`];
  if (date) parts.push(`_${date}_`);
  if (participants) parts.push(`**Participants:** ${participants}`);
  if (summary) parts.push(`## Summary\n\n${summary}`);
  if (notes) parts.push(`## Notes\n\n${notes}`);
  if (!summary && !notes)
    parts.push("\n_(No notes or summary content returned for this meeting.)_");
  parts.push(
    "\n---\n_Published from Granola meeting notes via yeet " +
      "(raw transcript requires a paid Granola plan)._",
  );
  return parts.join("\n\n");
}

// ── transcript → markdown ─────────────────────────────────────
function transcriptToMarkdown(payload) {
  if (typeof payload === "string") return payload.trim();
  // common shapes: {transcript: "..."} | {markdown:"..."} |
  //   {segments:[{speaker,text,start}]} | [{speaker,text}]
  if (payload && typeof payload === "object") {
    if (typeof payload.markdown === "string") return payload.markdown.trim();
    if (typeof payload.transcript === "string")
      return payload.transcript.trim();
    if (typeof payload.text === "string") return payload.text.trim();
    const segs =
      payload.segments ||
      payload.entries ||
      payload.transcript ||
      (Array.isArray(payload) ? payload : null);
    if (Array.isArray(segs)) {
      return segs
        .map((s) => {
          if (typeof s === "string") return s;
          const who = s.speaker || s.source || s.role || "";
          const txt = s.text || s.content || s.value || "";
          return who ? `**${who}:** ${txt}` : txt;
        })
        .filter(Boolean)
        .join("\n\n")
        .trim();
    }
  }
  // last resort: stringify so the user at least gets the raw payload
  return JSON.stringify(payload, null, 2);
}

// ── command handlers ──────────────────────────────────────────
async function callTool(client, name, args) {
  let res;
  try {
    res = await client.callTool({ name, arguments: args });
  } catch (e) {
    const msg = e?.message || String(e);
    if (isPaidPlanError(null, msg))
      die(`PAID_PLAN_REQUIRED: ${msg}`, 3);
    throw e;
  }
  if (res?.isError) {
    const text = (res.content || [])
      .map((b) => b.text)
      .filter(Boolean)
      .join(" ");
    if (isPaidPlanError(res, text))
      die(`PAID_PLAN_REQUIRED: ${text || "transcript requires a paid plan"}`, 3);
    throw new Error(text || "tool call failed");
  }
  return res;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === "logout") {
    for (const n of [
      "client.json",
      "tokens.json",
      "verifier.json",
      "discovery.json",
    ])
      rm(n);
    ok("Cleared cached Granola credentials");
    return;
  }

  if (!cmd) die("usage: granola-mcp.mjs <list|transcript|account|introspect|logout>");

  const { client } = await connect();
  const tools = await resolveTools(client);

  if (cmd === "introspect") {
    const { tools: full } = await client.listTools();
    process.stdout.write(JSON.stringify(full, null, 2) + "\n");
    return;
  }

  if (cmd === "raw") {
    // raw <toolName> [jsonArgs]  — debug: dump the unprocessed result
    const name = rest[0];
    const args = rest[1] ? JSON.parse(rest[1]) : {};
    const res = await callTool(client, name, args);
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    return;
  }

  if (cmd === "list") {
    let limit = 20;
    const li = rest.indexOf("--limit");
    if (li !== -1 && rest[li + 1]) limit = parseInt(rest[li + 1], 10);
    if (!tools.list)
      die(`server exposes no meeting-list tool. Saw: ${tools.available.join(", ")}`);
    // list_meetings takes only a time_range enum (no server-side limit),
    // so we fetch the widest window and slice to `limit` client-side.
    const time_range = process.env.YEET_TIME_RANGE || "last_30_days";
    const args = buildArgs(tools.byName.get(tools.list), { time_range });
    const res = await callTool(client, tools.list, args);
    let meetings = normalizeMeetings(resultPayload(res));
    if (limit && meetings.length > limit) meetings = meetings.slice(0, limit);
    process.stdout.write(JSON.stringify(meetings) + "\n");
    return;
  }

  if (cmd === "transcript") {
    const id = rest[0];
    if (!id) die("usage: granola-mcp.mjs transcript <meeting-id>");
    if (!tools.transcript)
      die(`server exposes no transcript tool. Saw: ${tools.available.join(", ")}`);
    const args = buildArgs(tools.byName.get(tools.transcript), {
      meeting_id: id,
      id,
      document_id: id,
    });
    const res = await callTool(client, tools.transcript, args);
    process.stdout.write(transcriptToMarkdown(resultPayload(res)) + "\n");
    return;
  }

  if (cmd === "notes") {
    // free-plan fallback: publish the meeting's notes + AI summary
    const id = rest[0];
    if (!id) die("usage: granola-mcp.mjs notes <meeting-id>");
    if (!tools.notes)
      die(`server exposes no meeting-notes tool. Saw: ${tools.available.join(", ")}`);
    const args = buildArgs(tools.byName.get(tools.notes), {
      meeting_ids: [id],
      meeting_id: id,
      id,
    });
    const res = await callTool(client, tools.notes, args);
    process.stdout.write(notesToMarkdown(resultPayload(res)) + "\n");
    return;
  }

  if (cmd === "account") {
    if (!tools.account) die("server exposes no account tool");
    const res = await callTool(client, tools.account, {});
    process.stdout.write(JSON.stringify(resultPayload(res), null, 2) + "\n");
    return;
  }

  die(`unknown command: ${cmd}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    if (e instanceof UnauthorizedError)
      die(`authentication failed: ${e.message}`, 2);
    die(e?.message || String(e), 1);
  });
