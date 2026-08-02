import app from "./app";
import { HokmGame } from "./hokmGame";
import { Bindings } from "./types";
import { runSweep } from "./sweep";

export { HokmGame };
export default app;

// Cron trigger (every minute): reliable backstop for expiring duels and
// Hokm lobbies whose in-request setTimeout() may never fire.
export async function scheduled(
  _controller: ScheduledController,
  env: Bindings,
  ctx: ExecutionContext
): Promise<void> {
  ctx.waitUntil(runSweep(env.DB, env.TELEGRAM_BOT_TOKEN));
}
