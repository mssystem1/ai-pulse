# Global report execution and presentation validation

The report audit led to corrections in source-zone entry logic, persistent scenario tracking and the distinction between a recorded price event and an entry that remains available. Existing strategy families remain available alongside complementary methods. This change does not replace the historical rules of a purchased report.

## Corrections

- Entry retains its actual source region. The planner no longer moves it deeper into a region merely to improve reward/risk. Structural protection and nearer opposition remain visible.
- Passive limits and confirmed retests have separate saved policies. A passive plan cannot borrow later confirmation; a completed complementary event retains its genuine source and event time.
- Scenario identity, priced revision and deadlines persist across reports and free owner rechecks. Targets before entry, invalidation, expired return windows and duplicate entry observations prevent a fresh entry authorization.
- The effective Entry deadline is the earlier confirmed-return deadline or overall setup expiry. Cards, text, PNG and fresh order review use that distinction. An older concurrent recheck cannot authorize entry after newer scenario observations arrive.
- The methods section distinguishes primary assessment, retained core method, selected setup, price-event evidence and participation coverage. PNG now includes a concise version of this evidence.
- App documentation and README explain controls, saved versus current conditions, policy differences, download actions and evidence limitations. Public documentation excludes confidential settings and private report payloads.

## Validation scope

The historical review covered 91 wallet-owned production reports in the authorized 20-day archive, plus the supplied exports. Their saved originals were preserved. Compatibility and technical-review success do not mean that every historical entry instruction was correct or that every setup traded profitably.

Five BTC Pro reports were purchased through the updated local API using the authorized Base test wallet: 15m, 1H, 4H, 1D UTC and 1W UTC. Each payment was 0.30 USDC, for **1.50 USDC total**, with on-chain transfers verified. These used live market/model providers and isolated private persistence. Nothing was deployed and no trading orders were placed.

The fresh audit exposed two additional defects, both corrected before the local release commit: a completed 4H sweep/reclaim was not being mapped to its own lifecycle confirmation, and a fast report displayed the longer setup expiry instead of its earlier confirmed-return deadline. The purchased originals remained unchanged; corrected observations and presentation checks were recorded separately.

Ten subsequent free live rechecks passed. They preserved each saved side, source, risk prices, identity and clock. They rejected the expired fast opportunity and retained the observed swing reclaim while blocking entry for opposing higher-timeframe context and an out-of-range quote. A conditional priced plan is not a statement that immediate entry is justified.

| Check | Result |
| --- | --- |
| Analysis tests | 367 passed |
| Domain tests | 60 passed |
| Global API tests | 54 passed |
| Web tests | 210 passed |
| Historical owned originals | 91 compatible; originals unchanged |
| Paid Base deliveries | 5 recovered and payment-verified |
| Free live setup rechecks | 10 passed; no further payment |
| Report browser matrix | 40 combinations across five horizons, languages, appearances and screen sizes |
| Download/save/error browser checks | 90 cases |
| App guide browser checks | 8 cases |
| Fresh PNG presentation checks | 10 dark/Clarity exports; original payloads and prices unchanged |

Schema, domain, analysis, API and web builds are part of release validation. Browser save/share checks simulate mobile browser capabilities; physical iOS/Android device acceptance is separate. Long PNGs respect the image pixel budget rather than promising the maximum width for every report.

## Remaining evidence limits

The weekly provider returned 460 of 520 requested candles; the coverage limit remains disclosed. Several fresh plans have less than 1R to a nearer obstacle. Those limitations remain visible rather than being hidden by moving stops or skipping objectives.

Licensed MMT feeds are not connected by this change. Complementary profile/participation methods require genuine complete, timely source data; unavailable feeds cannot provide confirmation. Price touches are not verified exchange fills or realized PnL. This validation establishes software behavior within the tested scope and does not establish a win rate or guaranteed profitability.

Deployment remains an operator action. See the [chart guide](GLOBAL_REPORT_CHART_GUIDE.md) for product use.
