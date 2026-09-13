import test from "node:test";
import assert from "node:assert/strict";
import {parseExecutionCapability} from "./executionCapability.js";
test("malformed or wrong-network capabilities fail closed instead of crashing the workspace",()=>{
  const valid={network:"base",spot:{visible:true,enabled:true,limit:false},autopilot:{visible:true,enabled:false}};
  assert.equal(parseExecutionCapability(valid,"base"),valid);
  for(const value of [{},null,{...valid,spot:undefined},{...valid,spot:{visible:true,enabled:"false"}},{...valid,network:"xlayer"},{...valid,contracts:{spotFactory:"malformed"}}])assert.equal(parseExecutionCapability(value,"base"),null);
});
