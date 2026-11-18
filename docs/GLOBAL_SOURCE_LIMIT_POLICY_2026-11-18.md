# Primary structure and passive-limit plans

This revision implements the user's choice: select one plan and show the opposing alternate. A limit plan can be prepared without an additional confirmation candle. It establishes neither a fill nor a forecast that price must return.

## Selection and prices

Each primary timeframe owns its structure, volatility and objectives. Daily uses daily structure with a 4H execution clock; weekly uses weekly structure with a daily execution clock. Lower-frame recovery evidence never becomes an invented completed primary candle.

The selector retains actual range escapes, local reclaims, supported observed events and range rotations. Before falling back to lagging EMAs, it checks neighboring primary support and resistance with pivot anchors known before the last completed primary candle. Direction follows primary assessment or completed reaction/location, before reward comparison. Payoff cannot choose direction or move a source.

For an unobserved structural retest, `structural-edge-passive-v3` uses the source's far edge: buy at support's lower edge or sell at resistance's upper edge. The full source remains recorded. This is one exact limit price, not permission to fill anywhere in the zone.

Protection is calculated from the original source and primary ATR before choosing that execution edge. The existing half-ATR source-price buffer / outer-boundary 0.2-ATR convention stays fixed. Selecting the edge does not tighten the stop to manufacture reward. An observed reclaim retains its own defended region and event policy.

TP1 remains the first active primary opposing pivot or zone edge. Up to two further distinct supported objectives become TP2 and TP3, in route order. Two edges of the same zone and overlapping target bands do not become duplicate exits. A plan with fewer independent objectives shows fewer targets. A level touched before a future pullback entry is not automatically a spent exit. Supported intervening obstacles, including execution-frame opposition, still limit displayed reward. Farther targets cannot clear a failed reward threshold.

The saved gross nearest-obstacle floor is 1R. It excludes venue-specific costs and establishes neither profitability nor strategy quality. Failed geometry is explained specifically; another confirmation candle cannot fix it.

## Alternate, clocks and cancellation

When the selected structural source has a supported opposite neighbor, the alternate gets its own exact limit, fixed stop, objective, source times and eligibility. The chart and Follow action track the selected plan. If one executes, reassess the other. No automatic OCO order or predicted two-leg price sequence is asserted.

The default entry window remains sixteen execution bars from publication: sixty-four hours for daily and sixteen days for weekly. Source failure, a breached hard stop or expiry ends the pre-entry opportunity. A pre-entry target touch does not cancel the new structural retest policy because the target is an exit after entry. Earlier saved policies keep their original cancellation rules.

Touches are price-path evidence only. Same-bar entry and stop/target remain ambiguous when OHLC cannot establish order. Refreshing cannot renew an existing scenario clock or rewrite its bound risk.

## Saved reports and public XO material

`setupPolicyVersion: source-limits-v3` distinguishes the multi-target revision. Earlier v2 reports remain readable with their saved policy. Free review upgrades them to a separate v3 artifact from saved candles without a model call. New structural plans use the `source-edge-v3` configuration identity so they cannot rewrite a bound v2 scenario. Reviewing a current artifact again is stable.

Trader XO's public discussion separates context/setup, trigger and order method, including resting limits and nearby value objectives. It does not specify a complete reproducible private strategy or verify these exact numeric conventions. See the primary [Trader XO podcast](https://zencastr.com/z/NsBYVQlb). The public [btc_charlie / Trader XO Macro Trend Scanner](https://www.tradingview.com/script/Q95qqFgC-btc-charlie-Trader-XO-Macro-Trend-Scanner/) supplies trend context rather than a complete entry/exit system.

Source-edge execution, ATR buffers, expiry and reward floor are PULSE research conventions. This correction revises causal software behavior and presentation. It does not establish verified XO settings or trading performance.
