import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";
import { mainMenuKeyboard } from "../src/keyboards";
import { parseEventCommand, parseReplyAction } from "../src/utils";

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("Meow Points worker", () => {
	it("responds with status online (unit style)", async () => {
		const request = new IncomingRequest("http://example.com");
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(await response.text()).toMatchInlineSnapshot(`"{\"ok\":true,\"bot\":\"Meow Points\",\"status\":\"online\"}"`);
	});

	it("responds with status online (integration style)", async () => {
		const response = await SELF.fetch("https://example.com");
		expect(await response.text()).toMatchInlineSnapshot(`"{\"ok\":true,\"bot\":\"Meow Points\",\"status\":\"online\"}"`);
	});

	it("includes richer quick-action buttons in the main menu", () => {
		const keyboard = mainMenuKeyboard();
		const labels = keyboard.inline_keyboard.flat().map((button) => button.text);
		expect(labels).toContain("📜 تاریخچه من");
		expect(labels).toContain("🎉 رویدادهای گروه");
		expect(labels).toContain("💸 انتقال امتیاز");
		expect(labels).toContain("🆘 راهنمای دستورات");
	});

	it("includes lottery quick-buy buttons up to 10 tickets", async () => {
		const { lotteryKeyboard } = await import("../src/keyboards");
		const keyboard = lotteryKeyboard(false);
		const labels = keyboard.inline_keyboard.flat().map((button) => button.text);
		expect(labels).toContain("🎫 1 بلیت");
		expect(labels).toContain("🎫 3 بلیت");
		expect(labels).toContain("🎫 4 بلیت");
		expect(labels).toContain("🎫 8 بلیت");
		expect(labels).toContain("🎫 9 بلیت");
		expect(labels).toContain("🎫 10 بلیت");
	});

	it("parses a valid add event command", () => {
    const parsed = parseEventCommand("/add event FlashSale 2 60");
    expect(parsed).toMatchObject({
      title: "FlashSale",
      description: "Bonus event",
      bonusMultiplier: 2,
    });
    expect(parsed?.startAt).toBeGreaterThan(0);
    expect(parsed?.endAt).toBeGreaterThan(parsed!.startAt);
  });

  it("parses a custom bonus multiplier for add event commands", () => {
    const parsed = parseEventCommand("/add event SuperBoost 3 120");
		expect(parsed?.bonusMultiplier).toBe(3);
	});

	it("parses edit event command variants", () => {
    expect(parseEventCommand("/editevent FlashSale 2 60")).toMatchObject({
      title: "FlashSale",
      bonusMultiplier: 2,
    });
    expect(parseEventCommand("/edit event FlashSale 2 60")).toMatchObject({
      title: "FlashSale",
      bonusMultiplier: 2,
    });
    expect(parseEventCommand("/editevent Halloween 1.5 45")).toMatchObject({
      title: "Halloween",
      bonusMultiplier: 1.5,
    });
  });

  it("parses multi-word titles for event commands", () => {
    const parsed = parseEventCommand("/editevent Mid Night Sale 2 60");
    expect(parsed?.title).toBe("Mid Night Sale");
  });

  it("rejects malformed event commands", () => {
    expect(parseEventCommand("/editevent")).toBeNull();
    expect(parseEventCommand("/editevent FlashSale 2")).toBeNull();
    expect(parseEventCommand("/deleteevent")).toBeNull();
    expect(parseEventCommand("FlashSale 2 60")).toBeNull();
  });

	it("parses reply-based user info and point adjustment actions", () => {
		expect(parseReplyAction("اطلاعات")).toEqual({ kind: "userinfo", amount: null });
		expect(parseReplyAction("+100")).toEqual({ kind: "add", amount: 100 });
		expect(parseReplyAction("-250")).toEqual({ kind: "remove", amount: 250 });
		expect(parseReplyAction("افزودن 500")).toEqual({ kind: "add", amount: 500 });
		expect(parseReplyAction("کسر 75")).toEqual({ kind: "remove", amount: 75 });
	});
});
