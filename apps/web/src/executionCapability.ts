export type ExecutionCapability = {
  network: string;
  spot: {visible:boolean;enabled:boolean;market?:boolean;limit?:boolean;bracket?:boolean;protectedOrders?:boolean};
  autopilot: {visible:boolean;enabled:boolean};
  contracts?: {registry?:string|null;oracleRouter?:string|null;spotFactory?:string|null;spotLimitFactory?:string|null;spotBracketFactory?:string|null;autopilotFactory?:string|null};
  persistence?: string;
  reasons?: Record<string,string>;
};
/** An HTTP 200 with an incomplete/wrong-chain body is not permission to enable execution. */
export function parseExecutionCapability(value: unknown, network: string): ExecutionCapability | null {
  if (!value || typeof value !== "object") return null;
  const candidate=value as ExecutionCapability;
  if(candidate.network!==network || !candidate.spot || !candidate.autopilot) return null;
  if([candidate.spot,candidate.autopilot].some(item=>typeof item.visible!=="boolean"||typeof item.enabled!=="boolean")) return null;
  if([candidate.spot.market,candidate.spot.limit,candidate.spot.bracket,candidate.spot.protectedOrders].some(item=>item!==undefined&&typeof item!=="boolean"))return null;
  if(candidate.contracts && (typeof candidate.contracts!=="object" || Object.values(candidate.contracts).some(value=>value!=null && (typeof value!=="string" || !/^0x[a-f\d]{40}$/i.test(value)))))return null;
  if(candidate.reasons && (typeof candidate.reasons!=="object" || Object.values(candidate.reasons).some(value=>typeof value!=="string")))return null;
  return candidate;
}
