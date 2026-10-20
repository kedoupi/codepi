# CodePi MCP boundary

- Support service, not a product. Read the root contract and this directory's README.
- Keep MCP authorization separate from browser SSO and Oura authorization.
- Use the official SDK; domain logic lives in the owning app. Health, Project,
  Me and GU are accessible only through their named Worker RPC capabilities,
  never business D1/R2 bindings. Keep scopes checked per tool and per summary;
  write grants do not imply read grants.
- Never accept a tool-supplied owner ID, log health data or forward client tokens
  to downstream providers. Source/coverage/sync metadata is part of the tool contract.
- Checks: build Health API first, then `pnpm test`, `pnpm typecheck`, `pnpm build`.
- Large Health responses and Project cards have UTF-8 JSON fragment pagination.
  Preserve the original query, follow the cursor, and reject changed snapshots;
  do not truncate aggregation input or persist business snapshots in MCP D1.
- The user chose a direct cutover: the old Health MCP implementation is removed,
  and clients must authorize this service anew. Keep historical migrations and
  data; deleting code does not authorize deleting Health records or Oura credentials.
