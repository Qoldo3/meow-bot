import { describe, expect, it } from "vitest";
import { validateInitData } from "../src/hokmAuth";

const enc = new TextEncoder();

async function hmac(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const keyData = typeof key === "string" ? enc.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function buildInitData(botToken: string, fields: Record<string, string>): Promise<string> {
  const secret = await hmac("WebAppData", botToken);
  const pairs = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort();
  const dataCheckString = pairs.join("\n");
  const hash = hex(await hmac(secret, dataCheckString));
  return `${pairs.join("&")}&hash=${hash}`;
}

const TOKEN = "123456:TESTBOT";

describe("validateInitData", () => {
  it("accepts a correctly signed initData", async () => {
    const initData = await buildInitData(TOKEN, {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: "q123",
      user: JSON.stringify({ id: 42, first_name: "میو" }),
    });
    const result = await validateInitData(TOKEN, initData);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe(42);
    expect(result!.firstName).toBe("میو");
  });

  it("rejects a tampered payload", async () => {
    const initData = await buildInitData(TOKEN, {
      auth_date: "1710000000",
      query_id: "q123",
      user: JSON.stringify({ id: 42, first_name: "میو" }),
    });
    const tampered = initData.replace("id\":42", "id\":43");
    const result = await validateInitData(TOKEN, tampered);
    expect(result).toBeNull();
  });

  it("rejects when the hash is forged with the wrong token", async () => {
    const initData = await buildInitData("999:WRONG", {
      auth_date: "1710000000",
      user: JSON.stringify({ id: 42 }),
    });
    const result = await validateInitData(TOKEN, initData);
    expect(result).toBeNull();
  });

  it("rejects empty input", async () => {
    expect(await validateInitData(TOKEN, "")).toBeNull();
  });

  it("rejects stale auth_date", async () => {
    const old = Math.floor(Date.now() / 1000) - 999999;
    const initData = await buildInitData(TOKEN, {
      auth_date: String(old),
      user: JSON.stringify({ id: 42 }),
    });
    const result = await validateInitData(TOKEN, initData);
    expect(result).toBeNull();
  });
});
