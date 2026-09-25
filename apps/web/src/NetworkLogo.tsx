import type { WebNetworkKey } from "./networks";

/** Compact, code-native versions of the official network marks. */
export function NetworkLogo({ network, className = "" }: { network: WebNetworkKey; className?: string }) {
  if (network === "robinhood") return <svg className={className} viewBox="0 0 32 32" role="img" aria-label="Robinhood Chain"><rect width="32" height="32" rx="9" fill="#ccff00"/><path fill="#171b00" d="M8 27 12 12l8-7h7l-1 9-9 9 5-14h-3L8 27Zm2-15 5-6h3l-5 6H10Z"/></svg>;
  if (network === "xlayer") return <svg className={className} viewBox="0 0 32 32" role="img" aria-label="X Layer"><rect width="32" height="32" rx="9" fill="#050505"/><path fill="#fff" d="M7 7h7v7H7zm11 0h7v7h-7zM7 18h7v7H7zm11 0h7v7h-7zm-4-4h4v4h-4z"/></svg>;
  if (network === "base") return <svg className={className} viewBox="0 0 32 32" role="img" aria-label="Base"><circle cx="16" cy="16" r="16" fill="#0052FF"/><path fill="#fff" d="M16 7.2A8.8 8.8 0 0 0 7.47 13.8h13.05v4.4H7.47A8.8 8.8 0 1 0 16 7.2Z"/></svg>;
  if (network === "arbitrum") return <img className={className} src="https://arbitrum.io/brandkit/1225_Arbitrum_Logomark_FullColor_ClearSpace.png" alt="Arbitrum One" />;
  return <img className={className} src="https://cdn.prod.website-files.com/685311a976e7c248b5dfde95/68926aad995d4eae931403a4_arc-favicon-256x256.png" alt="Arc" />;
}
