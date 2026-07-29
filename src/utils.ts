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

export function randomMeowPoints(megaChance = 0.01, bigChance = 0.05): number {
  // Normalize chance inputs
  const mc = Number.isFinite(Number(megaChance)) ? Number(megaChance) : 0.01;
  const bc = Number.isFinite(Number(bigChance)) ? Number(bigChance) : 0.05;
  const roll = Math.random();
  if (roll < mc) return 1000; // MEGA
  if (roll < mc + bc) return Math.floor(Math.random() * 400) + 100; // BIG
  return Math.floor(Math.random() * 50) + 1; // normal
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

export function toEnglishNumbers(str: string): string {
  const persian = /[۰-۹]/g;
  const arabic = /[٠-٩]/g;

  return str
    .replace(persian, (w) => String.fromCharCode(w.charCodeAt(0) - 1728))
    .replace(arabic, (w) => String.fromCharCode(w.charCodeAt(0) - 1584));
}
