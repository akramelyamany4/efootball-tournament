"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const defaults = require("./config");

const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const port = Number(process.env.PORT || 4173);
const dataDirectory = path.join(__dirname, "data");
const tournamentPath = path.join(dataDirectory, "tournament.json");
const adminPath = path.join(dataDirectory, "admin.json");
const sessionDuration = 8 * 60 * 60 * 1000;
const sessions = new Map();
const attempts = new Map();
let tournament;
let adminCredential;

if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length < 12) {
  throw new Error("ADMIN_PASSWORD must be at least 12 characters long.");
}

function json(response, status, value) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(value));
}

function reject(response, status, message) {
  json(response, status, { error: message });
}

function cookieValue(request, name) {
  const cookieHeader = request.headers.cookie || "";
  const match = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

function getSession(request) {
  const id = cookieValue(request, "efc_session");
  const session = sessions.get(id);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(id);
    return null;
  }
  session.expiresAt = Date.now() + sessionDuration;
  return { id, session };
}

function setSessionCookie(response, id) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `efc_session=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionDuration / 1000}${secure}`);
}

function clearSessionCookie(response) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `efc_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin || !request.headers.host) return false;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function isLoopbackRequest(request) {
  const address = request.socket.remoteAddress || "";
  const hostName = (request.headers.host || "").split(":")[0].replace(/^\[|\]$/g, "");
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)
    && ["localhost", "127.0.0.1", "::1"].includes(hostName);
}

function consumeAttempt(request) {
  const key = request.socket.remoteAddress || "unknown";
  const now = Date.now();
  const record = attempts.get(key) || { count: 0, expiresAt: now + 15 * 60 * 1000 };
  if (record.expiresAt <= now) {
    record.count = 0;
    record.expiresAt = now + 15 * 60 * 1000;
  }
  if (record.count >= 5) return false;
  record.count += 1;
  attempts.set(key, record);
  return true;
}

function clearAttempts(request) {
  attempts.delete(request.socket.remoteAddress || "unknown");
}

function makeCredential(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyCredential(password) {
  if (process.env.ADMIN_PASSWORD) {
    const expected = Buffer.from(process.env.ADMIN_PASSWORD);
    const received = Buffer.from(password);
    return expected.length === received.length && crypto.timingSafeEqual(expected, received);
  }
  if (!adminCredential) return false;
  const expected = Buffer.from(adminCredential.hash, "hex");
  const received = crypto.scryptSync(password, adminCredential.salt, expected.length);
  return crypto.timingSafeEqual(expected, received);
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 64 * 1024) throw Object.assign(new Error("Request is too large."), { status: 413 });
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw Object.assign(new Error("Invalid JSON."), { status: 400 });
  }
}

async function saveJson(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  await fs.promises.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.promises.rename(temporaryPath, filePath);
}

function cleanName(value, label, maxLength = 32) {
  if (typeof value !== "string") throw Object.assign(new Error(`${label} is required.`), { status: 400 });
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > maxLength || !/^[\p{L}\p{N} .&'-]+$/u.test(name)) {
    throw Object.assign(new Error(`${label} contains unsupported characters or is too long.`), { status: 400 });
  }
  return name;
}

function validateTournament(input) {
  const name = cleanName(input?.name, "Tournament name", 48);
  if (!Array.isArray(input?.players) || input.players.length !== 16) {
    throw Object.assign(new Error("The roster must contain exactly 16 players."), { status: 400 });
  }
  const players = input.players.map((player, index) => cleanName(player, `Player ${index + 1}`));
  if (new Set(players.map((player) => player.toLocaleLowerCase())).size !== players.length) {
    throw Object.assign(new Error("Player names must be unique."), { status: 400 });
  }
  if (!Array.isArray(input.matches) || input.matches.length !== 8) {
    throw Object.assign(new Error("The opening round must contain exactly 8 matches."), { status: 400 });
  }

  const usedPlayers = [];
  const matches = input.matches.map((match, index) => {
    const player1Index = Number(match?.player1Index);
    const player2Index = Number(match?.player2Index);
    if (!Number.isInteger(player1Index) || !Number.isInteger(player2Index)
      || player1Index < 0 || player1Index >= players.length
      || player2Index < 0 || player2Index >= players.length
      || player1Index === player2Index) {
      throw Object.assign(new Error(`Match ${index + 1} must contain two different players.`), { status: 400 });
    }
    usedPlayers.push(player1Index, player2Index);
    return {
      id: `M${index + 1}`,
      round: "Huitièmes de finale",
      player1: players[player1Index],
      player2: players[player2Index]
    };
  });

  if (new Set(usedPlayers).size !== players.length) {
    throw Object.assign(new Error("Each player must appear in exactly one opening match."), { status: 400 });
  }

  return { name, players, nextMatchId: "M1", matches };
}

const staticFiles = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/admin": ["admin.html", "text/html; charset=utf-8"],
  "/admin.html": ["admin.html", "text/html; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/script.js": ["script.js", "text/javascript; charset=utf-8"],
  "/admin.js": ["admin.js", "text/javascript; charset=utf-8"]
};

async function handleRequest(request, response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");

  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET" && staticFiles[url.pathname]) {
    const [fileName, contentType] = staticFiles[url.pathname];
    const file = await fs.promises.readFile(path.join(__dirname, fileName));
    response.writeHead(200, { "Cache-Control": "no-cache", "Content-Type": contentType });
    response.end(file);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/tournament") {
    json(response, 200, tournament);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/status") {
    json(response, 200, {
      authenticated: Boolean(getSession(request)),
      adminConfigured: Boolean(adminCredential || process.env.ADMIN_PASSWORD),
      setupAvailable: !adminCredential && !process.env.ADMIN_PASSWORD && isLoopbackRequest(request)
    });
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/admin/")) {
    if (!isSameOrigin(request)) {
      reject(response, 403, "Request origin could not be verified.");
      return;
    }
    const input = await readJsonBody(request);

    if (url.pathname === "/api/admin/setup") {
      if (!isLoopbackRequest(request) || adminCredential || process.env.ADMIN_PASSWORD) {
        reject(response, 403, "Administrator setup is only available on first launch from this computer.");
        return;
      }
      if (typeof input.password !== "string" || input.password.length < 12 || input.password.length > 128) {
        reject(response, 400, "Choose a password between 12 and 128 characters.");
        return;
      }
      adminCredential = makeCredential(input.password);
      await saveJson(adminPath, adminCredential);
    } else if (url.pathname === "/api/admin/login") {
      if (!consumeAttempt(request)) {
        reject(response, 429, "Too many attempts. Try again in 15 minutes.");
        return;
      }
      if (typeof input.password !== "string" || !verifyCredential(input.password)) {
        reject(response, 401, "The password is incorrect.");
        return;
      }
      clearAttempts(request);
    } else if (url.pathname === "/api/admin/logout") {
      const session = getSession(request);
      if (session) sessions.delete(session.id);
      clearSessionCookie(response);
      json(response, 200, { authenticated: false });
      return;
    } else if (url.pathname === "/api/admin/tournament") {
      if (!getSession(request)) {
        reject(response, 401, "Sign in to update the tournament.");
        return;
      }
      tournament = validateTournament(input);
      await saveJson(tournamentPath, tournament);
      json(response, 200, { tournament });
      return;
    } else {
      reject(response, 404, "Endpoint not found.");
      return;
    }

    const id = crypto.randomBytes(32).toString("hex");
    sessions.set(id, { expiresAt: Date.now() + sessionDuration });
    setSessionCookie(response, id);
    json(response, 200, { authenticated: true });
    return;
  }

  reject(response, 404, "Not found.");
}

async function start() {
  await fs.promises.mkdir(dataDirectory, { recursive: true });
  try {
    tournament = JSON.parse(await fs.promises.readFile(tournamentPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    tournament = defaults;
    await saveJson(tournamentPath, tournament);
  }
  try {
    adminCredential = JSON.parse(await fs.promises.readFile(adminPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      if (!response.headersSent) reject(response, error.status || 500, error.status ? error.message : "The server could not complete that request.");
      else response.destroy();
      if (!error.status) console.error(error);
    });
  });

  server.listen(port, host, () => {
    console.log(`EFOOTBALL CUP is available at http://${host}:${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});