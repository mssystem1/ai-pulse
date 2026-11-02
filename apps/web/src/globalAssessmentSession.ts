import type {GlobalReport} from "@pulse/domain";
import type {GlobalAssessmentAccess} from "./globalSetupClient";

const resolverIds=new WeakMap<Function,number>();
let nextResolverId=0;

/** Exact saved content and capability identity, rather than freshly parsed object references.
 * This private React key must never be rendered, logged, persisted or put in a URL.
 * An unscoped callback is conservatively treated as a different session when it changes.
 */
export function globalAssessmentSessionKey(report:GlobalReport,access?:GlobalAssessmentAccess):string{
  let owner:unknown=null;
  if(typeof access==="function"){
    if(access.assessmentScope)owner=["resolver",access.assessmentScope];
    else{let id=resolverIds.get(access);if(id===undefined){id=++nextResolverId;resolverIds.set(access,id);}owner=["unscoped-resolver",id];}
  }else if(access)owner=[access.kind,"id" in access?access.id:null,access.token];
  // Reports have already passed through readGlobalReport's canonical schema parsing.
  // Comparing the whole saved content also detects a free strategy/target review.
  return JSON.stringify([report,owner]);
}

/** A synchronous lock is needed before React can commit the disabled button. */
export function createGlobalAssessmentRequestGuard(){
  let mounted=true,pending=false,generation=0;
  const current=(id:number)=>mounted&&pending&&id===generation;
  return {
    mount(){mounted=true;},
    dispose(){mounted=false;pending=false;generation+=1;},
    begin():number|null{if(!mounted||pending)return null;pending=true;return ++generation;},
    current,
    finish(id:number):boolean{if(!current(id))return false;pending=false;return true;}
  };
}
