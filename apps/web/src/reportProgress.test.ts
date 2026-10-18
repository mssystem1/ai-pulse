import test from "node:test";
import assert from "node:assert/strict";
import {reportProgressModel,reportStageLabel} from "./reportProgress";

test("progress uses persisted creation and latest claim times across recovery",()=>{
  const at=Date.UTC(2026,9,18,13,47),job={id:"saved",stage:"generating_analysis",startedAt:at+300000,createdAt:new Date(at).toISOString(),events:[{stage:"fetching_context",at:new Date(at).toISOString(),detail:"claimed by durable worker"},{stage:"fetching_context",at:new Date(at+300000).toISOString(),detail:"claimed by durable worker"},{stage:"generating_analysis",at:new Date(at+301000).toISOString()}]};
  assert.deepEqual(reportProgressModel(job,at+305000),{active:3,elapsed:305,inStage:4,slow:false,resuming:true});
  assert.equal(reportProgressModel(job,at+362000).slow,true);
});
test("completed jobs display report loading and all server stages have readable labels",()=>{
  assert.equal(reportStageLabel("opening_report"),"Opening your report");
  for(const stage of ["fetching_context","calculating_features","generating_analysis","enriching_report","validating_report","saving_report","completed_partial"])assert.ok(!reportStageLabel(stage).includes("_"));
  assert.equal(reportProgressModel({id:"job",stage:"opening_report",startedAt:1000},2000).active,6);
});
