import {candleTimeframeMs} from "@pulse/schemas";
import type {TerminalRadarDefinition,TerminalRadarState,TerminalPriceObservation,TerminalTapeoutComponent} from "@pulse/domain";
import {evaluateTerminalTapeoutNand} from "@pulse/market";

function validateDefinition(d:TerminalRadarDefinition){
  if(d.version!=="terminal-radar-v1"||!d.id||d.id.length>160||!/^[A-Z0-9]{2,20}-(USDT|USDC|USD)$/.test(d.instId)||!["sweep_reclaim","breakout_acceptance","breakout_failure"].includes(d.detector)||!["above","below"].includes(d.side)||!Number.isFinite(d.boundary)||d.boundary<=0||!Number.isFinite(d.tolerance)||d.tolerance<0||d.tolerance>=d.boundary*.1||!Number.isSafeInteger(d.createdAt)||!Number.isSafeInteger(d.expiresAt)||d.expiresAt<=d.createdAt||!candleTimeframeMs(d.timeframe))throw Error("Invalid Market Radar definition");
}
function next(d:TerminalRadarDefinition,stage:number){
  if(stage===0)return d.detector==="sweep_reclaim"?"Waiting for a new sweep beyond the boundary.":"Waiting for a completed close beyond the boundary.";
  if(stage===1)return d.detector==="breakout_acceptance"?"Waiting for a later retest that closes outside.":"Waiting for a later completed return inside.";
  return d.detector==="breakout_acceptance"?"Waiting for a later hold outside.":"Waiting for a later completed hold inside.";
}
export function newTerminalRadar(definition:TerminalRadarDefinition):TerminalRadarState{
  validateDefinition(definition);
  return {version:"terminal-radar-state-v1",definition:structuredClone(definition),status:"developing",stage:0,updatedAt:definition.createdAt,events:[{id:`${definition.id}:start`,at:definition.createdAt,kind:"started",reason:"Monitoring starts here; earlier touches are historical."}],next:next(definition,0),observations:[],historyComplete:true};
}

/** Real registered TAP-02 component drives every stage admission. Numeric
 * comparisons and private state stay off chain. One candle advances one stage;
 * repeated polls, duplicate observations and gaps cannot create confirmation. */
