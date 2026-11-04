#!/usr/bin/env node
import { parseArgs } from "node:util";
import { context } from "./commands/context.js";
import { connect } from "./commands/connect.js";
import { handoff } from "./commands/handoff.js";
import { init } from "./commands/init.js";
import { login } from "./commands/login.js";
import { logout } from "./commands/logout.js";
import { project, tasks, work } from "./commands/project.js";
import {
  CliError,
  EXIT,
  argumentError,
  errorMessage,
} from "./errors.js";
import { normalizeServer } from "./server.js";

const HELP = `codepi - CodePi MCP CLI

Usage:
  codepi login [--scopes a,b] [--server URL] [--json]
  codepi logout [--server URL] [--json]
  codepi context [--server URL] [--json]
  codepi work [--server URL] [--json]
  codepi tasks [--repo PROJECT] [--status S] [--need N] [--include-done] [--server URL] [--json]
  codepi project [list] [--repo PROJECT] [--server URL] [--json]
  codepi handoff --task KEY --status STATUS --summary TEXT --next TEXT [options]
  codepi connect <tool> [--server URL]
  codepi init [--yes] [--json]

Global:
  --server URL    Default: CODEPI_SERVER or https://mcp.codepi.app
  --json          Print the tool's raw structured JSON
  -h, --help      Show help
  --version       Show version

work:
  What needs you across all projects (work_overview).

tasks:
  --repo PROJECT  Project id or owner/repo; default all projects
  --status S      decide | doing | bug | verify | idea
  --need N        any | none | decide | attend | authorize | confirm
  --include-done  Include recently finished tasks
  Follows task_list next_offset to completion before any output.

project:
  PROJECT defaults to the GitHub origin of the current repository.
  list shows every project with open and need-you counts.

handoff:
  --task KEY      Required task key from codepi tasks, or a free task id
  --status S      in_progress | blocked | ready_for_review | done
  --summary TEXT  Required; use "-" to read stdin
  --next TEXT     Required next step (for done, explain completion)
  --blockers TEXT Optional blockers
  --files a,b     Optional changed files; may repeat
  --branch B      Defaults to the current Git branch when there is one
  --base SHA      Defaults to git merge-base HEAD origin/main when available
  --commit SHA    Optional 7-40 hex commit
  --pr VALUE      Optional PR reference, at most 500 characters
  --request-id ID Optional retry id, at most 100 characters; otherwise UUID

Exit codes:
  0 success; 1 arguments; 2 login/refresh required; 3 insufficient scope; 4 remote error
`;

