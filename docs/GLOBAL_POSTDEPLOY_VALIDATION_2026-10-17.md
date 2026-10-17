# Global report deployment validation · 17 October 2026

The deployed API and web application passed the checks below for the implementation in `de66829`. This audit reused the four already purchased BTC reports and an earlier production X Layer Pro report. **Additional report purchases, model generations and wallet spending: zero.**

## Deployed application

- Railway `/healthz` and `/v1/meta?network=base` returned HTTP 200. Redis, report storage and live payment configuration were available; the configured Grok model was `grok-4.5`.
- The deployed Global and Telegram Mini App pages returned HTTP 200. Their built assets contain the new setup recheck, immutable-snapshot notice, order-review flow, Structure view and primary-attempt failure details.
- The authenticated setup-assessment route is deployed. An empty request returned its expected strict-validation HTTP 400 response.
- The three deployed risk/workflow guide images matched the committed files by SHA-256.

## Four reports, charts and Telegram views

The deployed frontend passed **20 browser cases**, including all four BTC timeframes at desktop width 1454 and mobile width 390, indicator/zoom checks, Telegram Mini App report views and the illustrated guide. No runtime exceptions or horizontal page overflow were recorded. The guide loaded all nine expected images.

The browser used the deployed JavaScript and CSS. The four actual paid report bodies were supplied through a local browser response fixture, because those reports were purchased through the local API. This verifies deployed rendering without publishing reports or purchasing replacements. Telegram host/library responses were also supplied locally; no Telegram messages were sent.

The deployed UI downloaded all **eight** requested artifacts: TXT and PNG for 1H, 4H, 1D and 1W. Each TXT was byte-for-byte identical to its previously audited export. All four downloaded PNGs were visually inspected. Desktop/mobile report and Telegram screenshots were also checked.

| Saved frame | Eligibility in that snapshot | Completed candles |
| --- | --- | ---: |
| 1H | NO TRADE: insufficient nearest-target reward | 520 |
| 4H | WAIT: subsequent retest required | 520 |
| 1D | NO TRADE: insufficient nearest-target reward | 520 |
| 1W | INVALIDATED: completed weekly structural breach | 470 of 520 requested |

These are the saved snapshots' results, not fresh market signals. The weekly `completed_partial` status remains explicit. The market calculations, target/stop audit and interpretation are documented in [the four-report local validation](GLOBAL_LOCAL_BTC_VALIDATION_2026-10-17.md).

## Production report access and recheck

The four local job IDs returned HTTP 404 from production; production recovery of those four jobs is therefore not claimed. To check the deployed authenticated path, the audit reopened one earlier production X Layer Pro report belonging to `TEST_WALLET_ADDRESS`, using its original merchant and recovery capability.

That report returned HTTP 200. Its canonical Global report exactly matched the originally saved report. The authenticated setup recheck also returned HTTP 200 with `pulse-global-assessment-v1`, a `no_trade` result and `Cache-Control: private, no-store`. No payment or model generation was required.

## Small correction found during the audit

The daily export described one historical failure twice: the primary-plan line named the candle's **closing time**, while the previous Spot-attempt line named the same candle by its **opening time**. Both referred to the same event, but the dates appeared to disagree.

The shared presentation now labels historical Spot failures and held retests by **bar closing time**, in English and Chinese. For the saved daily report, both failure lines now identify **2026-10-08 16:00 UTC**; the candle opened on October 7. This changes display wording and timestamps only. Saved candle evidence, eligibility, prices, targets and protection are preserved.

Validation of this follow-up correction:

- All 26 focused domain, report-delivery and Telegram tests passed, with no skips. Closing-time assertions cover hourly, four-hour, daily, weekly and calendar-month labels in both languages.
- All 32 offline Quick/Pro, English/Chinese replay cases passed. The web production build passed; existing dependency annotation and bundle-size warnings remain.
- The same four paid snapshots were exported again to separate local files. Their original report bodies remained unchanged. Telegram captions stayed within 1024 characters and overview messages within 3900 characters. The corrected daily PNG was visually inspected.

**The closing-time wording correction is a local follow-up patch and was not part of the deployment audited above.** It needs the next normal deployment to appear in production.

## Evidence

Private local artifacts remain in `.tmp/global-postdeploy-2026-10-17/`: `deployment-markers.json`, `recovery.json`, `production-rechecks.json`, `browser/validation.json`, screenshots, eight original UI downloads, `exports.json`, and `corrected-exports.json` with regenerated exports. The health responses are recorded in `.tmp/global-deployment-check.json`. Recovery capabilities and complete production deliveries remain in the ignored `private/` folder and are excluded from commits.