export function advanceTerminalRadar(definition:TerminalRadarDefinition,previous:TerminalRadarState|null,observations:readonly TerminalPriceObservation[],component:TerminalTapeoutComponent|null,asOf:number):TerminalRadarState{
  validateDefinition(definition);if(!Number.isSafeInteger(asOf)||asOf<definition.createdAt)throw Error("Radar observation precedes monitoring");
  if(previous&&JSON.stringify(previous.definition)!==JSON.stringify(definition))throw Error("Radar rule revisions require a new detector");
  const state=structuredClone(previous??newTerminalRadar(definition));
  if(asOf<state.updatedAt)return state;
  if(["completed","failed","expired"].includes(state.status))return {...state,updatedAt:asOf};
  const record=(kind:TerminalRadarState["events"][number]["kind"],reason:string,o?:TerminalPriceObservation)=>{
    const at=o?.at??(kind==="expired"?definition.expiresAt:asOf),id=`${definition.id}:${kind}:${o?.id??at}`;
    if(!state.events.some(e=>e.id===id))state.events.push({id,at,kind,reason,...(o?{observationId:o.id,price:o.close,source:o.source}:{})});
  };
  const expired=asOf>=definition.expiresAt;
  if(!component||component.chainId!==196||component.circuitId!=="2"||component.verified!==true){state.status=expired?"expired":"data_needed";state.next=expired?"This detector expired. Review a new detector to monitor again.":"The registered Tapeout component must be verified before Radar can evaluate.";if(expired||previous?.status!=="data_needed")record(expired?"expired":"data_needed",state.next);state.updatedAt=asOf;return state;}
  // Imported netlist is used for actual Boolean composition, not a decorative read.
  const nand=(a:boolean,b:boolean)=>evaluateTerminalTapeoutNand(component,a,b),not=(a:boolean)=>nand(a,a),and=(a:boolean,b:boolean)=>not(nand(a,b));
  if(nand(true,true)!==false||nand(false,true)!==true)throw Error("Radar component semantics changed");
  if(state.tapeout&&(state.tapeout.netlist!==component.netlist||state.tapeout.processor!==component.processor||state.tapeout.codeHash!==component.codeHash))throw Error("Radar component changed; review a new detector version");
  state.tapeout??=structuredClone(component);state.status="developing";
  const seen=new Set(state.events.flatMap(e=>e.observationId?[e.observationId]:[])),step=candleTimeframeMs(definition.timeframe),sign=definition.side==="above"?1:-1;
  const rows=[...observations].filter(o=>o.instId===definition.instId&&o.timeframe===definition.timeframe&&o.start>=definition.createdAt&&o.at<=asOf&&o.at<definition.expiresAt&&o.knownAt<=asOf).sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
  for(const o of rows){
    if(seen.has(o.id)||o.id===state.lastObservationId||o.at<=(state.lastObservationAt??-1))continue;
    const retained=state.observations??=[];
    if(!retained.some(row=>row.id===o.id))retained.push(structuredClone(o));
    if(retained.length>512){state.observations=retained.slice(-512);state.historyComplete=false;}
    if(!o.complete||![o.open,o.high,o.low,o.close].every(p=>Number.isFinite(p)&&p>0)||o.high<Math.max(o.open,o.close)||o.low>Math.min(o.open,o.close)||o.start>=o.at){state.status="data_needed";state.stage=0;state.next="Complete valid source observations are required.";record("data_needed",state.next,o);continue;}
    if(state.lastObservationAt!==undefined&&o.at-state.lastObservationAt>step+1){state.stage=0;record("data_needed","A source gap interrupted the sequence; previous stages cannot confirm it.",o);}
    const distance=sign*(o.close-definition.boundary),outside=distance>definition.tolerance,inside=distance< -definition.tolerance;
    const extreme=definition.side==="above"?o.high:o.low,opposite=definition.side==="above"?o.low:o.high;
    const swept=sign*(extreme-definition.boundary)>definition.tolerance,heldInside=and(inside,sign*(extreme-definition.boundary)<=definition.tolerance),retest=and(outside,sign*(opposite-definition.boundary)<=definition.tolerance);
    if(state.stage===0){
      if(and(o.complete,definition.detector==="sweep_reclaim"?swept:outside)){state.stage=1;record("first_stage",definition.detector==="sweep_reclaim"?"New sweep beyond the selected boundary.":"New completed close beyond the boundary.",o);}
    }else if(state.stage===1){
      if(and(o.complete,definition.detector==="breakout_acceptance"?retest:inside)){state.stage=2;record("second_stage",definition.detector==="breakout_acceptance"?"A later retest closed outside.":"A later completed candle returned inside.",o);}
      else if(and(definition.detector==="breakout_acceptance",inside)){state.status="failed";record("failed","The breakout returned inside before acceptance completed.",o);}
    }else if(state.stage===2){
      const holds=definition.detector==="breakout_acceptance"?outside:heldInside;
      if(and(o.complete,holds)){state.stage=3;state.status="completed";record("completed","The ordered price sequence completed. This is an observed event, not a trade or fill.",o);}
      else if(and(o.complete,definition.detector==="breakout_acceptance"?inside:outside)){state.status="failed";record("failed","The later observation contradicted the required hold.",o);}
    }
    state.lastObservationId=o.id;state.lastObservationAt=o.at;seen.add(o.id);
    if(state.status==="completed"||state.status==="failed")break;
  }
  if(expired&&!["completed","failed"].includes(state.status)){state.status="expired";record("expired","The detector expired without completing its ordered event.");}
  // Freeze an unresolved sequence during a temporary read outage. Only real
  // recovered contiguous bars may advance it; an actual event-time gap above
  // resets it. Discarding memory before backfill arrives would make replay
  // disagree with live evaluation despite a complete retained price history.
  if(state.status==="developing"&&asOf-(state.lastObservationAt??definition.createdAt)>step*2){state.status="data_needed";if(previous?.status!=="data_needed")record("data_needed","Recent completed observations are missing; continuity must be verified before this sequence can advance.");}
  state.updatedAt=asOf;state.next=state.status==="completed"?"Review this event with location, participation and risk before any trade.":state.status==="failed"?"This sequence failed; review a new detector if conditions change.":state.status==="expired"?"This detector expired. Review a new detector to monitor again.":state.status==="data_needed"?"Waiting for current complete source observations.":next(definition,state.stage);
  state.events=state.events.slice(-256);return state;
}

/** Replay actual retained observations with the original pinned circuit and
 * definition. A truncated history is explicitly rejected, never padded. */
export function replayTerminalRadar(saved:TerminalRadarState):TerminalRadarState{
  if(!saved.historyComplete||!saved.observations||!saved.tapeout)throw Error("Complete retained observations and the original circuit are required for replay");
  return advanceTerminalRadar(saved.definition,null,saved.observations,saved.tapeout,saved.updatedAt);
}
