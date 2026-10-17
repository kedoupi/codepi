import { dispatch, Failure, secure, type Env } from "./app";

const DAY = 86400_000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await dispatch(request, env); }
    catch (error) {
      // secure() is applied inside dispatch()/handlers for success paths; the
      // single catch rebuilds it here so error responses keep the same headers.
      return secure(Response.json({ error: error instanceof Failure ? error.code : "auth_unavailable" },
        { status: error instanceof Failure ? error.status : 503 }));
    }
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const now = Date.now();
    await env.DB.batch([
      ...["auth_transactions", "auth_codes", "auth_refs", "auth_sessions"].map(table =>
        env.DB.prepare(`DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE expires_at<? LIMIT 1000)`).bind(now)),
      env.DB.prepare("DELETE FROM auth_otp_sends WHERE created_at<?").bind(now - DAY),
    ]);
  },
} satisfies ExportedHandler<Env>;
