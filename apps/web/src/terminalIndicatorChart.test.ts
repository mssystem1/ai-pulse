import { test } from "node:test";
import assert from "node:assert/strict";
import { terminalIndicatorSeries } from "./terminalIndicatorChart";
test("chart indicators retain execution timestamps and break gaps on their own scalar series", () => {
  const series = terminalIndicatorSeries({id:"test",title:"Flow",units:"BTC",status:"partial",source:"captured",windowStart:1000,windowEnd:10000,bucketMs:1000,points:[{ts:1000,value:2},{ts:2000,value:3},{ts:6000,value:7},{ts:7000}]});
  assert.deepEqual(series,[{time:1,value:2},{time:2,value:3},{time:3},{time:6,value:7},{time:7}]);
});
