import app from "./app";
import { Bindings } from "./types";
import { runSweep } from "./sweep";
import { runDeployNotify } from "./deployNotify";
import { PokerGame } from "./pokerGame";
import { BlackjackGame } from "./blackjackGame";

// Cron trigger (every minute): reliable backstop for expiring duels whose
// in-request setTimeout() may never fire, plus deploy notifications.
const scheduled: ExportedHandlerScheduledHandler<Bindings> = async (
  _controller,
  env,
  ctx
) => {
  ctx.waitUntil(
    (async () => {
      await runSweep(env.DB, env.TELEGRAM_BOT_TOKEN);
      await runDeployNotify(env.DB, env.TELEGRAM_BOT_TOKEN, env.BOT_OWNER_ID);
    })()
  );
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

// Durable Objects for in-group card games. Must be named exports of the main
// module so the runtime can route their bindings to them.
export { PokerGame, BlackjackGame };
