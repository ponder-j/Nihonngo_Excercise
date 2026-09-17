import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const label = "com.ponder.kana-loop";
const domain = `gui/${process.getuid()}`;
const plistPath = resolve(homedir(), "Library/LaunchAgents", `${label}.plist`);

try {
  execFileSync("/bin/launchctl", ["bootout", domain, plistPath], { stdio: "ignore" });
} catch {
  // The service was already unloaded.
}

if (existsSync(plistPath)) rmSync(plistPath);
console.log(`[kana-loop] service removed: ${label}`);
