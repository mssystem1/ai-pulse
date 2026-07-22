/** Deterministic FNV-1a 32-bit hash for stable demo features from addresses */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function seededUnit(seed: number, salt = 0): number {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function shortId(seed: string): string {
  return `pf_${fnv1a(seed).toString(16).padStart(8, "0")}`;
}
