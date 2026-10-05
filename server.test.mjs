import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAppServer } from "./server.mjs";

const jsonRequest = (url, body, options = {}) => fetch(url, {
  ...options,
  headers: { "Content-Type": "application/json", ...options.headers },
  body: JSON.stringify(body)
});

test("admin setup, authentication, CRUD and persistence", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fragline-admin-test-"));
  const dataFile = path.join(directory, "league.json");
  let server = await createAppServer({ dataFile, jsonBinMasterKey: "" });
  server.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  let baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });

  const initialResponse = await fetch(`${baseUrl}/api/state`);
  const initialState = await initialResponse.json();
  assert.equal(initialState.adminConfigured, false);
  assert.equal(initialState.matches.length, 3);

  const unauthorized = await jsonRequest(`${baseUrl}/api/admin/players`, {
    name: "NoAccess"
  }, { method: "POST" });
  assert.equal(unauthorized.status, 401);
  const unauthorizedSigmaPoint = await jsonRequest(`${baseUrl}/api/admin/sigma-points`, { name: "m0NESY" }, { method: "POST" });
  assert.equal(unauthorizedSigmaPoint.status, 401);

  const shortSetup = await jsonRequest(`${baseUrl}/api/setup`, { username: "testadmin", password: "short" }, { method: "POST" });
  assert.equal(shortSetup.status, 400);

  const password = "admin6";
  const setup = await jsonRequest(`${baseUrl}/api/setup`, { username: "testadmin", password }, { method: "POST" });
  assert.equal(setup.status, 201);
  const cookie = setup.headers.get("set-cookie").split(";")[0];
  const duplicateSetup = await jsonRequest(`${baseUrl}/api/setup`, { username: "testadmin", password }, { method: "POST" });
  assert.equal(duplicateSetup.status, 409);

  const stored = await readFile(dataFile, "utf8");
  assert.equal(stored.includes(password), false);
  assert.equal((await (await fetch(`${baseUrl}/api/state`, { headers: { Cookie: cookie } })).json()).isAdmin, true);

  const addPlayer = await jsonRequest(`${baseUrl}/api/admin/players`, {
    name: "TestRifler"
  }, { method: "POST", headers: { Cookie: cookie } });
  assert.equal(addPlayer.status, 201);
  const deductBelowZero = await jsonRequest(`${baseUrl}/api/admin/sigma-points`, { name: "TestRifler", delta: -1 }, { method: "POST", headers: { Cookie: cookie } });
  assert.equal(deductBelowZero.status, 409);

  for (let point = 0; point < 2; point++) {
    const award = await jsonRequest(`${baseUrl}/api/admin/sigma-points`, { name: "m0NESY", delta: 1 }, { method: "POST", headers: { Cookie: cookie } });
    assert.equal(award.status, 200);
  }
  const deductPoint = await jsonRequest(`${baseUrl}/api/admin/sigma-points`, { name: "m0NESY", delta: -1 }, { method: "POST", headers: { Cookie: cookie } });
  assert.equal(deductPoint.status, 200);
  assert.equal((await deductPoint.json()).points, 1);
  const awardedState = await (await fetch(`${baseUrl}/api/state`)).json();
  assert.equal(awardedState.sigmaPoints.m0NESY, 1);

  const state = await (await fetch(`${baseUrl}/api/state`)).json();
  assert.equal(state.players.includes("TestRifler"), true);
  assert.equal("roles" in state, false);
  assert.equal("teams" in state, false);
  const lineups = {
    a: ["m0NESY", "NiKo", "ropz", "b1t", "TestRifler"],
    b: ["donk", "ZywOo", "siuhy", "frozen", "JL"]
  };
  const stats = Object.fromEntries([...lineups.a, ...lineups.b].map(name => [name, [10, 9, 2, 80, 40]]));
  const invalidLineup = await jsonRequest(`${baseUrl}/api/admin/matches`, {
    date: "2026-02-31", map: "Dust2", a: "Red Dragons", b: "Night Owls", scoreA: 13, scoreB: 8, lineups, stats
  }, { method: "POST", headers: { Cookie: cookie } });
  assert.equal(invalidLineup.status, 400);
  const incompleteLineup = await jsonRequest(`${baseUrl}/api/admin/matches`, {
    date: "2026-09-30", map: "Dust2", a: "Red Dragons", b: "Night Owls", scoreA: 13, scoreB: 8,
    lineups: { a: lineups.a.slice(0, 4), b: lineups.b }, stats
  }, { method: "POST", headers: { Cookie: cookie } });
  assert.equal(incompleteLineup.status, 400);
  const addMatch = await jsonRequest(`${baseUrl}/api/admin/matches`, {
    date: "2026-09-30", map: "Dust2", a: "Red Dragons", b: "Night Owls", scoreA: 13, scoreB: 8, lineups, stats
  }, { method: "POST", headers: { Cookie: cookie } });
  assert.equal(addMatch.status, 201);
  const createdMatch = await addMatch.json();
  assert.equal(createdMatch.match.stats.TestRifler[0], 10);
  assert.equal(createdMatch.match.a, "Red Dragons");
  assert.equal(createdMatch.match.lineups.a.length, 5);

  const deleteAddedPlayer = await fetch(`${baseUrl}/api/admin/players/TestRifler`, { method: "DELETE", headers: { Cookie: cookie } });
  assert.equal(deleteAddedPlayer.status, 200);
  const afterPlayerRemoval = await (await fetch(`${baseUrl}/api/state`)).json();
  assert.equal(afterPlayerRemoval.players.includes("TestRifler"), false);
  assert.equal("TestRifler" in afterPlayerRemoval.sigmaPoints, false);
  assert.equal(afterPlayerRemoval.matches[0].lineups.a.includes("TestRifler"), false);
  assert.equal("TestRifler" in afterPlayerRemoval.matches[0].stats, false);
  const deleteMatch = await fetch(`${baseUrl}/api/admin/matches/${createdMatch.match.id}`, { method: "DELETE", headers: { Cookie: cookie } });
  assert.equal(deleteMatch.status, 200);

  await fetch(`${baseUrl}/api/logout`, { method: "POST", headers: { Cookie: cookie } });
  const loggedOutState = await (await fetch(`${baseUrl}/api/state`, { headers: { Cookie: cookie } })).json();
  assert.equal(loggedOutState.isAdmin, false);
  const afterLogout = await fetch(`${baseUrl}/api/admin/matches/1`, { method: "DELETE", headers: { Cookie: cookie } });
  assert.equal(afterLogout.status, 401);

  await new Promise(resolve => server.close(resolve));
  server = await createAppServer({ dataFile, jsonBinMasterKey: "" });
  server.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const persisted = await (await fetch(`${baseUrl}/api/state`)).json();
  assert.equal(persisted.adminConfigured, true);
  assert.equal(persisted.matches.length, 3);
  assert.equal(persisted.players.includes("TestRifler"), false);
  assert.equal(persisted.sigmaPoints.m0NESY, 1);
});

