import { connectSnippet } from "../connect.js";
import { argumentError } from "../errors.js";
import type { Io } from "./login.js";

export interface ConnectOptions {
  server: string;
  tool: string;
}

export function connect(options: ConnectOptions, io: Io = process): void {
  io.stdout.write(`${connectSnippet(options.tool, options.server)}\n`);
}
