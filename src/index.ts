import app from "./app";
import { HokmGame } from "./hokmGame";
import { Bindings } from "./types";
import { runSweep } from "./sweep";

export { HokmGame };

// Cron trigger (every minute): reliable backstop for expiring duels and
// Hokm lobbies whose in-request setTimeout() may never fire.
const scheduled: ExportedHandlerScheduledHandler<Bindings> = async (
  _controller,
  env,
  ctx
) => {
  ctx.waitUntil(runSweep(env.DB, env.TELEGRAM_BOT_TOKEN));
};

/**
 * IMPORTANT: do not `export default app` here. When the default export is an
 * object (the Hono instance), Cloudflare reads the handler methods (`fetch`,
 * `scheduled`, ...) off that object and ignores separate named handler
 * exports — which breaks the cron trigger with:
 *   "Error: Handler does not export a scheduled() function"
 * So the default export must be a plain handler object instead.
 */
export default {
  fetch: (request: Request, env: Bindings, ctx: ExecutionContext) =>
    app.fetch(request, env, ctx),
  scheduled,
} satisfies ExportedHandler<Bindings>;
