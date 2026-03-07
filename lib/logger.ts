const IS_PROD = process.env.NODE_ENV === "production";

// ANSI colors
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgCyan: "\x1b[46m",
};

type LogLevel = "debug" | "info" | "success" | "warn" | "error" | "step";

const LEVEL_CONFIG: Record<LogLevel, { icon: string; color: string; label: string }> = {
  debug:   { icon: "·", color: C.gray,    label: "DBG" },
  info:    { icon: "●", color: C.cyan,    label: "INF" },
  success: { icon: "✓", color: C.green,   label: "OK " },
  warn:    { icon: "!", color: C.yellow,   label: "WRN" },
  error:   { icon: "✗", color: C.red,     label: "ERR" },
  step:    { icon: "→", color: C.magenta,  label: "STP" },
};

function timestamp(): string {
  const d = new Date();
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  const s = d.getSeconds().toString().padStart(2, "0");
  const ms = d.getMilliseconds().toString().padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

function formatMsg(level: LogLevel, scope: string, msg: string, meta?: string): string {
  const cfg = LEVEL_CONFIG[level];
  const ts = `${C.gray}${timestamp()}${C.reset}`;
  const tag = `${cfg.color}${cfg.icon} ${cfg.label}${C.reset}`;
  const sc = scope ? `${C.bold}${C.white}[${scope}]${C.reset} ` : "";
  const metaStr = meta ? ` ${C.dim}${meta}${C.reset}` : "";
  return `${ts} ${tag} ${sc}${msg}${metaStr}`;
}

function createScope(scope: string) {
  return {
    debug: (msg: string, meta?: string) => {
      if (!IS_PROD) console.log(formatMsg("debug", scope, msg, meta));
    },
    info: (msg: string, meta?: string) => {
      console.log(formatMsg("info", scope, msg, meta));
    },
    success: (msg: string, meta?: string) => {
      console.log(formatMsg("success", scope, msg, meta));
    },
    warn: (msg: string, meta?: string) => {
      console.warn(formatMsg("warn", scope, msg, meta));
    },
    error: (msg: string, meta?: string) => {
      console.error(formatMsg("error", scope, msg, meta));
    },
    step: (msg: string, meta?: string) => {
      console.log(formatMsg("step", scope, msg, meta));
    },
  };
}

// Pre-built scopes
export const log = createScope("");
export const logYoutube = createScope("youtube");
export const logAI = createScope("ai");
export const logVideo = createScope("video");
export const logYolo = createScope("yolo");
export const logWorker = createScope("worker");
export const logQueue = createScope("queue");
export const logSubs = createScope("subs");
export const logAPI = createScope("api");

// Startup banner
export function printBanner() {
  const v = process.env.npm_package_version || "1.0.0";
  const port = process.env.PORT || 9977;
  const env = IS_PROD ? `${C.green}production${C.reset}` : `${C.yellow}development${C.reset}`;

  console.log("");
  console.log(`  ${C.gray}┌──────────────────────────────────────────┐${C.reset}`);
  console.log(`  ${C.gray}│${C.reset}                                          ${C.gray}│${C.reset}`);
  console.log(`  ${C.gray}│${C.reset}   ${C.cyan}${C.bold}f${C.reset}${C.bold}raym${C.reset} ${C.dim}v${v}${C.reset}                           ${C.gray}│${C.reset}`);
  console.log(`  ${C.gray}│${C.reset}   ${C.dim}De YouTube a Shorts en un click${C.reset}        ${C.gray}│${C.reset}`);
  console.log(`  ${C.gray}│${C.reset}                                          ${C.gray}│${C.reset}`);
  console.log(`  ${C.gray}│${C.reset}   ${C.dim}env${C.reset}  ${env}                      ${C.gray}│${C.reset}`);
  console.log(`  ${C.gray}│${C.reset}   ${C.dim}port${C.reset} ${C.bold}:${port}${C.reset}                             ${C.gray}│${C.reset}`);
  console.log(`  ${C.gray}│${C.reset}                                          ${C.gray}│${C.reset}`);
  console.log(`  ${C.gray}└──────────────────────────────────────────┘${C.reset}`);
  console.log("");
}

// Job-specific logger with timing
export function createJobLogger(jobId: string) {
  const short = jobId.slice(0, 8);
  const scope = `job:${short}`;
  const start = Date.now();

  const scoped = createScope(scope);

  return {
    ...scoped,
    elapsed: () => {
      const ms = Date.now() - start;
      if (ms < 1000) return `${ms}ms`;
      return `${(ms / 1000).toFixed(1)}s`;
    },
    done: (msg: string) => {
      const ms = Date.now() - start;
      const time = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
      scoped.success(msg, `(${time})`);
    },
  };
}
