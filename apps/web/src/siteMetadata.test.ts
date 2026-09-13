import test from "node:test";
import assert from "node:assert/strict";
import { siteMetadata } from "./siteMetadata.js";
test("canonical metadata separates public and app contexts without exposing tokens",()=>{
  assert.equal(siteMetadata("http://localhost:5178/landing","landing").canonical,"https://www.ai-pulse.tech/");
  assert.deepEqual(siteMetadata("https://www.ai-pulse.tech/overview?token=private#secret","app"),{title:"Portfolio · PULSE",canonical:"https://app.ai-pulse.tech/portfolio",robots:"noindex,follow"});
  assert.equal(siteMetadata("https://www.ai-pulse.tech/shared-report#share=secret","shared").robots,"noindex,nofollow");
  assert.equal(siteMetadata("https://app.ai-pulse.tech/docs#docs-auto","app").canonical,"https://app.ai-pulse.tech/docs");
});
