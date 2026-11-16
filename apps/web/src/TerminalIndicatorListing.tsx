import { terminalUtc } from "./terminalClient";
import type { IndicatorListing } from "./terminalIndicatorClient";
import { WEB_NETWORKS } from "./networks";

export function IndicatorRegistration({ registration }: { registration?: IndicatorListing["registration"] }) {
  return registration ? <details className="indicator-registration"><summary>Portable calculation core</summary><p>This numerical core is also registered on X Layer. It identifies the exact calculation, not the publisher's performance, exchange inputs or rolling history. Using it needs no transaction.</p><small>Processor {registration.processor} / circuit {registration.circuitId}</small>{registration.observedAt && <small>Checked {terminalUtc(registration.observedAt)}{registration.blockNumber ? ` / block ${registration.blockNumber}` : ""}.</small>}{registration.transactionHash && <a href={`${WEB_NETWORKS.xlayer.explorer}/tx/${registration.transactionHash}`} target="_blank" rel="noopener noreferrer">Calculation registration details</a>}</details> : <p className="terminal-hint">Ready to add to your chart. No separate registration is required.</p>;
}

export function TerminalIndicatorListing({ item, active, busy, paymentLabel, onUse, onExport, onDelete, onOpenCreator }: { item: IndicatorListing; active: boolean; busy: boolean; paymentLabel?: string; onUse: () => void; onExport: () => void; onDelete: () => void; onOpenCreator?: () => void }) {
  const paid = Boolean(item.offer && !item.entitled && !item.canDelete);
  return <article data-indicator-listing={item.id}><span className="terminal-status">Community / v{item.version}</span><h4>{item.title}</h4><p>Publisher: <b>{item.author}</b></p><small>Publishing wallet {item.publisher}</small><p>{item.description}</p>
    <p><b>{item.offer ? `${item.offer.priceUsdc} ${paymentLabel ?? "USD / supported stablecoin"}` : "Free installation"}</b></p>{item.offer && <p>{item.offer.description}</p>}
    {paid && <p className="terminal-hint">Review the exact token, network, publisher and immutable version before your wallet asks for approval. The purchase installs this version and keeps a restorable receipt in My indicators.</p>}
    {item.entitled && item.offer && !item.canDelete && <span className="terminal-status positive">Purchased / restore without paying again</span>}
    <IndicatorRegistration registration={item.registration} />
    <div className="terminal-actions"><button type="button" className="terminal-primary" disabled={!active || busy || (paid && !paymentLabel)} onClick={onUse}>{paid ? paymentLabel ? `Review purchase / ${item.offer!.priceUsdc} ${paymentLabel}` : "Select a payment network" : item.entitled && item.offer && !item.canDelete ? "Restore to chart" : "Add to chart"}</button>{item.canDelete && <button type="button" disabled={busy} onClick={onDelete}>Unpublish</button>}</div>
    <details><summary>Portability &amp; creator details</summary><p>File export is optional. To attach a compatible registered core while creating an indicator, use the calculation-reference picker on Create indicator.</p><button type="button" disabled={!active || busy} onClick={onExport}>Export public package</button>{item.canDelete && <button type="button" onClick={onOpenCreator}>Open Create indicator</button>}</details>
  </article>;
}
