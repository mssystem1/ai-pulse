export type LatestRequestRef = { current: number };

/** Starts a new request and makes every older response ineligible to update UI. */
export function beginLatestRequest(ref: LatestRequestRef): number {
  ref.current += 1;
  return ref.current;
}

/** Invalidates an in-flight request when its pair, timeframe or network changes. */
export function supersedeRequests(ref: LatestRequestRef): void {
  ref.current += 1;
}

export function isLatestRequest(ref: LatestRequestRef, requestId: number): boolean {
  return ref.current === requestId;
}