test("legacy team data migrates to global players and match-specific lineups", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fragline-migration-test-"));
  const dataFile = path.join(directory, "league.json");
  await writeFile(dataFile, JSON.stringify({
    admin: null,
    nextMatchId: 2,
    teams: { "Old Alpha": ["OldAWP"], "Old Omega": ["OldRifler"] },
    bench: { "Old Alpha": ["OldSub"], "Old Omega": [] },
    roles: { OldAWP: "AWP" },
    matches: [{
      id: 1, date: "2026-09-30", map: "Mirage", a: "Old Alpha", b: "Old Omega", scoreA: 13, scoreB: 7,
      stats: { OldAWP: [10, 5, 3, 90], OldSub: [5, 8, 1, 50], OldRifler: [8, 9, 2, 70] }
    }]
  }));
  const server = await createAppServer({ dataFile, jsonBinMasterKey: "" });
  server.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });

  const state = await (await fetch(`http://127.0.0.1:${server.address().port}/api/state`)).json();
  assert.deepEqual(state.players.sort(), ["OldAWP", "OldRifler", "OldSub"].sort());
  assert.equal("teams" in state, false);
  assert.equal("roles" in state, false);
  assert.deepEqual(state.matches[0].lineups, { a: ["OldAWP", "OldSub"], b: ["OldRifler"] });
});

test("JSONBin loads current state and writes admin changes to the provided bin", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fragline-jsonbin-test-"));
  const dataFile = path.join(directory, "unused-local-state.json");
  const binId = "6ac3d214ffd5d160534fd41a";
  const masterKey = "test-jsonbin-master-key";
  let remoteState = { admin: null, nextMatchId: 1, players: ["CloudPlayer"], matches: [], sigmaPoints: {} };
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, method: options.method, headers: options.headers });
    if (options.method === "GET") return { ok: true, status: 200, json: async () => ({ record: structuredClone(remoteState) }) };
    if (options.method === "PUT") {
      remoteState = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ record: structuredClone(remoteState) }) };
    }
    return { ok: false, status: 405, json: async () => ({}) };
  };
  const server = await createAppServer({ dataFile, jsonBinId: binId, jsonBinMasterKey: masterKey, fetchImpl });
  server.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });

  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].url, `https://api.jsonbin.io/v3/b/${binId}`);
  assert.equal(requests[0].headers["X-Master-Key"], masterKey);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const setup = await jsonRequest(`${baseUrl}/api/setup`, { username: "cloudadmin", password: "cloudpass123" }, { method: "POST" });
  assert.equal(setup.status, 201);
  const cookie = setup.headers.get("set-cookie").split(";")[0];
  const addPlayer = await jsonRequest(`${baseUrl}/api/admin/players`, { name: "CloudSecond" }, { method: "POST", headers: { Cookie: cookie } });
  assert.equal(addPlayer.status, 201);
  assert.equal(requests.filter(request => request.method === "PUT").length, 2);
  assert.equal(remoteState.players.includes("CloudSecond"), true);
});
