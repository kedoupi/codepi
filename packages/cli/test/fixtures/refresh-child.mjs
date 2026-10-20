import { CredentialStore } from "../../dist/config.js";
import { refreshCredentialsIfNeeded } from "../../dist/oauth.js";

const server = process.env.CODEPI_TEST_SERVER;
const configDir = process.env.CODEPI_CONFIG_DIR;
if (!server || !configDir) throw new Error("missing fixture environment");

const store = new CredentialStore(server, { configDir });
await new Promise((resolve) => setTimeout(resolve, 25));
const result = await refreshCredentialsIfNeeded(store);
process.stdout.write(`${JSON.stringify({ refreshed: result.refreshed })}\n`);
