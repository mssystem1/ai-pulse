# Terminal fixes and validation — 6 November 2026

The seven current user issues are addressed by the implementation and design work below. Changes are local until separately deployed. The [machine-readable validation record](TRADING_TERMINAL_VALIDATION_2026-11-06.json) preserves source dates, exact setup prices, admission outcomes, archive hashes and test scope.

| Issue | Result |
| --- | --- |
| Duplicate market choices | One Market dropdown for BTC, ETH, HYPE, SOL, DOGE, BNB, ZEC and OKB. Custom input opens only when requested. |
| Final candle differs from quote | A real exchange-supplied developing candle follows the same-market ticker. Its real volume refreshes independently. Completed history, confirmation studies and saved reports retain their original data. |
| Candle information hard to inspect | Highlighted UTC time, OHLC, volume and change on hover/tap, including the developing candle. Live updates retain manual time/price zoom. |
| Market tools/Radar guide lacks practical examples | Bilingual instructions and eight screenshots of actual components using the verified 1 November BTC session and a real three-stage historical Radar replay. |
| Telegram alerts unclear/repetitive | Frozen market/rule/stage/candle context, boundary, actual execution timeframe, next requirement, source close/retrieval clocks and exact subject link. Shared outages are grouped; recovery is explicit. Failed pattern does not mean a recorded trade loss. |
| Implausible large targets and opposing setups | Nearby opposing levels and overlapping zones now gate admission, including after confirmation. Quote-relative target filtering cannot promote a farther target to make the same opportunity look fresh. Original saved prices remain immutable. Blocked plans show WAIT and cannot be followed. |
| Stronger X Layer/Tapeout use | [Trading Rules design](TRADING_TERMINAL_TAPEOUT_NEXT.md): reusable market/position conditions compiled into executable rules, with private instances and optional X Layer publish/fork. This extension is proposed, not activated. |

## Real-data audit

The collector reconstructed the complete **1 November BTC Spot UTC session from 177,587 executions**. Exact weighted VWAP is **77,953.3661**, POC **78,005**, VAL **77,820**, VAH **78,220**. The dated order-book archive yielded **1,440 genuine one-minute observations**, retaining 50 levels per side. These historical examples are labelled with their own dates. Developing current sessions expose gaps and resumable collection status.

The updated five-frame public OKX audit ran at **05:56:43–44 UTC on 6 November**. The shared captured quote was **75,725.8 USDT**; each completed timeframe close retains its own timestamp. Geometry uses the existing saved price-zone minimum of **1R**; older technical plans retain **1.5R**.

| Frame | Conditional scenario | Nearest-obstacle reward | Result |
| --- | --- | ---: | --- |
| 15m | Short | 0.09R | Blocked |
| 1H | Short | 2.24R | Geometry passes; wait for entry and evidence |
| 4H | Short | 0.49R | Blocked despite 6.37R to the distant target |
| 1D | Range long | 0R; entry overlaps opposition | Blocked |
| 1W | Long | 0.16R | Blocked despite farther 87k/97k objectives |

Different horizons can support opposing conditional scenarios. Neither side becomes an admitted trade merely because a distant target is displayed. This audit does not recommend executing any of these candidates.

## Validation

- **1,308 automated tests passed** across API, web, analysis, market, domain and configuration. One optional Redis integration test was skipped because an isolated test instance was not configured.
- TypeScript builds passed for schemas, domain, config, market, analysis, API and web. The production Vite build passed, with its existing large application chunk warning.
- Actual browser checks covered five chart timeframes and themes, phone candle inspection, single market selection, navigation/zoom, owner access, exact deep links, stale request races, three-stage Radar, journal retries and notification preferences.
- Docs were checked across all 22 topics, five themes and desktop/tablet/phone widths. Real guide images loaded at their full natural sizes.
- Captured-data workflow checks verified prominent WAIT and disabled Follow on the four blocked frames, plus the conditional 1H result.
- Notification tests used captured transport only. They verified exact event-time content, three Radars grouped into one outage incident, recovery, opt-out/cancelled delivery handling and suppression of uncertain resends.

No new wallet payment, exchange order or real Telegram message was sent during this validation. Existing approved payment acceptance records remain separate. Local validation does not activate production features or establish trading performance or hackathon acceptance.
