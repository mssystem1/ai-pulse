import { useEffect, useState } from "react";
import type { IndicatorManifest } from "@pulse/domain";
import { readCreatedIndicators } from "./terminalIndicatorLibraryState";
import type { IndicatorListing } from "./terminalIndicatorClient";

export function TerminalIndicatorLibrary({ wallet, publications, onEdit, onCreate, onUse }: { wallet?: string | null; publications: IndicatorListing[]; onEdit: (manifest: IndicatorManifest) => void; onCreate?: () => void; onUse: (id: string) => void }) {
  const [created, setCreated] = useState<IndicatorManifest[]>(() => readCreatedIndicators(localStorage, wallet));
  useEffect(() => { const update = () => setCreated(readCreatedIndicators(localStorage, wallet)); update(); window.addEventListener("pulse:indicator-saved", update); window.addEventListener("storage", update); return () => { window.removeEventListener("pulse:indicator-saved", update); window.removeEventListener("storage", update); }; }, [wallet]);
  return <section className="indicator-created-library" aria-label="Your created indicators"><div className="terminal-section-heading"><div><h3>Created by you</h3><p>Private creations and drafts saved on this device. Publishing and purchasing are separate actions.</p></div><button type="button" onClick={onCreate}>Create indicator</button></div>
    {created.length ? <div className="indicator-catalog-grid">{created.map(manifest => <article key={manifest.id} data-created-indicator={manifest.id}><span className="terminal-status">Saved creation / v{manifest.version}</span><h4>{manifest.title}</h4><p>Publisher: <b>{manifest.author}</b></p><p>{manifest.description}</p><button type="button" onClick={() => onEdit(manifest)}>Open in builder</button></article>)}</div> : <p>No creations saved on this device yet. Use Create indicator, then Save draft or Add &amp; view on chart.</p>}
    {publications.length > 0 && <><h3>Your published indicators</h3><div className="indicator-catalog-grid">{publications.map(item => <article key={item.id}><h4>{item.title} / v{item.version}</h4><p>Publisher: <b>{item.author}</b></p><small>Publishing wallet {item.publisher}</small><p>{item.offer ? `${item.offer.priceUsdc} USD / managed installation` : "Free installation"}</p><button type="button" onClick={() => onUse(item.id)}>Add published version to chart</button></article>)}</div></>}
  </section>;
}
