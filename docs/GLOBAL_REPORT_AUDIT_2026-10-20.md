# Global report audit — 20 October 2026

The four supplied BTC report images exposed real target-selection and presentation defects. The correction keeps market bias separate from entry readiness, retains one conditional watch setup where evidence supports it, and never forces an entry at the current price.

## Findings and corrections

| Finding | Cause | Correction |
| --- | --- | --- |
| 1H showed LONG with no setup | The 120-bar strategy lookback removed older, still-unconsumed resistance. The selected direction then had no target map. | Retain older barriers that precede the horizon's objectives. If the local history has no objective, use the nearest evidenced older barrier as TP1; leave unsupported TP2/TP3 absent. In this replay, TP1 is 83,858.20. |
| 4H showed SIDEWAYS with an empty plan area | The central 20% of a range discarded both boundary watch plans. | Retain one boundary watch plan, using observed reaction evidence first and the nearer boundary to the latest completed entry-frame close otherwise. The assessment stays SIDEWAYS; proximity never confirms an entry. |
| 1D appeared to forecast a fall from approximately 82,625 to 80,400 followed by a rally | The renderer connected the last primary close to the planned entry and then to targets. It also failed to explain the entry's distance from the fresher 4H close. | Start the conditional route at the entry, label it “ONLY AFTER ENTRY,” and disclose the latest entry-frame close, distance, and required reaction. The 80,400–80,483.84 zone requires a revisit approximately 2.57% below the saved 4H close of 82,610.40. There is no evidence that this revisit must happen. Buying at the current price requires its own supported signal and risk geometry. |
| Report titles contained a hashtag and code | An internal artifact fingerprint was displayed as a customer label. | Remove the fingerprint from chart titles, captions, and report prose. Keep internal identity and download traceability. |
| Telegram captions could omit a missing setup's reason | The caption rendered only existing cards and ended with generic planned-price wording. | Include the completed-price reference, decision heading, and the reason when no card is available. |
| A stale range could hide a selected directional card | Card filtering checked whether any range was saved, instead of the selected strategy's regime. | Filter by the selected regime. |
| Older reports could miss the correction | The previous review endpoint and UI considered version 2 current. | Introduce version 3 and offer the existing free technical review to version 1/2 reports. Original purchased snapshots remain unchanged. |

The weekly LONG bias still has approximately 1.25R to TP1, below the existing 1.50R minimum before costs. It remains blocked. A farther target, tighter invented stop, or another confirming candle does not fix that geometry.

For the daily plan, buying at the saved 4H close of 82,610.40 with the same stop of 79,691.25 and TP1 of 84,361.60 would give only about **0.60R**, before costs. The planned **4.89R** applies to its lower conditional entry, not to buying near 82,625. The report now displays this comparison to explain why the existing setup cannot simply be moved to the current price.

## Evidence and limits

The offline fixture contains public OKX candle history. Each reconstruction uses the exact fetch cutoff printed on the corresponding screenshot. Primary closes match the images: 1H 82,770.10; 4H 82,610.40; 1D 81,943.80; 1W 82,109.30. The reconstructed 1H entry-study close also matches 82,725.40. The original purchased JSON payloads were not supplied; this is a deterministic public-candle replay, not a claim to reproduce their original artifact fingerprints.

Only completed candles at the saved cutoff enter the analysis. [OKX's official API documentation](https://www.okx.com/docs-v5/en/#rest-api-market-data-get-candlesticks-history) describes the candle history response and confirmation flag.

## Review artifacts

- [Corrected hourly chart](previews/global-oct20-audit/1h-pro-en.png)
- [Corrected four-hour chart](previews/global-oct20-audit/4h-pro-en.png)
- [Corrected daily chart](previews/global-oct20-audit/1d-pro-en.png)
- [Corrected weekly chart](previews/global-oct20-audit/1w-pro-en.png)
- [Full daily report](previews/global-oct20-audit/1d-pro-en.txt)
- [Sixteen-case validation and exact plan prices](previews/global-oct20-audit/validation.json)

Run `node scripts/audit-global-oct20-reports.mjs` after building schemas, domain, analysis, and API. It checks all four frames in Quick/Pro and EN/ZH, generates the four English Pro exports, enforces Telegram size limits, checks that no visible hash remains, and verifies one selected plan and WAIT status. It makes no model calls, payments, or Telegram sends.

Validation also covers the domain and analysis suites, web rendering suite, and focused API assessment/delivery tests. `scripts/audit-global-oct20-browser.mjs` checks the production web build across all sixteen report variants at desktop and mobile widths, with external requests blocked.

Final release checks: `npm test` completed with **943 passed, one skipped, and zero failures**; `npm run build` passed. The skipped case is the optional local Redis-compatible TCP/Lua integration test. All **16 export variants** and **32 desktop/mobile browser cases** passed, with no page runtime errors, attempted application mutations, model calls, payments, or Telegram sends. [Release validation](previews/global-oct20-audit/release-validation.json) and [browser results](previews/global-oct20-audit/browser-validation.json) retain the check details. The browser harness records canceled Fetch interceptions during page navigation separately from page failures.

## Manual deployment

The user requested a local commit and will deploy manually. Confirm the existing API is healthy, then deploy this revision to **Vercel web first**, followed by the same revision on the existing **Railway API**. The updated web schema accepts versions 1, 2 and 3; the old web build does not recognize version 3. After both deployments, confirm `/healthz` and reload open report tabs. Both services need the update: Railway generates report plans and Telegram exports; Vercel renders reports and offers the version-3 free review. This change requires no environment-variable or storage migration.

Open an older version-1/2 report and use **Review setup and targets · free** to reconstruct its correction from saved candles. Existing Telegram messages and attachments remain historical copies. The corrected chart guide is regenerated from public historical candles and included with the web assets.
