import { createServer as createHttpServer } from "node:http";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const defaultDataFile = path.join(rootDir, ".runtime", "league.json");
const defaultJsonBinId = "6ac3d214ffd5d160534fd41a";
const jsonBinBaseUrl = "https://api.jsonbin.io/v3/b";

async function loadLocalEnv() {
  let content;
  try {
    content = await readFile(path.join(rootDir, ".env"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const name = trimmed.slice(0, separator).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name) || process.env[name] !== undefined) continue;
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value) process.env[name] = value;
  }
}

await loadLocalEnv();

const cookieName = "cs2_admin_session";
const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const maps = new Set(["Ancient", "Anubis", "Dust2", "Inferno", "Mirage", "Nuke", "Train", "Vertigo"]);
const seedState = {
  admin: null,
  nextMatchId: 4,
  players: ["m0NESY", "NiKo", "ropz", "b1t", "Snax", "donk", "ZywOo", "siuhy", "frozen", "JL"],
  sigmaPoints: {},
  matches: [
    {
      id: 1, date: "2026-03-30", map: "Nuke", a: "Team Alpha", b: "Team Omega", scoreA: 13, scoreB: 6,
      lineups: { a: ["m0NESY", "NiKo", "ropz", "b1t", "Snax"], b: ["donk", "ZywOo", "siuhy", "frozen", "JL"] },
      stats: {
        m0NESY: [22, 12, 4, 94], NiKo: [20, 14, 6, 89], ropz: [17, 18, 4, 81], b1t: [15, 13, 3, 75], Snax: [13, 14, 8, 68],
        donk: [22, 15, 4, 96], ZywOo: [21, 17, 4, 94], siuhy: [10, 18, 7, 56], frozen: [11, 18, 4, 64], JL: [14, 19, 4, 70]
      }
    },
    {
      id: 2, date: "2026-03-29", map: "Inferno", a: "Team Alpha", b: "Team Omega", scoreA: 11, scoreB: 13,
      lineups: { a: ["m0NESY", "NiKo", "ropz", "b1t", "Snax"], b: ["donk", "ZywOo", "siuhy", "frozen", "JL"] },
      stats: {
        m0NESY: [20, 12, 4, 93.5], NiKo: [19, 14, 6, 90.3], ropz: [17, 17, 4, 80], b1t: [15, 13, 3, 74], Snax: [12, 14, 7, 67],
        donk: [20, 14, 4, 94], ZywOo: [21, 16, 4, 93], siuhy: [9, 18, 7, 55], frozen: [11, 18, 4, 63], JL: [13, 18, 4, 70]
      }
    },
    {
      id: 3, date: "2026-03-28", map: "Mirage", a: "Team Alpha", b: "Team Omega", scoreA: 13, scoreB: 9,
      lineups: { a: ["m0NESY", "NiKo", "ropz", "b1t", "Snax"], b: ["donk", "ZywOo", "siuhy", "frozen", "JL"] },
      stats: {
        m0NESY: [20, 12, 4, 93.3], NiKo: [19, 13, 6, 89.5], ropz: [16, 17, 4, 81.4], b1t: [15, 12, 3, 74.8], Snax: [12, 14, 8, 69],
        donk: [20, 15, 3, 95.6], ZywOo: [21, 16, 3, 95.6], siuhy: [9, 19, 7, 55.2], frozen: [10, 18, 5, 62], JL: [13, 18, 3, 70.6]
      }
    }
  ]
};

function json(res, status, value, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(JSON.stringify(value));
}

function requestCookie(req, name) {
  const cookies = (req.headers.cookie || "").split(";");
  const entry = cookies.map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  return entry ? entry.slice(name.length + 1) : "";
}

