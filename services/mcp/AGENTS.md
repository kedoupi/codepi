# CodePi MCP boundary

- Support service, not a product. Read the root contract and this directory's README.
- Keep MCP authorization separate from browser SSO and Oura authorization.
- Use the official SDK; domain logic lives in the owning app. Health is accessible
  only through its named Worker RPC capability, never a direct D1 binding.
- Never accept a tool-supplied owner ID, log health data or forward client tokens
  to downstream providers. Source/coverage/sync metadata is part of the tool contract.
- Checks: build Health API first, then `pnpm test`, `pnpm typecheck`, `pnpm build`.
- The user chose a direct cutover: the old Health MCP implementation is removed,
  and clients must authorize this service anew. Keep historical migrations and
  data; deleting code does not authorize deleting Health records or Oura credentials.
