import { useState } from "react";
import { terminalRequest, terminalUtc } from "./terminalClient";
import type { IndicatorListing } from "./terminalIndicatorClient";
import { WEB_NETWORKS } from "./networks";

export function IndicatorRegistration({ registration }: { registration?: IndicatorListing["registration"] }) {
  return registration ? <div className="indicator-registration"><b>Verified on X Layer</b><small>Processor {registration.processor} / circuit {registration.circuitId}</small>{registration.observedAt&&<small>Verified {terminalUtc(registration.observedAt)}{registration.blockNumber ? ` / block ${registration.blockNumber}` : ""}. Verification describes that recorded chain state.</small>}{registration.transactionHash&&<a href={`${WEB_NETWORKS.xlayer.explorer}/tx/${registration.transactionHash}`} target="_blank" rel="noopener noreferrer">View registration transaction ↗</a>}</div> : <p className="terminal-hint">Local circuit available. No verified X Layer registration attached.</p>;
}

export function TerminalIndicatorListing({item,token,active,busy,paymentLabel,onUse,onExport,onDelete,onVerified,onError}:{item:IndicatorListing;token:string;active:boolean;busy:boolean;paymentLabel?:string;onUse:()=>void;onExport:()=>void;onDelete:()=>void;onVerified:(item:IndicatorListing)=>void;onError:(message:string)=>void}){
  const [draft,setDraft]=useState({processor:"",circuitId:"",transactionHash:""}),[checking,setChecking]=useState(false);
  async function verify(){
    if(checking)return;setChecking(true);
    try{const result=await terminalRequest<{item:IndicatorListing}>(`indicators/${item.id}/registration`,{token,method:"POST",body:{processor:draft.processor,circuitId:draft.circuitId,...(draft.transactionHash?{transactionHash:draft.transactionHash}:{})}});onVerified(result.item);}
    catch(error){onError(error instanceof Error?error.message:"Deployment verification failed");}
    finally{setChecking(false);}
  }
  const paid=Boolean(item.offer&&!item.entitled&&!item.canDelete);
  return <article data-indicator-listing={item.id}><span className="terminal-status">Community / v{item.version}</span><h4>{item.title}</h4><p>{item.description}</p><small>{item.author} / publishing wallet {item.publisher}</small>
    {item.offer&&<p><b>{item.offer.priceUsdc} {paymentLabel ?? "USD in a supported stablecoin"}</b> / {item.offer.description}</p>}
    <IndicatorRegistration registration={item.registration}/>
    <div className="terminal-actions"><button type="button" disabled={!active||busy||(paid&&!paymentLabel)} onClick={onUse}>{paid?paymentLabel?`Review ${item.offer!.priceUsdc} ${paymentLabel}`:"Select a payment network":"Add to chart"}</button><button type="button" disabled={!active||busy} onClick={onExport}>Export public package</button>{item.canDelete&&<button type="button" disabled={busy} onClick={onDelete}>Unpublish</button>}</div>
    {item.canDelete&&<details><summary>Attach verified X Layer deployment</summary><p>Deploy this exact exported netlist through Tapeout first. PULSE independently checks the processor, circuit bytes and numeric test vectors; entering an address alone does not prove registration.</p><div className="terminal-form-grid">{(["processor","circuitId","transactionHash"] as const).map(key=><label key={key}>{key==="processor"?"Processor address":key==="circuitId"?"Circuit ID":"Fabrication transaction (optional)"}<input value={draft[key]} onChange={event=>setDraft(current=>({...current,[key]:event.target.value}))}/></label>)}</div><button type="button" disabled={busy||checking||!draft.processor||!draft.circuitId} onClick={()=>void verify()}>{checking?"Checking X Layer...":"Verify & attach deployment"}</button></details>}
  </article>;
}
