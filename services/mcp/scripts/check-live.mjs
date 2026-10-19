import { checkMcp } from '../../../scripts/cloudflare/mcp-checks.mjs';
const results = await checkMcp({
  origin: process.env.MCP_CHECK_ORIGIN, expectedBuild: process.env.MCP_EXPECT_BUILD,
});
for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.detail ? ': ' + result.detail : ''}`);
if (results.some(result => !result.ok)) process.exitCode = 1;
else console.log('CodePi MCP anonymous smoke passed; real client authorization and Health calls remain separate.');
