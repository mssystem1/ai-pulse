import test from "node:test";
import assert from "node:assert/strict";
import {globalAssessmentEntryDeadline} from "./globalAssessmentDeadline";

test("a confirmed 5m return window ends before the longer overall setup expiry",()=>{
  const retestDeadline=Date.parse("2026-11-02T02:10:00Z"),expiresAt=Date.parse("2026-11-02T03:09:31Z");
  const deadline=globalAssessmentEntryDeadline({retestDeadline,expiresAt});
  assert.equal(deadline,retestDeadline);
  assert.equal(Date.parse("2026-11-02T02:10:09Z")<deadline!,false,"a report delivered after the confirmed window cannot keep quote review active");
});

test("an earlier setup expiry cannot be extended by confirmation or a missing deadline",()=>{
  assert.equal(globalAssessmentEntryDeadline({expiresAt:100,retestDeadline:120}),100);
  assert.equal(globalAssessmentEntryDeadline({expiresAt:100,retestDeadline:null}),100);
  assert.equal(globalAssessmentEntryDeadline({expiresAt:null,retestDeadline:120}),120);
  assert.equal(globalAssessmentEntryDeadline({expiresAt:null,retestDeadline:null}),null);
});
