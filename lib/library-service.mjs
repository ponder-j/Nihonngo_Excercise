import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validateLibrary } from "../src/library-format.js";
import { WORD_FIELDS, validateWord } from "../src/units.js";
import lockfile from "proper-lockfile";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const revisionOf = (value) => `"${hash(value)}"`;
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(value, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

export function createLibraryService({ rootDir, dataFile = resolve(rootDir, "public/data/units.json"), stateDir = resolve(rootDir, ".local-data") }) {
  const importsDir = resolve(stateDir, "imports");
  const locksDir = resolve(rootDir, ".local-data/locks");
  let queue = Promise.resolve();
  function serial(action) {
    const pending = queue.then(async () => {
      await mkdir(locksDir, { recursive: true });
      // Share the lock across the launchd service and Vite development server.
      const release = await lockfile.lock(dataFile, { lockfilePath: resolve(locksDir, `${hash(dataFile)}.lock`), retries: { retries: 5, minTimeout: 50, maxTimeout: 500 } });
      try { return await action(); } finally { await release(); }
    });
    queue = pending.catch(() => {});
    return pending;
  }
  async function readLibrary() {
    // A missing or damaged file must not silently become an empty library.
    const raw = await readFile(dataFile, "utf8");
    return { library: validateLibrary(JSON.parse(raw)), revision: revisionOf(raw), raw };
  }
  async function readImports() {
    let names;
    try { names = await readdir(importsDir); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
    const drafts = await Promise.all(names.filter((name) => /^import-[a-f0-9]{32}\.json$/.test(name)).sort().map(async (name) => {
      return JSON.parse(await readFile(resolve(importsDir, name), "utf8"));
    }));
    return drafts.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async function snapshot() {
    const { library, revision } = await readLibrary();
    return { library, revision, imports: await readImports() };
  }
  function importPath(id) {
    if (typeof id !== "string" || !/^import-[a-f0-9]{32}$/.test(id)) throw new ApiError(400, "导入草稿 ID 无效");
    return resolve(importsDir, `${id}.json`);
  }
  return {
    snapshot: () => serial(snapshot),
    save: (value, expectedRevision, importId) => serial(async () => {
      let library;
      try { library = validateLibrary(value); }
      catch (error) { throw new ApiError(422, error.message); }
      const current = await readLibrary();
      if (!expectedRevision) throw new ApiError(428, "保存需要 If-Match 版本标识，请先读取词库");
      if (expectedRevision !== current.revision) throw new ApiError(409, "词库已被其他页面或 agent 修改。请刷新词库后再保存；当前输入仍保留。");
      let draftPath;
      if (importId) {
        draftPath = importPath(importId);
        let draft;
        try { draft = JSON.parse(await readFile(draftPath, "utf8")); }
        catch (error) { if (error.code === "ENOENT") throw new ApiError(404, "导入草稿已不存在，请刷新词库"); throw error; }
        if (!library.units.some((unit) => unit.id === draft.unit.id)) throw new ApiError(422, "确认的词库中缺少该导入单元");
      }
      const next = json(library);
      if (next !== current.raw) {
        const backup = resolve(stateDir, "backups", `${hash(current.raw)}.json`);
        await mkdir(dirname(backup), { recursive: true });
        await writeFile(backup, current.raw, { encoding: "utf8", flag: "wx" }).catch((error) => { if (error.code !== "EEXIST") throw error; });
        await atomicWrite(dataFile, next);
      }
      if (draftPath) await unlink(draftPath);
      return snapshot();
    }),
    createImport: (input) => serial(async () => {
      if (!input || typeof input.name !== "string" || !input.name.trim() || !Array.isArray(input.words) || !input.words.length || input.words.length > 5000) {
        throw new ApiError(422, "导入需要课程名称 name 和 1–5000 行 words");
      }
      const words = input.words.map((word, index) => {
        if (!word || typeof word !== "object" || Array.isArray(word)) throw new ApiError(422, `第 ${index + 1} 行格式无效`);
        return Object.fromEntries(WORD_FIELDS.map(({ key }) => {
          const value = word[key];
          if (value != null && !["string", "number"].includes(typeof value)) throw new ApiError(422, `第 ${index + 1} 行 ${key} 格式无效`);
          return [key, String(value ?? "").trim()];
        }));
      });
      const notes = input.notes ?? [];
      if (!Array.isArray(notes) || notes.some((note) => !note || !Number.isInteger(note.row) || note.row < 1 || note.row > words.length || typeof note.message !== "string" || (note.field && !WORD_FIELDS.some(({ key }) => key === note.field)))) {
        throw new ApiError(422, "notes 应包含有效的 row（从 1 开始）、message 和可选 field");
      }
      const source = String(input.source ?? "").trim();
      const content = { name: input.name.trim(), words, source, notes: notes.map(({ row, field, message }) => ({ row, ...(field ? { field } : {}), message })) };
      const digest = hash(JSON.stringify(content)).slice(0, 32);
      const id = `import-${digest}`;
      const unitId = `unit-${id}`;
      const { library } = await readLibrary();
      const approved = library.units.find((unit) => unit.id === unitId);
      if (approved) return { status: "approved", id, unit: approved, created: false };
      const path = importPath(id);
      try { return { ...JSON.parse(await readFile(path, "utf8")), created: false }; }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      const unit = { id: unitId, kind: "vocabulary", name: content.name, words: words.map((word, index) => ({ id: `word-${digest}-${index + 1}`, ...word })) };
      const issues = unit.words.flatMap((word, index) => {
        const result = validateWord(word);
        return result.valid ? [] : [{ row: index + 1, field: result.field, message: result.message }];
      });
      const draft = { id, status: "pending", createdAt: new Date().toISOString(), source, notes: content.notes, issues, unit };
      await atomicWrite(path, json(draft));
      return { ...draft, created: true };
    }),
    deleteImport: (id) => serial(async () => {
      await unlink(importPath(id)).catch((error) => { if (error.code !== "ENOENT") throw error; });
      return { ok: true };
    }),
  };
}
