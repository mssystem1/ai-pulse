import test from 'node:test';
import assert from 'node:assert/strict';
import { reportTierLabel } from './reportLabels.js';
test('legacy report tiers use Quick/Pro presentation without changing API identities',()=>{
  for(const tier of ['standard','base','quick'])assert.equal(reportTierLabel(tier),'Quick');
  for(const tier of ['premium','pro'])assert.equal(reportTierLabel(tier),'Pro');
  assert.equal(reportTierLabel(null),'Report');
});