const OPTIONS = {
  server: { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean" },
  debug: { type: "boolean" },
  scopes: { type: "string" },
  repo: { type: "string" },
  need: { type: "string" },
  "include-done": { type: "boolean" },
  task: { type: "string" },
  status: { type: "string" },
  summary: { type: "string" },
  next: { type: "string" },
  blockers: { type: "string" },
  blocker: { type: "string" },
  files: { type: "string", multiple: true },
  file: { type: "string", multiple: true },
  branch: { type: "string" },
  base: { type: "string" },
  commit: { type: "string" },
  pr: { type: "string" },
  "request-id": { type: "string" },
  yes: { type: "boolean", short: "y" },
} as const;

type Values = {
  server?: string;
  json?: boolean;
  help?: boolean;
  version?: boolean;
  debug?: boolean;
  scopes?: string;
  repo?: string;
  need?: string;
  "include-done"?: boolean;
  task?: string;
  status?: string;
  summary?: string;
  next?: string;
  blockers?: string;
  blocker?: string;
  files?: string[];
  file?: string[];
  branch?: string;
  base?: string;
  commit?: string;
  pr?: string;
  "request-id"?: string;
  yes?: boolean;
};

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  let parsed: { values: Values; positionals: string[] };
  try {
    parsed = parseArgs({
      args: argv,
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
    }) as { values: Values; positionals: string[] };
  } catch (error) {
    process.stderr.write(`codepi: ${errorMessage(error)}\n`);
    return EXIT.ARGUMENT;
  }

  const { values, positionals } = parsed;
  if (values.version) {
    process.stdout.write("0.1.0\n");
    return EXIT.OK;
  }
  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP);
    return EXIT.OK;
  }
  const command = positionals[0];
  const extras = positionals.slice(1);
  const json = Boolean(values.json);

  try {
    const server = normalizeServer(
      values.server ?? process.env.CODEPI_SERVER ?? "https://mcp.codepi.app",
    );
    if (values.debug) process.stderr.write(`codepi: command=${command} server=${server}\n`);
    switch (command) {
      case "login":
        assertExtras(command, extras, 0);
        await login({
          server,
          ...(values.scopes === undefined ? {} : { scopes: values.scopes }),
          json,
        });
        return EXIT.OK;
      case "logout":
        assertExtras(command, extras, 0);
        await logout({ server, json });
        return EXIT.OK;
      case "context":
        assertExtras(command, extras, 0);
        await context({ server, json });
        return EXIT.OK;
      case "project": {
        if (extras.length > 1 || (extras.length === 1 && extras[0] !== "list")) {
          throw argumentError("用法：codepi project [list]");
        }
        if (values.status !== undefined || values.need !== undefined) {
          throw argumentError("--status、--need 用于 `codepi tasks`。");
        }
        await project({
          server,
          json,
          list: extras[0] === "list",
          ...(values.repo === undefined ? {} : { repo: values.repo }),
        });
        return EXIT.OK;
      }
      case "work":
        assertExtras(command, extras, 0);
        await work({ server, json });
        return EXIT.OK;
      case "tasks":
        assertExtras(command, extras, 0);
        await tasks({
          server,
          json,
          ...(values.repo === undefined ? {} : { repo: values.repo }),
          ...(values.status === undefined ? {} : { status: values.status }),
          ...(values.need === undefined ? {} : { need: values.need }),
          ...(values["include-done"] ? { includeDone: true } : {}),
        });
        return EXIT.OK;
      case "handoff": {
        assertExtras(command, extras, 0);
        if (!values.task) throw argumentError("handoff 必须传 --task。");
        if (!values.status) throw argumentError("handoff 必须传 --status。");
        if (values.summary === undefined) throw argumentError("handoff 必须传 --summary。");
        if (values.next === undefined) throw argumentError("handoff 必须传 --next。");
        const summary = values.summary === "-" ? await readStdin() : values.summary;
        const blockers = [values.blockers, values.blocker].filter(
          (value): value is string => typeof value === "string" && value.length > 0,
        ).join("\n");
        await handoff({
          server,
          json,
          task: values.task,
          status: values.status,
          summary,
          next: values.next,
          files: [...(values.file ?? []), ...(values.files ?? [])],
          ...(blockers ? { blockers } : {}),
          ...(values.branch === undefined ? {} : { branch: values.branch }),
          ...(values.base === undefined ? {} : { base: values.base }),
          ...(values.commit === undefined ? {} : { commit: values.commit }),
          ...(values.pr === undefined ? {} : { pr: values.pr }),
          ...(values.repo === undefined ? {} : { repo: values.repo }),
          ...(values["request-id"] === undefined ? {} : { requestId: values["request-id"] }),
        });
        return EXIT.OK;
      }
      case "connect":
        assertExtras(command, extras, 1);
        connect({ server, tool: extras[0] as string });
        return EXIT.OK;
      case "init":
        assertExtras(command, extras, 0);
        await init({ yes: Boolean(values.yes), json });
        return EXIT.OK;
      default:
        throw argumentError(`未知命令：${command}`);
    }
  } catch (error) {
    const cliError = error instanceof CliError
      ? error
      : new CliError(errorMessage(error), EXIT.REMOTE, { code: "unexpected_error" });
    process.stderr.write(`codepi: ${cliError.message}\n`);
    if (cliError.scope) process.stderr.write(`codepi: required scope: ${cliError.scope}\n`);
    if (cliError.exitCode === EXIT.AUTH) {
      process.stderr.write("codepi: run `codepi login` to sign in.\n");
    }
    return cliError.exitCode;
  }
}

function assertExtras(command: string, extras: string[], expected: number): void {
  if (extras.length !== expected) {
    throw argumentError(expected === 0
      ? `${command} 不接受位置参数。`
      : `用法：codepi ${command} <${expected === 1 ? "argument" : "arguments"}>`);
  }
}

async function readStdin(): Promise<string> {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

process.exitCode = await runCli();
