export interface ValidatedInitData {
  userId: number;
  firstName: string;
  authDate: number;
}

const enc = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
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

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function validateInitData(
  botToken: string,
  initData: string,
  maxAgeSec = 86400
): Promise<ValidatedInitData | null> {
  if (!initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDateStr = params.get("auth_date");
  if (!hash || !authDateStr) return null;

  const authDate = parseInt(authDateStr, 10);
  if (!Number.isFinite(authDate) || Math.floor(Date.now() / 1000) - authDate > maxAgeSec) return null;

  const pairs: string[] = [];
  for (const [key, value] of params) {
    if (key !== "hash") pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secret = await hmacSha256("WebAppData", botToken);
  const calcHex = toHex(await hmacSha256(secret, dataCheckString));
  if (!constantTimeEqual(calcHex, hash)) return null;

  const userRaw = params.get("user");
  if (!userRaw) return null;
  let user: { id?: number; first_name?: string } | null = null;
  try {
    user = JSON.parse(userRaw);
  } catch {
    return null;
  }
  if (!user || typeof user.id !== "number") return null;

  return { userId: user.id, firstName: user.first_name ?? "", authDate };
}
