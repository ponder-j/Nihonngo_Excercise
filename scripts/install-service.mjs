import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const label = "com.ponder.kana-loop";
const port = "1234";
const host = "127.0.0.1";
const nodeCandidates = [
  "/opt/homebrew/bin/node",
  "/usr/local/bin/node",
  process.execPath,
];
const nodePath = nodeCandidates.find((candidate) => {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}) || process.execPath;
const serverPath = resolve(rootDir, "server.mjs");
const launchAgentsDir = resolve(homedir(), "Library/LaunchAgents");
const logsDir = resolve(homedir(), "Library/Logs");
const plistPath = resolve(launchAgentsDir, `${label}.plist`);
const uid = process.getuid();
const domain = `gui/${uid}`;

if (process.platform !== "darwin") {
  throw new Error("This service installer supports macOS launchd only.");
}

const escapeXml = (value) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>${escapeXml(serverPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(rootDir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOST</key>
    <string>${escapeXml(host)}</string>
    <key>PORT</key>
    <string>${escapeXml(port)}</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${escapeXml(resolve(logsDir, "kana-loop.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(resolve(logsDir, "kana-loop-error.log"))}</string>
</dict>
</plist>
`;

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    ...options,
  });
}

function runQuiet(command, args) {
  return execFileSync(command, args, {
    cwd: rootDir,
    stdio: "ignore",
  });
}

mkdirSync(launchAgentsDir, { recursive: true });
mkdirSync(logsDir, { recursive: true });

const vitePath = resolve(rootDir, "node_modules/vite/bin/vite.js");
if (!existsSync(vitePath)) {
  throw new Error("Vite is not installed. Run `npm install` first.");
}

console.log("[kana-loop] building production files...");
run(nodePath, [vitePath, "build"]);
writeFileSync(plistPath, plist, "utf8");
run("/usr/bin/plutil", ["-lint", plistPath]);

try {
  runQuiet("/bin/launchctl", ["bootout", domain, plistPath]);
} catch {
  // The service was not loaded yet.
}

run("/bin/launchctl", ["bootstrap", domain, plistPath]);
run("/bin/launchctl", ["enable", `${domain}/${label}`]);
run("/bin/launchctl", ["kickstart", "-k", `${domain}/${label}`]);

console.log(`[kana-loop] service installed: ${plistPath}`);
console.log(`[kana-loop] running at http://${host}:${port}`);
