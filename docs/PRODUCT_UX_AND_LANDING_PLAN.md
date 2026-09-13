# PULSE: product UX audit and public/app split

Date: September 12, 2026. Implementation audit: September 13, 2026. Status: local implementation and verification complete; ready for owner review and manual rollout. The original requirements below remain the acceptance baseline, not a claim that deployment has happened. The owner confirmed the canonical app address, complete-platform positioning, four selectable themes, and inclusion of genuine mainnet developer/testing activity in platform totals. No domain, deployment, payment, trading or production-data changes are authorized by this document.

## 1. Recommendation

Give visitors a public product story at `https://www.ai-pulse.tech/`. The owner-confirmed application address is `https://app.ai-pulse.tech/portfolio`. Use Portfolio consistently in visible navigation and the canonical route, retaining `/overview` as a compatible redirect.

Position PULSE as the complete research-and-trading platform, not an Autopilot-only product. Spot and Autopilot are distinct, equally legitimate ways to trade.

The landing page explains the product and has a prominent **Launch app** link. It is not another trading interface: no wallet connection, RPC selector, order form, account journal or personal portfolio on the public page. Public aggregate statistics and a compact explanation of the product belong there; individual performance and controls belong inside the application.

Product distinctions are non-negotiable:

- Global Market: research, with an optional handoff into Spot.
- Spot: wallet-approved Market/Limit trading; a research report is optional. Do not call Spot autonomous.
- Autopilot: independent autonomous trading after owner-approved setup, with capital/risk rules and a prepaid AI Entry Pass. It does not require a Global report.
- Prediction Market: research on selected prediction questions, not a promise of prediction-market execution.
- Risk Guard: evidence-based token analysis, not an audit certificate or guaranteed safety score.

## 2. Reference review: principles to borrow

Both public sites were opened in a real browser at 1440px and 390px, including the sections below the hero. Screenshots are local audit evidence in `.codex-ui-review/reference-*`; they are not licensed PULSE marketing assets.

