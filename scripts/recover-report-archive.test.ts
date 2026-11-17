import test from 'node:test';
import assert from 'node:assert/strict';
import {modeFor} from './recover-report-archive.js';
test('classifies historical research formats without confusing execution audits with reports',()=>{
 assert.equal(modeFor({service:'spot_analysis_standard'}),'spot');
 assert.equal(modeFor({service:'prediction_analysis_premium'}),'prediction');
 assert.equal(modeFor({service:'fused_analysis_premium'}),'risk');
 assert.equal(modeFor({service:'preflight'}),'risk');
 assert.equal(modeFor({kind:'execution_lifecycle',status:'filled'}),null);
 assert.equal(modeFor({service:'unrecognized'}),null);
});
