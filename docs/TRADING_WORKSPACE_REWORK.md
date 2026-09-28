# Trading workspace fixes — September 28, 2026

This update addresses the deployed Global, Spot and Autopilot screenshots.

## Global Market

- The compact reference chart is always visible. Expanding it opens the chart viewer.
- Pair and timeframe changes automatically load market data. The redundant load button is removed.
- The timeframe menu renders in a body portal with viewport bounds and scrolling, so following cards cannot cover higher timeframes.
- Mapped assets sort before research-only assets in both discovery and pair selection.

## Market availability

The production Arbitrum catalog returned 99 mapped pairs during investigation. The discovery scanner previously checked only 12 fixed global pairs, leaving BTC and ETH after network filtering. It now builds a network-aware universe from the execution token catalog and live OKX instruments, with room for crypto and tokenized stocks.

The scan is bounded to 24 mapped instruments plus the existing research pairs, cached for five minutes, and shared per network, custody mode and timeframe. It uses candles and deterministic rules; no new AI screening, token spend or subscription is introduced. The complete catalog remains available through pair selection. A mapping is not a liquidity guarantee: execution still requires a fresh route and wallet approval. This does not invent representations for unsupported assets.

## Navigation and Autopilot

- Autopilot has Create new, Edit, Dashboard and On-chain activity views.
- Spot has Trade setup and Dashboard views.
- Edit loads the selected account's actual on-chain limits, preserving exact atomic amounts. Selecting a market while editing keeps the selected account.
- An unchanged edit is disabled. Saving rechecks chain state and skips unchanged policy, exposure and risk-limit transactions. Existing funds and a valid pass are reused.
- A seven-stage progress panel stays visible throughout setup. Vault creation alone does not report completion. Completion waits for the restart receipt; subsequent refresh failures preserve the confirmed execution outcome.
- Changing an invested target asset is blocked until the existing position is closed or withdrawn. A newly created vault must be discovered as a new account; an unrelated last-listed vault is never used as fallback.

## Validation

- API tests: 249 passed, one skipped; web tests: 100 passed.
- Browser regression checks at 390, 768, 1440 and 1920 pixels cover Global chart visibility, automatic data loading, unclipped 1W selection, mapped ordering, navigation and existing report/manual-trade flows.
- Account/discovery checks cover mobile and desktop navigation, edit hydration, unfinished setup, account selection and horizontal overflow.
- Mocked wallet tests at 390 and 1440 pixels change only slippage: exactly the limits transaction and restart transaction are requested, with no repeated funding, asset configuration, policy update or pass payment. Dashboard completion waits for the simulated restart receipt.

No real wallet transaction or paid service call was made. These are local changes; deploy both API and web together because editing uses the new read-only configuration endpoint.