function cookieHeader(req, token, maxAge) {
  const forwardedProtocol = req.headers["x-forwarded-proto"];
  const secure = req.socket.encrypted || forwardedProtocol === "https";
  return `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function validOrigin(req) {
  if (!req.headers.origin) return true;
  try {
    return new URL(req.headers.origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function readJson(req) {
  if (!req.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    const error = new Error("Wymagany jest format JSON.");
    error.status = 415;
    throw error;
  }
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) {
      const error = new Error("Żądanie jest za duże.");
      error.status = 413;
      throw error;
    }
  }
  try {
    return JSON.parse(raw || "{}");
  } catch {
    const error = new Error("Nieprawidłowy JSON.");
    error.status = 400;
    throw error;
  }
}

function validatePassword(password) {
  return typeof password === "string" && password.length >= 6 && password.length <= 200;
}

function makePasswordHash(password, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: scryptSync(password, salt, 64).toString("hex") };
}

function verifyPassword(password, account) {
  if (typeof password !== "string" || !account) return false;
  const actual = scryptSync(password, account.salt, 64);
  const expected = Buffer.from(account.hash, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

function validatePlayerName(name) {
  return typeof name === "string" && /^[\p{L}\p{N}_.-]{2,24}$/u.test(name.trim());
}

function validNumber(value, max = 1000) {
  return Number.isInteger(value) && value >= 0 && value <= max;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function createAppServer({
  dataFile = process.env.DATA_FILE || defaultDataFile,
  jsonBinId = process.env.JSONBIN_BIN_ID || defaultJsonBinId,
  jsonBinMasterKey = process.env.JSONBIN_MASTER_KEY,
  fetchImpl = globalThis.fetch
} = {}) {
  const sessions = new Map();
  const loginAttempts = new Map();
  const remoteStore = jsonBinMasterKey ? {
    url: `${jsonBinBaseUrl}/${encodeURIComponent(jsonBinId)}`,
    headers: { "Content-Type": "application/json", "X-Master-Key": jsonBinMasterKey }
  } : null;
  let state;

  if (remoteStore) {
    const response = await fetchImpl(remoteStore.url, { method: "GET", headers: remoteStore.headers });
    if (!response.ok) throw new Error(`JSONBin GET failed (${response.status}); sprawdź BIN ID i JSONBIN_MASTER_KEY.`);
    const payload = await response.json();
    state = payload.record ?? payload;
    if (!state || !Array.isArray(state.players) || !Array.isArray(state.matches)) {
      throw new Error("JSONBin zwrócił dane w nieprawidłowym formacie ligi.");
    }
  } else {
    try {
      state = JSON.parse(await readFile(dataFile, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      state = structuredClone(seedState);
      await mkdir(path.dirname(dataFile), { recursive: true });
      await writeFile(dataFile, JSON.stringify(state, null, 2), { mode: 0o600 });
    }
  }

  async function persist() {
    if (remoteStore) {
      const response = await fetchImpl(remoteStore.url, {
        method: "PUT",
        headers: remoteStore.headers,
        body: JSON.stringify(state)
      });
      if (!response.ok) throw new Error(`JSONBin PUT failed (${response.status}).`);
      return;
    }
    await mkdir(path.dirname(dataFile), { recursive: true });
    const temporaryFile = `${dataFile}.${randomBytes(5).toString("hex")}.tmp`;
    await writeFile(temporaryFile, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temporaryFile, dataFile);
  }

  if (!Array.isArray(state.players)) {
    const previousTeams = state.teams || {};
    const previousBench = state.bench || {};
    state.players = [...new Set([...Object.values(previousTeams).flat(), ...Object.values(previousBench).flat()])];
    state.matches = state.matches.map(match => ({
      ...match,
      lineups: match.lineups || {
        a: [...(previousTeams[match.a] || []), ...(previousBench[match.a] || [])].filter(name => match.stats?.[name]),
        b: [...(previousTeams[match.b] || []), ...(previousBench[match.b] || [])].filter(name => match.stats?.[name])
      }
    }));
    delete state.teams;
    delete state.bench;
    delete state.roles;
    await persist();
  }
  if (!state.sigmaPoints) {
    state.sigmaPoints = {};
    await persist();
  }

  function currentSession(req) {
    const token = requestCookie(req, cookieName);
    const session = sessions.get(token);
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
      sessions.delete(token);
      return null;
    }
    session.expiresAt = Date.now() + sessionLifetimeMs;
    return session;
  }

  function createSession(req, res, username) {
    const token = randomBytes(32).toString("base64url");
    sessions.set(token, { username, expiresAt: Date.now() + sessionLifetimeMs });
    res.setHeader("Set-Cookie", cookieHeader(req, token, sessionLifetimeMs / 1000));
  }

  async function handleApi(req, res, url) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Allow": "GET, POST, DELETE, OPTIONS" });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      const session = currentSession(req);
      json(res, 200, {
        players: state.players,
        sigmaPoints: state.sigmaPoints,
        matches: state.matches,
        adminConfigured: Boolean(state.admin),
        isAdmin: Boolean(session),
        username: session?.username || null
      });
      return;
    }

    if (!["GET", "HEAD"].includes(req.method) && !validOrigin(req)) {
      json(res, 403, { error: "Odrzucono żądanie z innej domeny." });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/setup") {
      if (state.admin) {
        json(res, 409, { error: "Konto administratora jest już skonfigurowane." });
        return;
      }
      const body = await readJson(req);
      const username = typeof body.username === "string" ? body.username.trim() : "";
      if (!/^[a-zA-Z0-9._-]{3,24}$/.test(username) || !validatePassword(body.password)) {
        json(res, 400, { error: "Podaj login (3–24 znaki) i hasło o długości co najmniej 6 znaków." });
        return;
      }
      state.admin = { username, ...makePasswordHash(body.password) };
      await persist();
      createSession(req, res, username);
      json(res, 201, { ok: true, username });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const ip = req.socket.remoteAddress || "unknown";
      const attempts = loginAttempts.get(ip);
      if (attempts && attempts.resetAt > Date.now() && attempts.count >= 10) {
        json(res, 429, { error: "Za dużo prób logowania. Spróbuj ponownie za 15 minut." });
        return;
      }
      const body = await readJson(req);
      const passwordMatches = verifyPassword(body.password, state.admin);
      const usernameMatches = typeof body.username === "string" && body.username === state.admin?.username;
      if (!usernameMatches || !passwordMatches) {
        const current = loginAttempts.get(ip);
        loginAttempts.set(ip, current?.resetAt > Date.now()
          ? { count: current.count + 1, resetAt: current.resetAt }
          : { count: 1, resetAt: Date.now() + 15 * 60 * 1000 });
        json(res, 401, { error: "Nieprawidłowy login lub hasło." });
        return;
      }
      loginAttempts.delete(ip);
      createSession(req, res, state.admin.username);
      json(res, 200, { ok: true, username: state.admin.username });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/logout") {
      const token = requestCookie(req, cookieName);
      sessions.delete(token);
      json(res, 200, { ok: true }, { "Set-Cookie": cookieHeader(req, "", 0) });
      return;
    }

    const session = currentSession(req);
    if (!session) {
      json(res, 401, { error: "Zaloguj się jako administrator." });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/admin/players") {
      const body = await readJson(req);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!validatePlayerName(name)) {
        json(res, 400, { error: "Nick musi mieć 2–24 znaki: litery, cyfry, kropkę, myślnik lub podkreślenie." });
        return;
      }
      if (state.players.some(player => player.toLowerCase() === name.toLowerCase())) {
        json(res, 409, { error: "Zawodnik o takim nicku już istnieje." });
        return;
      }
      state.players.push(name);
      await persist();
      json(res, 201, { ok: true, name });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/admin/sigma-points") {
      const body = await readJson(req);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const delta = body.delta;
      if (!state.players.includes(name)) {
        json(res, 404, { error: "Nie znaleziono zawodnika." });
        return;
      }
      if (delta !== 1 && delta !== -1) {
        json(res, 400, { error: "Zmiana musi wynosić dokładnie +1 albo -1 punkt." });
        return;
      }
      const currentPoints = state.sigmaPoints[name] || 0;
      if (delta === -1 && currentPoints === 0) {
        json(res, 409, { error: "Zawodnik nie ma punktów do odjęcia." });
        return;
      }
      state.sigmaPoints[name] = currentPoints + delta;
      await persist();
      json(res, 200, { ok: true, name, points: state.sigmaPoints[name] });
      return;
    }

    const deletePlayerMatch = url.pathname.match(/^\/api\/admin\/players\/([^/]+)$/);
    if (req.method === "DELETE" && deletePlayerMatch) {
      const name = decodeURIComponent(deletePlayerMatch[1]);
      if (!state.players.includes(name)) {
        json(res, 404, { error: "Nie znaleziono zawodnika." });
        return;
      }
      state.players = state.players.filter(player => player !== name);
      delete state.sigmaPoints[name];
      for (const match of state.matches) {
        delete match.stats[name];
        match.lineups.a = match.lineups.a.filter(player => player !== name);
        match.lineups.b = match.lineups.b.filter(player => player !== name);
      }
      await persist();
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/admin/matches") {
      const body = await readJson(req);
      const scoreA = Number(body.scoreA);
      const scoreB = Number(body.scoreB);
      const teamA = typeof body.a === "string" ? body.a.trim() : "";
      const teamB = typeof body.b === "string" ? body.b.trim() : "";
      const lineups = body.lineups;
      const selectedPlayers = [...(lineups?.a || []), ...(lineups?.b || [])];
      if (!validDate(body.date) || !maps.has(body.map) ||
          !/^[\p{L}\p{N}][\p{L}\p{N} .&'_-]{1,31}$/u.test(teamA) || !/^[\p{L}\p{N}][\p{L}\p{N} .&'_-]{1,31}$/u.test(teamB) || teamA.toLowerCase() === teamB.toLowerCase() ||
          !validNumber(scoreA, 99) || !validNumber(scoreB, 99) || scoreA === scoreB) {
        json(res, 400, { error: "Sprawdź datę, mapę, drużyny i wynik meczu." });
        return;
      }
      if (!Array.isArray(lineups?.a) || !Array.isArray(lineups?.b) || lineups.a.length !== 5 || lineups.b.length !== 5 ||
          new Set(selectedPlayers).size !== 10 || selectedPlayers.some(name => !state.players.includes(name))) {
        json(res, 400, { error: "Wybierz po 5 różnych zawodników zarejestrowanych na mecz." });
        return;
      }
      const stats = {};
      for (const name of selectedPlayers) {
        if (!Array.isArray(body.stats?.[name]) || body.stats[name].length < 4) {
          json(res, 400, { error: `Uzupełnij statystyki zawodnika ${name}.` });
          return;
        }
        const [kills, deaths, assists, adr, headshots = 0] = body.stats[name].map(Number);
        if (![kills, deaths, assists, headshots].every(value => validNumber(value, 1000)) || !Number.isFinite(adr) || adr < 0 || headshots > 100) {
          json(res, 400, { error: `Nieprawidłowe statystyki zawodnika ${name}.` });
          return;
        }
        stats[name] = [kills, deaths, assists, adr, headshots];
      }
      const match = {
        id: state.nextMatchId++, date: body.date, map: body.map, a: teamA, b: teamB,
        scoreA, scoreB, lineups: { a: [...lineups.a], b: [...lineups.b] }, stats
      };
      state.matches.unshift(match);
      await persist();
      json(res, 201, { ok: true, match });
      return;
    }

    const deleteMatch = url.pathname.match(/^\/api\/admin\/matches\/(\d+)$/);
    if (req.method === "DELETE" && deleteMatch) {
      const id = Number(deleteMatch[1]);
      const index = state.matches.findIndex(match => match.id === id);
      if (index < 0) {
        json(res, 404, { error: "Nie znaleziono meczu." });
        return;
      }
      state.matches.splice(index, 1);
      await persist();
      json(res, 200, { ok: true });
      return;
    }

    json(res, 404, { error: "Nie znaleziono endpointu." });
  }

  return createHttpServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url);
        return;
      }
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        const page = await readFile(path.join(rootDir, "index.html"));
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
          "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:"
        });
        res.end(page);
        return;
      }
      if (req.method === "GET" && url.pathname === "/favicon.ico") {
        res.writeHead(204);
        res.end();
        return;
      }
      json(res, 404, { error: "Nie znaleziono strony." });
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error.status) {
        json(res, error.status, { error: error.message });
        return;
      }
      console.error(error);
      json(res, 500, { error: "Wystąpił błąd serwera." });
    }
  });
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const port = Number(process.env.PORT || 8000);
  const host = process.env.HOST || "0.0.0.0";
  const server = await createAppServer();
  server.listen(port, host, () => {
    console.log(`Fragline działa na http://${host}:${port}`);
    if (!process.env.JSONBIN_MASTER_KEY) console.warn("JSONBIN_MASTER_KEY nie jest ustawiony; dane są zapisywane lokalnie.");
  });
}
