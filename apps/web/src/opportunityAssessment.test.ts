import { test } from "node:test";
import assert from "node:assert/strict";
import { currentOpportunityAssessment, isConfirmedSpotSetup, readOpportunityAssessments, rememberOpportunityAssessment } from "./opportunityAssessment";
test("only fresh bullish reports above 60% qualify; technical score cannot qualify a neutral report", () => {
  const generatedAt = new Date().toISOString();
  for (const [bias, confidence, expected] of [["neutral",40,false],["bullish",60,false],["bullish",61,true],["bearish",85,false]] as const) {
    const item = { pair:"BTC-USDT", timeframe:"1H", bias, confidence, recommended:true, generatedAt };
    assert.equal(isConfirmedSpotSetup(currentOpportunityAssessment([item],"BTC-USDT","1H")),expected);
    assert.equal(currentOpportunityAssessment([item],"BTC-USDT","4H"),undefined);
    assert.equal(currentOpportunityAssessment([item],"BTC-USDT","1H",Date.parse(generatedAt)+900001),undefined);
  }
});
test("assessments stay scoped to network and timeframe", () => {
  const values = new Map<string,string>(); const storage={getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>{values.set(key,value);}};
  rememberOpportunityAssessment(storage,"xlayer",{instId:"BTC-USDT",timeframe:"1H",generatedAt:new Date().toISOString(),analysis:{bias:"neutral",confidence:40},executionPlan:{recommendation:{action:"wait"}}});
  assert.equal(readOpportunityAssessments(storage,"base").length,0);
  assert.equal(isConfirmedSpotSetup(readOpportunityAssessments(storage,"xlayer")[0]),false);
});
