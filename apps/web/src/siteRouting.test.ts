import test from "node:test";
import assert from "node:assert/strict";
import { applicationLink, siteSurface } from "./siteRouting.js";
import { readAppearance } from "./appearancePreference.js";
test("landing rollout preserves legacy app, report and Telegram links", () => {
  assert.equal(siteSurface("https://www.ai-pulse.tech/"), "app");
  assert.equal(siteSurface("https://www.ai-pulse.tech/",true), "landing");
  assert.equal(siteSurface("http://localhost:5178/landing"), "landing");
  for(const path of ["/overview","/portfolio","/global","/?service=reports","/?telegramDelivery=private","/#reports"]) assert.equal(siteSurface(`https://www.ai-pulse.tech${path}`,true), "app");
  assert.equal(siteSurface("https://app.ai-pulse.tech/",true), "app");
  assert.equal(siteSurface("https://www.ai-pulse.tech/shared-report#share=private",true), "shared");
});
test("Launch app shares only the allowlisted theme, not the source URL's secrets", () => {
  const link=applicationLink("https://www.ai-pulse.tech/?token=secret#private","/portfolio","base");
  assert.equal(link,"https://app.ai-pulse.tech/portfolio?pulseTheme=base");
  assert.equal(applicationLink("http://localhost:5178/landing","/spot","xlayer"),"http://localhost:5178/spot?pulseTheme=xlayer");
  assert.throws(()=>applicationLink("https://www.ai-pulse.tech/","//evil.test","base"));
  assert.throws(()=>applicationLink("https://www.ai-pulse.tech/","/portfolio","base","javascript:alert(1)"));
});
test("appearance preference is network-independent and tolerates unavailable storage", () => {
  assert.equal(readAppearance({getItem:()=>"base"}),"base");
  assert.equal(readAppearance({getItem:()=>"base"},"https://app.ai-pulse.tech/?pulseTheme=arbitrum"),"arbitrum");
  assert.equal(readAppearance({getItem:()=>{throw new Error("blocked");}}),"xlayer");
  assert.equal(readAppearance(undefined,"https://app.ai-pulse.tech/?pulseTheme=garbage"),"xlayer");
});
