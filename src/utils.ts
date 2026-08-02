import { MAX_AMOUNT } from "./constants";

export function isValidDuelId(id: string): boolean {
  return /^[a-z0-9]{8,16}$/.test(id);
}

export function safeParseAmount(str: string): number | null {
  const num = parseInt(toEnglishNumbers(str), 10);
  if (!Number.isFinite(num) || num <= 0 || num > MAX_AMOUNT) return null;
  return num;
}

export function normalizeUsername(raw: string): string {
  return raw.replace(/^@/, "").toLowerCase().trim();
}

export function isMeow(text: string): boolean {
  const normalized = text.toLowerCase().split(" ").filter(Boolean).join(" ").trim();
  if (normalized.startsWith("دعوا")) return false;
  if (/^(meo+w+ *)+$/.test(normalized)) return true;
  if (/^(می+و+ *)+$/.test(normalized)) return true;
  return false;
}

export function generateDuelId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  let text = "";
  if (minutes > 0) text += `${minutes} دقیقه `;
  if (seconds > 0) text += `${seconds} ثانیه`;
  return text.trim() || "چند لحظه";
}

export function parseReplyAction(text: string): { kind: "userinfo" | "add" | "remove"; amount: number | null } | null {
  const normalized = text.trim();
  if (!normalized) return null;

  if (/^اطلاعات$/i.test(normalized)) {
    return { kind: "userinfo", amount: null };
  }

  const addMatch = normalized.match(/^افزودن\s+([0-9]+)$/i) || normalized.match(/^\+([0-9]+)$/);
  if (addMatch) {
    return { kind: "add", amount: parseInt(addMatch[1], 10) };
  }

  const removeMatch = normalized.match(/^کسر\s+([0-9]+)$/i) || normalized.match(/^\-([0-9]+)$/);
  if (removeMatch) {
    return { kind: "remove", amount: parseInt(removeMatch[1], 10) };
  }

  return null;
}

export function parseEventCommand(text: string): { title: string; description: string; startAt: number; endAt: number; bonusMultiplier: number } | null {
  const normalized = text.trim();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length < 4) return null;

  const first = tokens[0].toLowerCase();
  const second = tokens[1]?.toLowerCase();

  let index = -1;
  if ((first === "/add" || first === "/edit") && second === "event") {
    index = 2;
  } else if (first === "/addevent" || first === "/editevent") {
    index = 1;
  }
  if (index < 0) return null;
  if (tokens.length < index + 3) return null;

  const minutes = parseInt(toEnglishNumbers(tokens[tokens.length - 1]), 10);
  const multiplier = parseFloat(toEnglishNumbers(tokens[tokens.length - 2]));
  const title = tokens.slice(index, -2).join(" ").trim();

  if (!title || !Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(multiplier) || multiplier <= 0) {
    return null;
  }

  const startAt = Math.floor(Date.now() / 1000);
  const endAt = startAt + minutes * 60;

  return {
    title,
    description: "Bonus event",
    startAt,
    endAt,
    bonusMultiplier: multiplier,
  };
}

export function toEnglishNumbers(str: string): string {
  const persian = /[۰-۹]/g;
  const arabic = /[٠-٩]/g;

  return str
    .replace(persian, (w) => String.fromCharCode(w.charCodeAt(0) - 1728))
    .replace(arabic, (w) => String.fromCharCode(w.charCodeAt(0) - 1584));
}