| Reference | Useful design pattern | PULSE adaptation |
| --- | --- | --- |
| [Aumo](https://aumo.finance/) | Concise hero, clearly visible Launch app links, distinct product-story sections, sparse borders, focused visual accents | Separate explanation from operation; use a strong primary CTA and readable section rhythm |
| [OpenLaunch](https://openlaunch.lol/) | Split hero with an explanatory illustration, nearby aggregate statistics, explicit controls for motion, distinct activity sections | Use an original product diagram and verified PULSE statistics; do not copy its launchpad lists into the landing page |

Neither reference is a template to copy wholesale. Aumo is a narrower treasury product; OpenLaunch mixes a public story with a live launchpad. PULSE has several workflows and needs a clearer boundary between marketing and its working app.

## 3. Audit scope and limits

Read-only live browser inspection covered Portfolio, Global, Prediction, Risk Guard, Spot, Autopilot, Telegram and Docs at desktop/mobile widths: 16 first-load page inspections. No horizontal document overflow or uncaught render exception was observed in those snapshots. That does not establish good usability or successful connected-wallet workflows. Some snapshots captured loading states before market requests finished; their page heights are approximate, not performance benchmarks.

Code review covered navigation, the app shell, Portfolio aggregation/report links, browser report recovery, deployment rewrites, wallet metadata, and the existing workflow documentation. Prior user screenshots inform connected-account issues. New signing, payment, paid report delivery, wallet connection and on-chain execution were not performed for this design audit. Those remain explicit acceptance tests before rollout.

## 4. Prioritized findings

| Priority | Evidence / issue | Planned correction |
| --- | --- | --- |
| P1 | `navigation.ts` generates `/overview` while App labels the tab Portfolio | Canonical `/portfolio`; preserve old route/query/deep links and update metadata, docs and Telegram links |
| P1 | Portfolio report-row `onClick` passes only a tab; it does not pass the clicked job ID | Open that exact saved report, with private authorization/recovery; never silently show a different report or ask for a new payment |
| P1 | Portfolio `refresh()` has no request identity/abort protection when wallet/network changes; late results can overwrite the new context | Key requests by wallet/network, cancel or reject stale results, test rapid switching and errors |
| P1 | Public root initializes the working app and wallet-provider bundle | Separate public entry from application entry; no wallet initialization or private API requests for landing visitors |
| P1 | Origin migration would strand browser-local recovery handles/settings and wallet sessions | Wallet-authenticated report history, explicit legacy recovery path, reconnect explanation and old-link preservation before moving the root |
| P2 | Autopilot repeats the path explanation, two hero cards and setup summary before account operations | One compact page heading. Existing users land on accounts/runtime; New Autopilot opens the setup workflow. Keep the meaningful final pre-sign review |
| P2 | Spot repeats its page title, explanatory hero and shortlist introduction | One page heading; pair/market context next, trade ticket beside/below it, orders/activity afterward. Shortlist remains available as a compact discovery drawer |
| P2 | Global starts with a path banner and shortlist before the selected-market workspace; mobile guidance is long | Selected pair, market/chart and research action form the main workspace. Preserve shortlist discovery but make it collapsible and clearly secondary |
| P2 | Portfolio mobile hero consumes much of the initial viewport; empty nested cards dominate disconnected state | Compact title, network scope and refresh; one concise disconnected explanation pointing to the existing header wallet control |
| P2 | App displays API offline for every health state other than ONLINE, including the initial pending state | Distinct Checking / Online / Unavailable states; show errors only after an actual failed check |
| P2 | App uses multiple nearly equivalent names: Base/Premium, Quick/Pro, signal/report | Agree on a single user-facing vocabulary, explain legacy/API aliases in Docs; never casually rename endpoint IDs or change prices |
| P2 | Docs mobile snapshot is approximately 24,500px tall; topic sections are all in one scroll | Search and topic navigation, one active topic/article, anchors for existing links; keep diagrams beside their relevant explanation |
| P2 | Informational sub-12px text is common; nested outlines give unrelated controls equal weight | Readable body typography, quieter borders, fewer boxed containers, stronger separation of titles/actions/metadata |
| P2 | Portfolio's Reports on this device reads up to 30 local handles per research scope, not lifetime completed report counts | Keep this scope truthful; add separate authenticated report library/counts before advertising lifetime totals |
| P2 | Portfolio Recent activity sends users to Spot even though rows may describe Autopilot actions | Route each activity to its own product/account/transaction context |
| P3 | Brand markup uses the main heading while page headings sit below it | Semantic page H1, logo link, skip-to-content, consistent keyboard/focus behavior |

The recently removed journal shortcut panel and unregistered-account setup accordions must stay removed. The journal area contains actual strategy journals and trading statistics, not duplicate navigation or onboarding.

## 5. Public landing page: proposed narrative and layout

Use six substantial sections plus a restrained footer, not a grid of every feature.

1. **Hero: what PULSE is.** Original headline proposal: **Read the market. Trade your way.** Supporting copy: “Research Global and Prediction Markets, assess token risk, and trade with your wallet—or launch Autopilot for autonomous trading within your chosen limits.” Primary action: **Launch app**. Secondary: **Explore PULSE** (page anchor, not another product page). Beside/below it: an original pulse graphic linking research, a wallet-approved order and an independent Autopilot account. No fabricated rising equity curve.
2. **PULSE in numbers.** At most three verified aggregates: completed reports, confirmed PULSE trading volume, and active Autopilots. Date range, supported mainnets, last update and methodology link. If coverage is not ready, omit that figure or disclose the covered period; do not fill it with invented numbers or market-wide OKX volume.
3. **Two ways to trade.** One large visual comparison: wallet-directed Spot versus autonomous Autopilot. Show short original product captures or a click-controlled animation. Global research is an optional input to Spot; do not draw it as a mandatory step before Autopilot.
4. **Research before commitment.** Present Global, Prediction and Risk Guard in one focused section, with a selected report illustration and short descriptions. Product links can open the relevant app route. No eight-service pricing-table wall in the main story.
5. **Your control, visible.** An annotated account illustration explains approved capital, risk limits, pause/withdrawal and confirmed execution records. Keep technical detail in Docs. Do not say funds are risk-free, or that simulation is live performance.
6. **Questions and final CTA.** Five concise questions: Spot versus Autopilot; whether a report is required; fees; supported networks; what happens when the pass expires. End with Launch app. Footer: Docs, Telegram, legal/risk information and genuine public links.

Desktop: 1120–1240px readable content width, spacious alternating visual/text sections, strong typography. Mobile: headline → description → CTA → illustration; each later section follows one topic vertically. Keep Launch app available in the compact header. Avoid carousel-only information and repeated sticky buttons covering content.

### Visual and motion direction

Owner-confirmed: both the landing page and application offer four selectable themes through Appearance, independent of network selection. Proposed names: **Pulse** (graphite with teal/cyan), **Clarity** (light with electric blue), **Midnight** (navy with ice blue), and **Horizon** (ocean with warm sand). The layout, content and functionality remain consistent in all four. All diagrams and charts must remain legible, with stable Buy/Sell colors and verified contrast.

Remember theme preferences between visits. Because the public and app hosts have separate browser storage, carry only the allowlisted, non-sensitive theme identifier across Launch app navigation; preserve each origin's preference otherwise. Never transfer wallet sessions or report capabilities as part of theme synchronization. Landing header: PULSE, Product, Docs, Appearance, Launch app; no network or wallet controls.

- Use a legible sans-serif for body/interface text, distinctive display typography only for major headlines, and tabular numerals for data. Reserve monospace for technical identifiers.
- Use original SVG/CSS diagrams for explainable concepts: sharp at mobile sizes, lightweight, accessible and easy to theme. Actual app captures must hide private data and be labeled if illustrative.
- Optional commissioned/generated bitmap hero artwork can support the identity, but it must not replace product clarity. No copied competitor artwork, logos suggesting partnerships, stock “AI robot” collage, or screenshots with fake profits.
- One ambient pulse animation and small interaction transitions are sufficient. Motion follows reduced-motion preferences and has a stop control where continuous. No sound, scroll hijacking or essential text in a moving ticker.
- A short product video is a later enhancement with a poster, captions and click-to-play. Do not make an autoplay video download a condition of seeing the page.

## 6. Application information architecture

| Page | Primary purpose and order |
| --- | --- |
| Portfolio | Compact scope/header → actionable exceptions → separate Spot/Autopilot performance → useful chart(s) → positions/runtime → recent activity → saved research |
| Global | Pair/timeframe → chart/context and research purchase → report → optional Spot handoff; shortlist accessible without replacing the workspace |
| Prediction | Selected live question → market context → report depth/payment → delivered report; secondary history below |
| Risk Guard | Network/token → free evidence → optional paid risk report → detailed sources/simulation, progressively disclosed |
| Spot | Pair and chart → Market/Limit ticket → review/sign → orders, fills and performance. Direct trading remains available without research |
| Autopilot | Accounts and runtime first for returning users; explicit New Autopilot/Finish setup workflow; journals and fills below account operations |
| Telegram | Connection/delivery status and direct app shortcuts; concise setup help only when needed |
| Docs | Search/topic navigation → selected article and relevant diagram; developer marketplace/integration material separate from beginner operation |

This is an intentional proposal to revise the previous banner/shortlist-first order. Consolidating those sections should preserve their useful controls and product distinctions, not delete functionality. Page context should explain the next decision in one line; longer education belongs in Docs or an expandable explanation.

Public users do not see wallet/network controls. In-app users retain one wallet control in the header, one network selector and an independent appearance selector. Mobile utilities may live in a clearly labeled menu, while wallet/network remain reachable; no second connect-wallet block in Portfolio.

## 7. Portfolio: graphics that answer real questions

Do not decorate Portfolio with a generic “How PULSE works” diagram or another action-card menu. Its visuals must describe this wallet's actual data.

Recommended chart priority:

1. **Performance over time**, with separate Spot and Autopilot series/views, period selection and clear currency/coverage. Add only after historical valuation and cash-flow data support it. Never draw a historical return curve from current PnL, interpolate across missing evidence, or count deposits as profit.
2. **Capital allocation**, preferably a clear horizontal breakdown by account/asset. Label the boundary (for example, registered PULSE Autopilots on Base), not “whole wallet” unless all wallet holdings are actually valued. Accessible values accompany the graphic.

If performance history is not ready, show a verified activity timeline/count chart instead of a made-up performance line. Avoid a collection of decorative donuts. Saved reports retain separate Global/Prediction counts; a compact proportion bar is optional, not a substitute for exact counts and report links.

Keep Spot and Autopilot PnL distinct. A combined percentage needs a defensible combined capital basis, not an average of percentages. Show unavailable/partial states honestly. Unregistered funded accounts are distinct from active registered strategies. No atomic token amounts on the interface.

## 8. Public statistics: backend prerequisites

The current Portfolio is wallet/network scoped and is not a public platform-statistics source. Operational `/metrics` is not a marketing volume API. Build a small aggregate projection, not expensive scans per landing visitor.

| Metric | Required definition |
| --- | --- |
| Completed reports | Unique successfully completed deliverables by service and time range across X Layer, Base, Arbitrum **and Arc Testnet**. Show separate Global Market, Prediction Market and Risk Guard counts and a chain breakdown identifying testnet analyses. Pending jobs, failed attempts and recovery reads are not extra reports. Risk Guard needs its own delivery evidence if counted |
| Confirmed trading volume | PULSE-origin confirmed Spot/Autopilot executions only; deduplicate chain + transaction + execution identity; count each swap once. Exclude approvals, deposits, withdrawals, payments and testnets. Historical currency conversion must be verified or reported by settlement asset |
| Active Autopilots | Registered strategies with verified current executable runtime; separate protecting positions from new-entry eligibility if shown. Created vaults and expired/paused accounts are not automatically active |

Each aggregate includes coverage start/end, as-of time, network scope and stale/partial status. Use cached snapshots with bounded background updates on the existing infrastructure; no new paid database is required by this plan. Do not scan wallets or invoke AI for every public page load. Exclude identifiable wallet histories, balances, report bodies and recovery tokens from the public response.

Owner-confirmed counting policy (updated): public statistics are platform-wide, never filtered by the application's selected RPC/network. Include genuine developer/testing activity under the same evidence and deduplication rules as other activity. **Analysis totals include Arc Testnet**, with separate Global, Prediction and Risk Guard counts and a chain breakdown. Clearly identify the Arc portion as testnet analyses. **Trading volume, execution counts and executable Autopilot statistics remain mainnet-only** across X Layer, Base and Arbitrum. Use visible disclosures: “Analyses across four networks, including Arc Testnet” and “Mainnet execution, including developer testing.” These are platform activity totals, not evidence of independent customer adoption. Do not label developer wallets as external customers or count synthetic/failed attempts. Report purchases count as completed reports when delivery is verified, not as trading volume. Paused/expired testing strategies do not count as active merely because they exist.

A public “all-time” label is allowed only when historical coverage is complete. Otherwise use “since [verified date]”. If early activity is small, present the real figures or emphasize capabilities; never use random counters or market-wide liquidity as PULSE traction.

### Arc mainnet transition

The owner expects Arc mainnet around September 16. Treat this as a rollout expectation, not an automatic activation date or a verified network configuration. Build the public projection around explicit chain identities and environment labels, not a fixed count of networks or the selected RPC. On mainnet readiness, verify the official chain ID, RPC, explorer, supported payment assets and deployed PULSE services before enabling the new network.

Retain Arc Testnet as a historical analysis bucket. Existing testnet reports remain included in platform-wide analysis totals and labeled as testnet; they must never be rewritten as mainnet activity. New Arc Mainnet reports belong to a separate bucket and contribute to the same analysis service totals. A report retrieved or migrated into new storage is not a new delivery. Activate Arc Mainnet execution statistics only if Spot/Autopilot execution is actually supported and verified there; a mainnet launch alone does not enable trading routes. Historical mainnet/testnet classification must come from each record's original chain identity, not today's network configuration.

Before cutover, test that adding an Arc Mainnet bucket preserves historical Arc Testnet counts, does not double-count migrated reports, and leaves totals independent of the app's selected RPC. The public page should derive available network labels from the verified snapshot rather than assume there will always be exactly four networks.

## 9. Domain and route migration: prevent lost access

Confirmed canonical mapping (implemented in `siteRouting.ts` and `navigation.ts`; external domain configuration is an owner deployment step):

| Address | Behavior |
| --- | --- |
| `www.ai-pulse.tech/` | Public landing |
| `app.ai-pulse.tech/portfolio` | Canonical app home |
| App `/` and `/overview` | Redirect to `/portfolio` |
| Existing public-host product paths | Carefully route to matching app paths, preserving supported context |
| Existing `/shared-report` links | Keep readable at the old origin; protect fragment capabilities and no-referrer behavior |
| Existing Railway API/service endpoints | Unchanged; this is not a marketplace endpoint migration |

Before the domain cutover:

- Add hostname-aware routing/entry separation in the same repo, with explicit localhost preview modes. Separate deployment projects are optional, not a prerequisite.
- Ensure the landing build/entry does not mount AppKit or fetch private account endpoints. Update canonical metadata, sitemap and social previews for the public and app contexts.
- Inventory `?service=...`, Telegram launch/delivery context, `#reports`, shared-report fragments and saved URLs. Resolve known legacy deep links before treating an old root visit as a new marketing visit. Do not propagate arbitrary tokens through external redirects or analytics.
- Browser localStorage is origin-scoped. Make authenticated wallet-owned history work on the new origin and provide a legacy recovery page for pending/device-only handles; do not erase the old storage or put recovery tokens in query strings. Explain that reconnecting a wallet is not a new payment.
- Verify API CORS, wallet connector allowed origins/metadata, Telegram Mini App URL and BotFather settings, share links, payment return paths and mobile browser behavior. Existing API service identities/prices stay unchanged.
- The owner configures DNS/domains and deploys manually after acceptance. Keep a rollback path that preserves reports and existing operational URLs. No automatic production edits.

## 10. Implementation sequence and acceptance gates

1. **Confirmed direction and route plan.** Use `app.ai-pulse.tech/portfolio`, complete-platform positioning, four selectable themes and disclosed genuine mainnet developer/testing activity. Headline and artwork remain design proposals for prototype review.
2. **Fix app usability first.** Correct Portfolio report navigation and stale-context handling; consolidate page intros; dashboard-first Autopilot; clear loading/status copy; route alias tests. Keep changes testable independently of a new landing page.
3. **Build landing and Portfolio prototypes locally.** Original hero/product diagrams, actual content, responsive layout and truthful empty/statistics states. Owner reviews desktop and mobile before domain cutover. Use existing verified data before adding historical performance graphs.
4. **Wire production-quality data and recovery.** Cached public aggregates, report library/deep links, new-origin recovery, configured URLs and deployment guide.
5. **Validate full workflows.** First use deterministic fixtures without money; then read-only deployed checks. Only separately authorized paid/on-chain tests may consume funds or alter strategies.

Acceptance matrix:

- Responsive widths 360/390/768/1440, keyboard-only use, visible focus, reduced motion and all four landing/app themes; no hidden critical action or page overflow. Theme switching does not change network, wallet or transaction context.
- New/disconnected user, existing funded registered user, unfinished funded account, paused/expired/exhausted pass, incomplete PnL, empty/partial history and slow/unavailable providers.
- Landing CTA opens Portfolio; old Overview/report/Telegram links still work; new-origin report recovery does not require repurchase.
- Global selected pair survives a Spot handoff; unavailable representation is explained before signing; selecting another pair/shortlist stays available.
- Prediction and Risk Guard reports never bleed into Global; free evidence, payment and delivery are distinct.
- Spot Market/Limit buy and sell, partial fills and rejected signatures preserve state and show correct units.
- Autopilot create versus finish existing, review, fund, purchase/renew, resume/pause and journal filtering remain account-specific. No renewed duplicate onboarding panels in journal/statistics areas.
- Two networks or wallets changed rapidly cannot display the previous context's data. Offline is not displayed while health is merely pending.
- Data projections deduplicate transactions/jobs, include genuine developer/testing activity with disclosure, and label incomplete coverage. Analysis totals include Arc Testnet; execution totals exclude testnets. Public totals never follow the selected RPC. Charts do not manufacture trades, valuations or historical profits.
- No wallet dependency in the public landing entry; media loads progressively; public metrics are cached. Measure performance rather than claiming a Lighthouse score before testing.

## 11. Confirmed decisions and next review

- Canonical app address: `https://app.ai-pulse.tech/portfolio`; old `/overview` links remain compatible.
- Positioning: the complete PULSE platform, clearly distinguishing wallet-approved Spot from autonomous Autopilot.
- Appearance: four selectable themes on both public landing and app, independent of network choice.
- Statistics: cross-chain platform totals with verified coverage, including genuine developer/testing activity. Global, Prediction and Risk Guard analysis counts include Arc Testnet with a chain breakdown; Spot/Autopilot executions and volume are mainnet-only. No duplicated or fabricated activity.
- Owner review: the localhost app-cleanup and landing/Portfolio implementation, including section consolidation, responsive layout, theme names and original artwork. Follow `PUBLIC_APP_ROLLOUT.md` after local acceptance; no deployment is performed by this work.

Public aggregate definitions, migration risks and implementation boundaries above remain binding. No public performance claims or domain changes should precede verification.

## 12. Implementation evidence and remaining release checks

The source of truth is the current worktree and executed checks, not this checklist alone. No real wallet signing, payment or trading has been performed for this redesign.

| Requirement | Local implementation / verification source |
| --- | --- |
| Full-platform public story; independent Spot/Autopilot; four appearances | `LandingPage.tsx`, `landing.css`, `AppearancePicker.tsx`; `landing-ui-check.mjs` checks each theme at 360/390/768/1440 |
| Public/app split and canonical Portfolio; safe legacy context | `siteRouting.ts`, `navigation.ts`, `siteMetadata.ts` and their unit tests; `/landing` preview, root cutover behind an environment flag |
| No wallet initialization on landing | Lazy app/provider and shared-report imports in `main.tsx`; landing browser request inspection and `landing-build-check.mjs` verify the local production entry without wallet/application/report bundles |
| Exact report recovery, no repurchase, stale-context protection | `SavedResearchDialog.tsx`, `ReportHistory.tsx`, `OverviewWorkspace.tsx`; `product-state-ui-check.mjs` checks the selected report, header-only capability, no POST, focus restoration and delayed old-account response |
| Compact app hierarchy and mobile topics | `App.tsx`, `V6Workspaces.tsx`, `portfolio.css`; full app-shell matrix checks eight routes, one H1, overflow, mobile keyboard navigation and Docs topic isolation |
| Returning Autopilot accounts first; existing versus new setup | `autopilot-ui-check.mjs` checks four account identities, unfinished/paused controls, correct recovery target, journals and local shortlist expansion |
| Global-to-Spot context and direct trading remain available | The same browser script mounts the full Spot workspace with a report intent, verifies pair/levels, then loads another shortlist pair and checks that stale report context is cleared without placing a trade |
| Evidence-based Portfolio graphics | Registered-account capital allocation in `OverviewWorkspace.tsx`; no invented historical performance curve; Spot and Autopilot remain separate |
| Public cross-chain analysis counts including Arc Testnet | `publicActivity.ts`, delivery hooks in `app.ts`, bounded optional backfill, API tests; public snapshot ignores caller network/wallet selectors |
| Confirmed mainnet executions and human-unit volume | `publicExecution.ts`, server-reconciled activity hook, proof/filter tests; token quantities remain exact in storage, no unsupported USD conversion |
| Deduplication, cache, privacy and unavailable coverage | Public projection tests, unpaid endpoint cache test, browser parser/unavailable-state checks; no public wallet histories or report capabilities |
| Local Redis command semantics | Optional loopback `publicActivityRedis.test.ts`: concurrent dedupe, exact large amounts and a cold reader. A fakeredis/Lua run verifies compatibility only, not native Redis disk persistence |
| README, in-app guides and owner rollout | Updated README vocabulary, topic-specific app guides and diagrams, `PUBLIC_APP_ROLLOUT.md` with API/domain/recovery/Telegram checks and rollback |

Release checks that require the owner's later deployment remain explicit: DNS/certificates, deployed CORS and wallet-provider allowlists, real Telegram launch/delivery, authenticated recovery with the owner's wallet, and any separately authorized live payment/on-chain checks. Local deterministic tests must not be described as successful production acceptance.

The executed local acceptance record and reproducible commands are in [PUBLIC_APP_ROLLOUT.md](PUBLIC_APP_ROLLOUT.md#local-acceptance-record--september-13-2026). The working previews are `/landing` and `/portfolio` on localhost. No commit, push, deployment, production-data backfill or funds movement was performed as part of this redesign.
