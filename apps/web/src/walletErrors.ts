/** Wallet bridges can reject with objects, including an object-valued message. */
export function walletErrorMessage(error: unknown, fallback = "The wallet request failed. Reopen your wallet and try again."): string {
  const seen = new Set<unknown>();
  function read(value: unknown, depth = 0): string | null {
    if (depth > 5 || value == null || seen.has(value)) return null;
    if (typeof value === "string") {
      const message = value.trim();
      return message && !/^\[object (?:Object|Error)\]$/.test(message) ? message : null;
    }
    if (typeof value !== "object") return null;
    seen.add(value);
    const e = value as Record<string, unknown>;
    if (Number(e.code) === 4001) return "Request declined in your wallet. No new withdrawal was authorized; resume any existing pending withdrawal.";
    for (const key of ["shortMessage", "message", "originalError", "error", "cause", "data"]) {
      const message = read(e[key], depth + 1);
      if (message) return message;
    }
    if (Number(e.code) === 4200 || Number(e.code) === -32601) return "This wallet does not support the requested method. Update the wallet or reconnect using its supported connection.";
    if (Number(e.code) === 4100) return "Reconnect and authorize this wallet account before continuing.";
    return null;
  }
  return read(error) || fallback;
}
