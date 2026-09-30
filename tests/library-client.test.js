import test from "node:test";
import assert from "node:assert/strict";
import { createLibraryClient } from "../src/library-client.js";
import { KANA_UNIT } from "../src/units.js";

const word = { id: "word-1", japanese: "学生", kana: "がくせい", accent: 0, meaning: "学生" };
const lesson = { id: "lesson-1", name: "第一课", kind: "vocabulary", words: [word] };
const library = (units) => ({ version: 1, units });
function setup(local, initial = [lesson]) {
  let published = library(initial), revision = '"v1"', fail = false;
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const fetcher = async (url, options = {}) => {
    if (fail) return { ok: false, status: 500, json: async () => ({ error: "文件不可读" }) };
    if (options.method === "PUT") {
      if (options.headers["If-Match"] !== revision) return { ok: false, status: 409, json: async () => ({ error: "版本已过期" }) };
      published = JSON.parse(options.body);
      revision = '"v2"';
    }
    return { ok: true, json: async () => local ? { library: published, revision, imports: [] } : published };
  };
  const client = createLibraryClient({ local, baseUrl: "/Nihonngo_Excercise/", storage, fetcher });
  return { client, storage, values, publish: (next) => { published = library(next); revision = '"updated"'; }, fail: () => { fail = true; } };
}

test("local file library is authoritative and browser courses can migrate without overwriting ID conflicts", async () => {
  const { client, storage } = setup(true);
  storage.setItem("kana-loop-units-v1", JSON.stringify(library([{ ...lesson, name: "旧浏览器版本" }])));
  assert.deepEqual(await client.initialize(), [KANA_UNIT, lesson]);
  assert.equal(client.migrationCount(), 1);
  const units = await client.migrate();
  assert.equal(units.length, 3);
  assert.equal(units[1].name, lesson.name);
  assert.notEqual(units[2].id, lesson.id);
  assert.equal(client.migrationCount(), 0);
  assert.ok(storage.getItem("kana-loop-units-v1"));
});

test("Pages reads published vocabulary and refreshes untouched units even with personal changes", async () => {
  const { client, publish } = setup(false, [lesson, { ...lesson, id: "lesson-2", name: "第二课" }]);
  await client.initialize();
  await client.save([KANA_UNIT, { ...lesson, name: "个人编辑" }, { ...lesson, id: "lesson-2", name: "第二课" }]);
  publish([{ ...lesson, name: "发布更新" }, { ...lesson, id: "lesson-2", name: "第二课 已更新" }]);
  const units = await client.reload();
  assert.equal(units[1].name, "个人编辑");
  assert.equal(units[2].name, "第二课 已更新");
});

test("Pages local deletions survive reload without deleting published data", async () => {
  const { client } = setup(false);
  await client.initialize();
  await client.save([KANA_UNIT]);
  assert.deepEqual(await client.reload(), [KANA_UNIT]);
});

test("local write errors retain the current library and never fall back to a browser-only save", async () => {
  const { client, fail } = setup(true);
  await client.initialize();
  fail();
  await assert.rejects(client.save([KANA_UNIT, { ...lesson, name: "新名称" }]), /文件不可读/);
  assert.deepEqual(client.getUnits(), [KANA_UNIT, lesson]);
});

test("saving from a stale tab reports a conflict instead of overwriting external changes", async () => {
  const { client, publish } = setup(true);
  await client.initialize();
  publish([{ ...lesson, name: "agent 已修改" }]);
  await assert.rejects(client.save([KANA_UNIT, lesson]), /版本已过期/);
  assert.equal((await client.reload())[1].name, "agent 已修改");
});

test("importing a JSON library merges new units and preserves an existing unit with the same ID", async () => {
  const { client } = setup(true);
  await client.initialize();
  const imported = await client.importLibrary(library([{ ...lesson, name: "迁入词库" }, { ...lesson, id: "lesson-2", name: "第二课" }]));
  assert.equal(imported.length, 4);
  assert.equal(imported[1].name, "第一课");
  assert.equal(imported[2].name, "迁入词库（导入副本）");
});

test("failed initialization prevents writes and invalid imported JSON cannot enter a library", async () => {
  const { client, fail } = setup(true);
  fail();
  await assert.rejects(client.initialize());
  await assert.rejects(client.save([KANA_UNIT, lesson]), /尚未加载/);
  await assert.rejects(client.importLibrary({ version: 2, units: [] }));
});
