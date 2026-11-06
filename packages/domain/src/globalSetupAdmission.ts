import type {GlobalReport} from "@pulse/schemas";
import {globalOpposingEntryZones,globalTargetReference} from "./globalPriceZones.js";

/** Geometry is a prerequisite for following an entry, not order authorization.
 * The saved price-zone policy uses 1R; the older technical policy uses 1.5R.
 * Never choose a more distant objective or move an entry to clear this gate. */
export function globalSetupAdmission(report:GlobalReport){
 const d=report.discretionaryPlan,p=report.tradePlan,sign=(d?.side??p?.side)==="short"?-1:1;
 const minimumRewardRisk=d?.priceZones?.payoffFloor??1.5,minimumPolicy=d?.priceZones?"saved-price-zones" as const:"legacy-technical" as const;
 const zone=d?.priceZones?.entry??(d?{lower:d.entry,upper:d.entry}:p?.referenceEntry?{lower:p.referenceEntry[0],upper:p.referenceEntry[1]}:null),stop=d?.stop??p?.referenceStop;
 const worst=zone?(sign===1?zone.upper:zone.lower):null,target=d?globalTargetReference(report,0):p?.targetIds.flatMap(id=>report.levels.find(level=>level.id===id)?.price??[])[0];
 const blockers:string[]=[],reasons:string[]=[],cutoff=Date.parse(report.snapshot.observedAt);
 const valid=worst!==null&&stop!==null&&stop!==undefined&&target!==null&&target!==undefined&&[worst,stop,target,zone!.lower,zone!.upper].every(Number.isFinite)&&zone!.lower<=zone!.upper&&sign*((sign===1?zone!.lower:zone!.upper)-stop)>0&&sign*(target-worst)>0;
 const risk=valid?sign*(worst!-stop!):null,targetRewardRisk=valid?sign*(target!-worst!)/risk!:null;
 let nearestObstacle:{price:number;timeframe:string}|null=valid?{price:target!,timeframe:d?.targets[0].timeframe??report.snapshot.timeframe}:null;
 const barriers=d?d.barriers:p?.entryObstacle?[p.entryObstacle]:[];
 const available=[...barriers.filter(b=>b.knownAt<=cutoff),...(d&&report.horizonContext?.timeframe===report.snapshot.timeframe?report.horizonContext.zones.filter(z=>z.knownAt<=cutoff&&z.role===(d.side==="long"?"resistance":"support")).flatMap(z=>[z.lower,z.upper].map(price=>({price,timeframe:report.snapshot.timeframe}))):[])];
 if(valid)for(const barrier of available)if(sign*(barrier.price-worst!)>0&&sign*(nearestObstacle!.price-barrier.price)>0)nearestObstacle={price:barrier.price,timeframe:barrier.timeframe};
 const overlap=d?globalOpposingEntryZones(report).length>0:false;
 const firstObstacleRewardRisk=valid?(overlap?0:sign*(nearestObstacle!.price-worst!)/risk!):null;
 if(!valid){blockers.push("geometry");reasons.push("The saved entry, hard stop and first objective do not form a supported risk/reward interval.");}
 if(valid&&firstObstacleRewardRisk!==null&&firstObstacleRewardRisk+1e-9<minimumRewardRisk){blockers.push("reward");reasons.push(`The nearest opposing level offers ${firstObstacleRewardRisk.toFixed(2)}R at the least favorable entry; this saved policy requires ${minimumRewardRisk.toFixed(2)}R. A farther target does not remove that obstacle.`);}
 if(overlap){blockers.push("opposing_zone_overlap");reasons.push("The entry area overlaps primary-timeframe opposition. A price retest alone does not remove that opposing zone.");}
 const quote=report.currentMarket?.quote;
 if(d&&valid&&quote&&[quote.price,quote.ts,cutoff].every(Number.isFinite)&&quote.ts<=cutoff+5000&&quote.ts>=cutoff-60000&&sign*(quote.price-target!)>=0){blockers.push("objective_already_reached");reasons.push("The current quote has already reached or passed this plan's first target area before a new entry. Do not promote a farther target to make the same opportunity look fresh.");}
 const ended=report.scenario&&["invalidated","expired","completed","entry_observed"].includes(report.scenario.state);
 if(ended){blockers.push("opportunity_ended");reasons.push("This opportunity has ended or its entry price was already observed. Its saved prices are for review, not a new entry.");}
 if(!d&&p?.blockers.some(b=>["history","levels","reward","cancelled","expired"].includes(b))){blockers.push(...p.blockers.filter(b=>["history","levels","reward","cancelled","expired"].includes(b)));reasons.push("The saved technical plan still has unresolved structure, reward or lifecycle requirements.");}
 const geometryEligible=valid&&!blockers.length;
 if(geometryEligible)reasons.push(`The saved geometry clears its ${minimumRewardRisk.toFixed(2)}R nearest-obstacle floor. Entry location, fresh evidence, context and execution review are still required.`);
 return{geometryEligible,allowed:geometryEligible,minimumRewardRisk,minimumPolicy,firstObstacleRewardRisk,targetRewardRisk,nearestObstacle,reasons,blockers:[...new Set(blockers)],state:geometryEligible?"waiting" as const:"blocked" as const};
}
export type GlobalSetupAdmission=ReturnType<typeof globalSetupAdmission>;
