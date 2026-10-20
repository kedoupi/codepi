import { chmod, rename, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const noEmit = process.argv.includes("--noEmit");
const root = fileURLToPath(new URL("..", import.meta.url));
const tsc = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));

if (noEmit) {
  await run(process.execPath, [tsc, "--noEmit"]);
} else {
  await rm(new URL("../dist", import.meta.url), { recursive: true, force: true });
  await run(process.execPath, [tsc]);
  await rename(
    new URL("../dist/codepi.js", import.meta.url),
    new URL("../dist/codepi.mjs", import.meta.url),
  );
  if (process.platform !== "win32") {
    await chmod(new URL("../dist/codepi.mjs", import.meta.url), 0o755);
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`tsc exited with ${signal ?? code}`));
    });
  });
}
