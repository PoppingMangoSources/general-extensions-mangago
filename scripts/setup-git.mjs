import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
for (const [key, value] of Object.entries({
  "user.name": "Popmango Extensions",
  "user.email": "297959108+PoppingMangoSources@users.noreply.github.com",
  "commit.gpgsign": "false",
  "core.hooksPath": path.join(root, ".husky"),
}))
  execFileSync("git", ["config", "--local", key, value], { cwd: root });
