import { MAX_AMOUNT } from "./constants";

export function isValidDuelId(id: string): boolean {
  return /^[a-z0-9]{8,16}$/.test(id);
}

export function safeParseAmount(str: string): number | null {
  const cleaned = toEnglishNumbers(str).trim();
  if (!/^\d+$/.test(cleaned)) return null;
  const num = parseInt(cleaned, 10);
  if (!Number.isFinite(num) || num <= 0 || num > MAX_AMOUNT) return null;
  return num;
}

export function normalizeUsername(raw: string): string {
  return raw.replace(/^@/, "").toLowerCase().trim();
}

export function isMeow(text: string): boolean {
  const normalized = text.toLowerCase().split(" ").filter(Boolean).join(" ").trim();
  // Exclude the duel command (and words that merely start with it like
  // "دعواگر") — the same token-boundary pattern app.ts uses to route duels.
  if (/^دعوا(?=[\s\u200C]|$)/.test(normalized)) return false;
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

  // Accept Persian/Arabic digits too (۰-۹ / ٠-٩); normalize before parseInt.
  const digit = "[0-9۰-۹٠-٩]";
  const addMatch = normalized.match(new RegExp(`^افزودن\\s+(${digit}+)$`, "i")) || normalized.match(new RegExp(`^\\+(${digit}+)$`));
  if (addMatch) {
    return { kind: "add", amount: parseInt(toEnglishNumbers(addMatch[1]), 10) };
  }

  const removeMatch = normalized.match(new RegExp(`^کسر\\s+(${digit}+)$`, "i")) || normalized.match(new RegExp(`^\\-(${digit}+)$`));
  if (removeMatch) {
    return { kind: "remove", amount: parseInt(toEnglishNumbers(removeMatch[1]), 10) };
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

// Tehran is UTC+3:30 year-round (Iran abolished DST in 2022). Workers run on
// UTC, so we shift the instant and format in UTC — deterministic everywhere.
const TEHRAN_OFFSET_MS = 3.5 * 3600 * 1000;

/** Format a unix timestamp as a Tehran date (Persian calendar). */
export function formatTehranDate(ts: number): string {
  return new Date(ts * 1000 + TEHRAN_OFFSET_MS).toLocaleDateString("fa-IR");
}

/** Format a unix timestamp as a Tehran time (Persian digits, HH:MM). */
export function formatTehranTime(ts: number): string {
  return new Date(ts * 1000 + TEHRAN_OFFSET_MS).toLocaleTimeString("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Current hour of day in Tehran (drives the day-part greeting). */
export function tehranHour(now: number = Date.now()): number {
  return new Date(now + TEHRAN_OFFSET_MS).getUTCHours();
}

/** Unix seconds of the most recent Tehran midnight (the bot's "day" boundary). */
export function tehranDayStart(now: number = Date.now()): number {
  return Math.floor((now + TEHRAN_OFFSET_MS) / 86400000) * 86400000 - TEHRAN_OFFSET_MS;
}
