import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { validateLibrary } from "./src/library-format.js";
import { createLibraryService } from "./lib/library-service.mjs";
import { createLibraryApi } from "./lib/library-api.mjs";

const api = createLibraryApi(createLibraryService({ rootDir: fileURLToPath(new URL(".", import.meta.url)) }));

export default defineConfig({
  base: process.env.BASE_PATH || "/",
  server: { host: "127.0.0.1" },
  plugins: [{
    name: "local-library-api",
    buildStart() {
      validateLibrary(JSON.parse(readFileSync(new URL("./public/data/units.json", import.meta.url), "utf8")));
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => { if (!(await api(req, res))) next(); });
    },
  }],
});
