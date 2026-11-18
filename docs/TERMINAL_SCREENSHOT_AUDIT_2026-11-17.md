# Trading Terminal corrective audit — verified locally 18 November 2026

The earlier completion claim was premature. The user's deployed screenshots reproduced empty indicator panes, duplicate navigation in Ask PULSE and a displaced Studio preview. This audit supersedes that claim. These results describe the corrected local implementation; production deployment has not been verified.

| Issue | Correction and acceptance evidence | Result |
|---|---|---|
| 1. BTC daily/weekly | Primary structural sources precede distant EMA fallback. Exact source-edge passive limits retain fixed protection and exit at the first active primary obstacle. One selected plan and an independently priced opposing alternate are shown. No extra confirmation candle for passive limits. Saved-candle replay, schema mutation, lifecycle and browser alternate-card checks pass. | Passed locally; trading performance is not established. |
| 2. Timeframe loading/empty indicators | History loads independently of Market tools. Flow keeps its execution clock; price studies keep candle time. Loading retained history resets the minute-wide capture viewport. Eight actual studies render multiple values on 1H, daily and weekly, including rolling-20 and SMA-20. Injected history failure retains the captured sample with a coverage notice. | Passed locally. |
| 3. Maxim application | Created an AI RSI draft, explicitly applied it, saved it and added it with eight occupied slots. The exact new package/version shows publisher Maxim and 513 actual plotted candle readings. The oldest active study is hidden; all nine saved packages remain. | Passed locally. |
| 4. Tapeout/templates | Visible execution/portability/identity information sits above each editor workspace. Badges distinguish NAND, hybrid and host calculations. The right preview remains a preview. All nine Studio and nine Simple templates produce previews. | Passed locally. |
| 5. Ask PULSE | Removed its navigation grid. One sidebar remains. Titles, descriptions, prompts and requests differ for Terminal, tools, Radar, creation, market, library, positions and activity. The launcher stays highlighted. | Passed locally across eight contexts. |
| 6. Modes/copilot | Highlighted Indicators Studio and Simple Indicators. Copilot returns a reviewable graph with explicit application. Browser verification uses a stub, without a paid provider call. | Workflow passed locally; production provider availability unverified. |
| 7. My indicators | My creations and Purchased indicators have separate highlighted headings, jump links and accented borders. The new Maxim creation is retained. Restore receipts remain separate from chart slots. | Local collection and API receipt checks pass. No purchase was made. |
| 8. Clarity layout | Right preview restored; preview works before publisher identity. Readable graph text, no nested preview scrolling, normal-flow action row. Nine Studio previews have no internal vertical overflow; 390px viewport has no document horizontal overflow. | Passed locally; screenshots inspected. |
| 9. Publishing | Main-area Publish indicator form/button in both builders, without a Publish settings tab or disclosure. Both buttons submit the correct Maxim manifest to the local POST stub. | Passed locally; no external listing was published. |

## BTC findings

The distant daily EMA pullback was treated as the available setup while closer primary structure existed. Separately, the objective search discarded previously touched active levels and reached farther into historical targets. These rules explain the scenario involving a return to roughly 70k before a larger decline. A conditional scenario did not establish that the return would happen, and its entry location was poor for the requested workflow.

See [the revised source-limit policy](GLOBAL_SOURCE_LIMIT_POLICY_2026-11-18.md). On the **saved 17 November snapshot**, deterministic replay gives:

| Horizon | Selected sell limit | Fixed hard SL | First exit area | Opposing buy limit | Alternate hard SL |
|---|---:|---:|---:|---:|---:|
| Daily | 67,300.00 | 67,832.88 | 64,049.00–64,706.30 | 64,049.00 | 63,374.10 |
| Weekly | 66,955.00 | 68,769.64 | 65,000.00 | 56,555.00 | 55,209.98 |

These are replay results, not current orders or a current price prediction. The weekly opposing support is broader and farther away, not an imminent-move forecast. Each horizon retains its own sources, protection, objectives and execution clock.

Passive limits can be prepared without another confirmation candle and may remain unfilled. Specific invalidation, hard-stop and expiry rules remain visible. Internal compatibility codes do not add a generic WAIT requirement to a ready passive limit. `setupPolicyVersion` enables a free technical review of earlier v8 reports from their saved candles, preserving the original.

## Verification record

- Full analysis regression: 348 checks passed; the subsequently added old-v8 free-review regression also passed.
- Domain regression: 78 checks passed.
- Terminal/API/scenario/assessment regression: 163 checks passed.
- Frontend report, chart, history, Ask, Studio portability and client checks: 75 passed.
- API TypeScript check and final frontend production build passed.
- Browser: no uncaught exceptions; correct plotted series/visible ranges, nine templates per builder, exact new indicator identity, publish payloads, eight Ask contexts, library highlights and mobile overflow checks.

Local evidence is in `../.tmp/terminal-nine-qa/`: `corrective-flow-1D.png`, `corrective-flow-1W.png`, `corrective-studio-preview.png`, `corrective-studio-eighth-slot.png`, `corrective-alternate-1D.png`, `corrective-alternate-1W.png`, `corrective-ask.png`, `corrective-library.png`, `corrective-mobile.png` and `corrective-browser-results.json`.

Fixtures contain captured public prices and retained execution coverage. Missing intervals stay unknown. Empty execution buckets are zero quantity only when a verified continuous capture proves that no trades were omitted; they are not observed price prints. Browser account, publication and AI endpoints are local stubs: no payment, venue order, external publication or paid model call occurred.

Flow-only history reads return compact series and retain only those flow additions with the pinned tools, avoiding another copy of monthly footprint price rows in Redis. The authenticated route regression checks that separation.

Both API and frontend must receive these changes before production acceptance can be claimed. Live provider operation and the deployed wallet workflow remain the final verification boundary.
