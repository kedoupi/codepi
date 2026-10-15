import { readFileSync } from "node:fs";
const config = readFileSync("wrangler.toml", "utf8");
if (config.includes("00000000-0000-0000-0000-")) {
  console.error("Deployment blocked: provision separate production/preview D1 databases and replace placeholders.");
  process.exit(1);
}
console.log("D1 placeholders replaced. Verify secrets, preview isolation, OTP delivery and domain bindings before publishing data.");
