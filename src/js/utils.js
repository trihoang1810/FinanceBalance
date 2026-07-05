export function compactCurrency(value) {
  const n = Number(value || 0);
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + " tỷ";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + " triệu";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + " nghìn";
  return String(n);
}

export function formatDateDisplay(value) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function formatDateTime(value) {
  return value ? new Date(value).toLocaleString("vi-VN") : "-";
}

export function formatDurationBetween(startValue, endValue) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end < start
  )
    return "-";

  let years = end.getFullYear() - start.getFullYear();
  let months = end.getMonth() - start.getMonth();
  let days = end.getDate() - start.getDate();

  if (days < 0) {
    days += new Date(end.getFullYear(), end.getMonth(), 0).getDate();
    months -= 1;
  }
  if (months < 0) {
    months += 12;
    years -= 1;
  }

  const parts = [];
  if (years) parts.push(`${years} năm`);
  if (months) parts.push(`${months} tháng`);
  if (days || !parts.length) parts.push(`${days} ngày`);
  return parts.join(" ");
}

export function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateFile(date) {
  return date.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export function nowIso() {
  return new Date().toISOString();
}

export function sanitizeName(value, maxLength = 50) {
  const text = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  return !text || text.length > maxLength ? "" : text;
}

export function sanitizeText(value, maxLength = 300) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

export function createStableDeviceId() {
  const key = "finance_app_device_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const newId = `device_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
  localStorage.setItem(key, newId);
  return newId;
}

export function createId(prefix) {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? `${prefix}_${crypto.randomUUID()}`
    : `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export function compareIso(a, b) {
  return new Date(a || 0).getTime() - new Date(b || 0).getTime();
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function sumBy(items, key) {
  return items.reduce((sum, item) => sum + Number(item[key] || 0), 0);
}

export function sortTransactionsAsc(a, b) {
  const diff = new Date(a.date) - new Date(b.date);
  if (diff !== 0) return diff;
  return (Number(a.sequence) || 0) - (Number(b.sequence) || 0);
}

export function sortTransactionsDesc(a, b) {
  const diff = new Date(b.date) - new Date(a.date);
  if (diff !== 0) return diff;
  return (Number(b.sequence) || 0) - (Number(a.sequence) || 0);
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function getSiteURL() {
  return window.location.hostname === "localhost"
    ? "http://localhost:3000"
    : window.location.origin;
}
