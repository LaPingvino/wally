interface CallDebugEntry {
  ts: number;
  cat: string;
  msg: string;
  data?: unknown;
}

const LOG_SIZE = 50;
const log: CallDebugEntry[] = [];

export function callDebug(cat: string, msg: string, data?: unknown): void {
  const entry: CallDebugEntry = { ts: Date.now(), cat, msg, data };
  log.push(entry);
  if (log.length > LOG_SIZE) log.shift();
  if (data !== undefined) {
    console.debug(`[WallyCall:${cat}] ${msg}`, data);
  } else {
    console.debug(`[WallyCall:${cat}] ${msg}`);
  }
}

export function getCallDebugLog(): readonly CallDebugEntry[] {
  return log;
}
