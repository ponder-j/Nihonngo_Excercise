import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createServer, get as httpGet } from "node:http";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createLibraryService } from "../lib/library-service.mjs";
import { createLibraryApi } from "../lib/library-api.mjs";

const word = { id: "word-1", japanese: "学生", kana: "がくせい", accent: 0, meaning: "学生" };
const lesson = { id: "lesson-1", name: "第一课", kind: "vocabulary", words: [word] };
const empty = { version: 1, units: [] };
let root, path, server, url, service;

beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), "kana-library-test-"));
  path = resolve(root, "public/data/units.json");
  await mkdir(resolve(root, "public/data"), { recursive: true });
  await writeFile(path, JSON.stringify(empty));
  service = createLibraryService({ rootDir: root });
  const api = createLibraryApi(service);
  server = createServer(async (req, res) => { if (!(await api(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});

async function get() { return (await fetch(`${url}/api/library`)).json(); }
async function put(library, revision, extra = {}) {
  return fetch(`${url}/api/library`, { method: "PUT", headers: { "Content-Type": "application/json", ...(revision ? { "If-Match": revision } : {}) }, body: JSON.stringify({ ...library, ...extra }) });
}
async function draft(payload = { name: "第一课", words: [{ ...word, accent: "" }] }) {
  return fetch(`${url}/api/imports`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}

test("saving writes a normalized durable library, preserves a backup, and survives service recreation", async () => {
  const initial = await get();
  const response = await put({ version: 1, units: [lesson] }, initial.revision);
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { version: 1, units: [lesson] });
  assert.equal((await readdir(resolve(root, ".local-data/backups"))).length, 1);
  assert.deepEqual((await createLibraryService({ rootDir: root }).snapshot()).library.units, [lesson]);
  assert.equal(response.headers.get("etag"), (await get()).revision);
  assert.equal((await fetch(`${url}/api/health`)).status, 200);
});

test("concurrent editors cannot replace a newer saved revision", async () => {
  const { revision } = await get();
  const results = await Promise.all([put({ version: 1, units: [lesson] }, revision), put({ version: 1, units: [{ ...lesson, name: "另一份修改" }] }, revision)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await get()).library.units.length, 1);
  assert.equal((await put(empty)).status, 428);
});

test("separate service instances share a file lock and preserve the newer revision", async () => {
  const another = createLibraryService({ rootDir: root });
  const { revision } = await service.snapshot();
  const results = await Promise.allSettled([
    service.save({ version: 1, units: [lesson] }, revision),
    another.save({ version: 1, units: [{ ...lesson, name: "并行服务" }] }, revision),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.status, 409);
});

test("incomplete words, duplicate IDs and malformed input cannot damage the file", async () => {
  const { revision } = await get();
  for (const units of [[{ ...lesson, words: [{ ...word, accent: "" }] }], [lesson, lesson], [{ ...lesson, words: [word, word] }], [{ ...lesson, words: [null] }]]) {
    assert.equal((await put({ version: 1, units }, revision)).status, 422);
  }
  assert.equal((await fetch(`${url}/api/library`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{bad" })).status, 400);
  assert.equal((await fetch(`${url}/api/imports`, { method: "POST", body: "{}" })).status, 415);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), empty);
});

test("imports persist incomplete rows for review, retry idempotently, and only approval enters the published file", async () => {
  const payload = { name: "第一课", source: "词表.png", words: [{ ...word, accent: "" }], notes: [{ row: 1, field: "accent", message: "声调不清楚" }] };
  const response = await draft(payload);
  assert.equal(response.status, 201);
  const imported = await response.json();
  assert.equal(imported.issues[0].field, "accent");
  assert.equal((await get()).imports.length, 1);
  assert.deepEqual((await get()).library, empty);
  const repeat = await draft(payload);
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).id, imported.id);
  const { revision } = await get();
  assert.equal((await put({ version: 1, units: [imported.unit] }, revision, { importId: imported.id })).status, 422);
  const confirmed = { ...imported.unit, words: imported.unit.words.map((word) => ({ ...word, accent: 0 })) };
  assert.equal((await put({ version: 1, units: [confirmed] }, revision, { importId: imported.id })).status, 200);
  assert.deepEqual((await get()).imports, []);
  assert.deepEqual((await get()).library.units, [confirmed]);
  assert.equal((await (await draft(payload)).json()).status, "approved");
});

test("discarding an import leaves confirmed data intact, and invalid paths are rejected", async () => {
  const imported = await (await draft()).json();
  assert.equal((await fetch(`${url}/api/imports/${imported.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await get()).imports.length, 0);
  assert.deepEqual((await get()).library, empty);
  assert.equal((await fetch(`${url}/api/imports/not-an-id`, { method: "DELETE" })).status, 400);
});

test("foreign origins and DNS rebinding Host headers cannot read or mutate the local library", async () => {
  assert.equal((await fetch(`${url}/api/library`, { headers: { Origin: "https://foreign.example" } })).status, 403);
  const status = await new Promise((resolve, reject) => httpGet(`${url}/api/library`, { headers: { Host: "foreign.example" } }, (res) => { res.resume(); resolve(res.statusCode); }).on("error", reject));
  assert.equal(status, 403);
  assert.equal((await fetch(`${url}/api/library`, { headers: { Origin: url } })).status, 200);
});

test("corrupted and missing canonical files fail without silently replacing user data", async (context) => {
  context.mock.method(console, "error", () => {});
  await writeFile(path, "{damaged");
  assert.equal((await fetch(`${url}/api/library`)).status, 500);
  assert.equal(await readFile(path, "utf8"), "{damaged");
  await rm(path);
  assert.equal((await fetch(`${url}/api/health`)).status, 500);
});

test("the agent import CLI works against a real local server and reports a review link", async () => {
  const payloadPath = resolve(root, "words.json");
  await writeFile(payloadPath, JSON.stringify({ name: "CLI 课程", words: [word] }));
  const { stdout } = await promisify(execFile)(process.execPath, [".agents/skills/nihongo-vocabulary-import/scripts/import-vocabulary.mjs", payloadPath, "--url", url]);
  const output = JSON.parse(stdout);
  assert.equal(output.words, 1);
  assert.equal(output.status, "pending");
  assert.ok(output.reviewUrl.startsWith(`${url}/?import=`));
  assert.equal((await get()).imports[0].unit.name, "CLI 课程");
});
