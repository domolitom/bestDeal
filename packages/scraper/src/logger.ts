/**
 * Structured logger — zero dependencies.
 *
 * - CI (process.env.CI or LOG_FORMAT=json): JSON lines to stderr
 * - Local: pretty "[module] message" to stderr
 */

export interface LogContext {
  module?: string;
  catalogId?: string;
  store?: string;
  country?: string;
  [key: string]: unknown;
}

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(ctx: LogContext): Logger;
  time(): () => number;
}

const isJson =
  process.env.LOG_FORMAT === "json" || process.env.CI === "true";

function formatPretty(
  level: string,
  msg: string,
  ctx: LogContext,
  data?: Record<string, unknown>
): string {
  const prefix = ctx.module ? `[${ctx.module}]` : "";
  const catalogSuffix = ctx.catalogId ? ` (${ctx.catalogId})` : "";
  const extra = data
    ? " " + Object.entries(data).map(([k, v]) => `${k}=${v}`).join(" ")
    : "";

  if (level === "warn") return `${prefix} WARN: ${msg}${catalogSuffix}${extra}`;
  if (level === "error") return `${prefix} ERROR: ${msg}${catalogSuffix}${extra}`;
  return `${prefix} ${msg}${catalogSuffix}${extra}`;
}

function formatJson(
  level: string,
  msg: string,
  ctx: LogContext,
  data?: Record<string, unknown>
): string {
  return JSON.stringify({
    level,
    msg,
    ts: new Date().toISOString(),
    ...ctx,
    ...data,
  });
}

function createLoggerInternal(ctx: LogContext): Logger {
  const write = (
    level: string,
    msg: string,
    data?: Record<string, unknown>
  ) => {
    const line = isJson
      ? formatJson(level, msg, ctx, data)
      : formatPretty(level, msg, ctx, data);

    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  };

  return {
    info: (msg, data) => write("info", msg, data),
    warn: (msg, data) => write("warn", msg, data),
    error: (msg, data) => write("error", msg, data),
    child: (extra) => createLoggerInternal({ ...ctx, ...extra }),
    time: () => {
      const start = performance.now();
      return () => Math.round(performance.now() - start);
    },
  };
}

export function createLogger(ctx: LogContext = {}): Logger {
  return createLoggerInternal(ctx);
}
