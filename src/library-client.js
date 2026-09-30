import { KANA_UNIT, createId } from "./units.js";
import { toLibrary, validateLibrary } from "./library-format.js";

const LEGACY_KEY = "kana-loop-units-v1";
const MIGRATION_KEY = "kana-loop-units-migrated-v1";
const OVERRIDES_KEY = "kana-loop-unit-overrides-v1";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createLibraryClient({ baseUrl = "/", local = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname), fetcher = (...args) => fetch(...args), storage = window.localStorage } = {}) {
  let published = { version: 1, units: [] };
  let units = [KANA_UNIT];
  let imports = [];
  let revision = null;
  let loaded = false;
  let legacyRaw = null;
  let legacy = [];

  function readLegacy() {
    legacyRaw = storage.getItem(LEGACY_KEY);
    legacy = legacyRaw ? validateLibrary(JSON.parse(legacyRaw)).units : [];
  }
  function browserUnits() {
    let overlay = storage.getItem(OVERRIDES_KEY);
    overlay = overlay ? JSON.parse(overlay) : { units: legacy, deletedIds: [] };
    const overrides = validateLibrary({ version: 1, units: overlay.units }).units;
    const byId = new Map(published.units.map((unit) => [unit.id, unit]));
    overrides.forEach((unit) => byId.set(unit.id, unit));
    (overlay.deletedIds || []).forEach((id) => byId.delete(id));
    return [KANA_UNIT, ...byId.values()];
  }
  async function request(path, options = {}) {
    const response = await fetcher(`${baseUrl}${path}`, { cache: "no-store", ...options });
    let result;
    try { result = await response.json(); }
    catch { throw new Error("词库服务返回了无效数据，请检查本地服务"); }
    if (!response.ok) throw new Error(result.error || `词库请求失败 (${response.status})`);
    return result;
  }
  function acceptSnapshot(result) {
    published = validateLibrary(result.library);
    if (typeof result.revision !== "string" || !Array.isArray(result.imports)) throw new Error("本地词库服务响应格式无效");
    revision = result.revision;
    imports = result.imports;
    units = [KANA_UNIT, ...published.units];
    loaded = true;
    return units;
  }
  async function reload() {
    if (local) return acceptSnapshot(await request("api/library"));
    published = validateLibrary(await request("data/units.json"));
    units = browserUnits();
    loaded = true;
    return units;
  }
  async function save(nextUnits, { importId } = {}) {
    if (!loaded) throw new Error("词库尚未加载成功，请先刷新词库");
    const library = toLibrary(nextUnits);
    if (local) {
      return acceptSnapshot(await request("api/library", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": revision },
        body: JSON.stringify({ ...library, ...(importId ? { importId } : {}) }),
      }));
    }
    const original = new Map(published.units.map((unit) => [unit.id, unit]));
    const ids = new Set(library.units.map((unit) => unit.id));
    storage.setItem(OVERRIDES_KEY, JSON.stringify({
      units: library.units.filter((unit) => !same(unit, original.get(unit.id))),
      deletedIds: published.units.filter((unit) => !ids.has(unit.id)).map((unit) => unit.id),
    }));
    units = [KANA_UNIT, ...library.units];
    return units;
  }
  function mergeIncoming(incoming) {
    const merged = new Map(units.filter((unit) => unit.kind !== "kana").map((unit) => [unit.id, unit]));
    incoming.forEach((unit) => {
      const previous = merged.get(unit.id);
      if (previous && !same(previous, unit)) {
        // Preserve both versions instead of overwriting a course with the same ID.
        const copy = { ...unit, id: createId("unit"), name: `${unit.name}（导入副本）` };
        merged.set(copy.id, copy);
      } else merged.set(unit.id, unit);
    });
    return [KANA_UNIT, ...merged.values()];
  }
  return {
    local,
    getUnits: () => units,
    getImports: () => imports,
    isLoaded: () => loaded,
    initialize: async () => {
      // A blocked browser store does not prevent using file-backed courses.
      try { readLegacy(); } catch (error) { console.warn("Unable to read legacy browser library", error); }
      return reload();
    },
    reload,
    save,
    migrationCount: () => {
      if (!local || !legacy.length) return 0;
      try { if (storage.getItem(MIGRATION_KEY) === legacyRaw) return 0; } catch { /* Migration remains available. */ }
      return legacy.filter((unit) => !units.some((saved) => same(saved, unit))).length;
    },
    migrate: async () => {
      const result = await save(mergeIncoming(legacy));
      try { storage.setItem(MIGRATION_KEY, legacyRaw); } catch (error) { console.warn("Unable to remember migration", error); }
      return result;
    },
    importLibrary: async (value) => save(mergeIncoming(validateLibrary(value).units)),
    discardImport: async (id) => {
      await request(`api/imports/${encodeURIComponent(id)}`, { method: "DELETE" });
      return reload();
    },
  };
}
