import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
await run(process.execPath, [fileURLToPath(new URL("./build.mjs", import.meta.url))]);

const testDir = new URL("../test", import.meta.url);
const files = (await readdir(testDir))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => fileURLToPath(new URL(name, `${testDir.href}/`)));

if (files.length === 0) throw new Error("No test files found");
await run(process.execPath, ["--test", "--test-concurrency=1", ...files]);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${signal ?? code}`));
    });
  });
}
