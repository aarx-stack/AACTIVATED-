// Minimal operational logger. Only short messages and whitelisted, non-sensitive fields are
// written. Never pass client names, addresses, document contents, provider payloads or secrets.

const SAFE_KEYS = new Set([
  "code",
  "name",
  "status",
  "operation",
  "provider",
  "mode",
  "table",
  "outcome",
  "httpStatus",
  "durationMs",
  "recordType",
]);

type Fields = Record<string, string | number | boolean | null | undefined>;

function redact(fields?: Fields): Fields | undefined {
  if (!fields) return undefined;
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) out[k] = SAFE_KEYS.has(k) ? v : "[redacted]";
  return out;
}

function write(level: "info" | "warn" | "error", message: string, fields?: Fields) {
  if (process.env.NODE_ENV === "test" && level === "info") return;
  const line = JSON.stringify({ level, message, ...redact(fields), at: new Date().toISOString() });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (message: string, fields?: Fields) => write("info", message, fields),
  warn: (message: string, fields?: Fields) => write("warn", message, fields),
  error: (message: string, fields?: Fields) => write("error", message, fields),
};
