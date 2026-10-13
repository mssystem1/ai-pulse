/* Planning fixture only. Prices come from the supplied SOL screenshot;
 * candles, wave anchors, indicators and 4H context are synthetic.
 * This is independent of production generation and makes no API calls. */
(() => {
  const snapshot = {
    instrument: 'SOL-USDT', venue: 'Binance', currency: 'USDT', timeframe: '1H',
    observedAt: '08 Oct 2026 08:00 UTC', lastPrice: 115.75, synthetic: true,
    wave: { label: 'Candidate A–B–C correction', active: 'C?', confirmed: false },
    levels: {
      reclaim: 117.30, target1: 120.56, target2: 124.80, floor: 113.12,
      deeper: 109.93, up1: 128.00, up2: 132.74, stress: 95.24,
    },
    paths: [
      { id: 'correction', label: '① Main · correction', state: 'candidate', targetIds: ['floor', 'deeper'], invalidationLevelId: 'reclaim' },
      { id: 'bounce', label: '② Alternative · recovery', state: 'conditional', triggerLevelId: 'reclaim', targetIds: ['target1', 'target2'], invalidationLevelId: 'floor' },
      { id: 'recount', label: '③ Pro alternative · new impulse', state: 'conditional', triggerLevelId: 'target2', targetIds: ['up1', 'up2'], invalidationLevelId: 'target2', pro: true },
    ],
    setup: {
      id: 'spot-reclaim', pathId: 'bounce', state: 'watching',
      triggerLevelId: 'reclaim', retestLevelId: 'reclaim', invalidationLevelId: 'floor',
      entry: null, stop: null, targetIds: ['target1', 'target2'], rewardRisk: null,
    },
    indicators: { sma21: 117.46, sma55: 119.75, sma144: 120.40, rsi14: 26.98, atr14: 1.05, volumePrior20: 1.18, fourHourSma55: 119.60 },
  };
  const price = id => snapshot.levels[id].toFixed(2);
  const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const notice = 'DESIGN ONLY · Historical screenshot levels; synthetic market evidence. Not a live report.';
  const setup = () => [
    'Spot plan · WATCHING · linked to amber path ②',
    `S1: 1H close above ${price(snapshot.setup.triggerLevelId)}, then a retest that closes at or above it. Keep ${price(snapshot.setup.invalidationLevelId)} intact.`,
    `S2 / target 1: ${price(snapshot.setup.targetIds[0])} · S3 / target 2: ${price(snapshot.setup.targetIds[1])}.`,
    'Entry / protective stop / R:R: pending the observed retest.',
    `Cancel: 1H close below ${price('floor')}; or back below ${price('reclaim')} after reclaim.`,
  ];
  const moves = tier => [
    `① Main · C? correction: while below ${price('reclaim')}, watch ${price('floor')} → ${price('deeper')}. Confirmed reclaim and held retest of ${price('reclaim')} cancels this local continuation view.`,
    `② Recovery: 1H close above ${price('reclaim')} + held retest, with ${price('floor')} intact → ${price('target1')} → ${price('target2')}.`,
    ...(tier === 'pro' ? [
      `③ New impulse: close and held retest above ${price('target2')} → ${price('up1')} → ${price('up2')}. Lose ${price('target2')} after confirmation: cancel this branch and reassess.`,
      `Stress branch: ${price('stress')} is relevant only after confirmed failure of ${price('deeper')}. It is not a Spot target.`,
    ] : []),
  ];
  const evidence = () => [
    `Trend conflict: 1H price is below SMA21 ${snapshot.indicators.sma21.toFixed(2)}, SMA55 ${snapshot.indicators.sma55.toFixed(2)} and SMA144 ${snapshot.indicators.sma144.toFixed(2)}; 4H is below SMA55 ${snapshot.indicators.fourHourSma55.toFixed(2)}. Recovery needs confirmation.`,
    `Momentum: RSI14 ${snapshot.indicators.rsi14.toFixed(2)}; volume ${snapshot.indicators.volumePrior20.toFixed(2)}× the prior 20-bar mean. Oversold alone does not confirm an entry.`,
    `Risk: ATR14 ${snapshot.indicators.atr14.toFixed(2)}. Price the stop from the actual retest, then check net reward to the nearest target after costs.`,
  ];
  function blocks(tier) {
    return [
      { title: `PULSE · Global ${tier === 'pro' ? 'Pro' : 'Quick'}`, lines: [
        `${snapshot.instrument} · ${snapshot.timeframe} · ${snapshot.venue} · ${snapshot.currency}`,
        snapshot.observedAt,
      ] },
      { title: 'WAIT · correction below the recovery threshold', lines: [
        `Snapshot price ${snapshot.lastPrice.toFixed(2)}. ${snapshot.wave.label}; last C? remains provisional.`,
      ] },
      { title: 'Possible moves', lines: moves(tier) },
      { title: setup()[0], lines: setup().slice(1) },
      ...(tier === 'pro' ? [{ title: 'Pro evidence · illustrated measurements', lines: evidence() }] : []),
      { title: 'Snapshot', lines: [notice, 'Saved snapshot · recheck current conditions before acting.', 'Research only · not financial advice.'] },
    ];
  }
  function message(tier) {
    return blocks(tier).map(b => `<b>${escape(b.title)}</b>\n${b.lines.map(escape).join('\n')}`).join('\n\n');
  }
  function messageText(tier) {
    return blocks(tier).map(b => `${b.title}\n${b.lines.join('\n')}`).join('\n\n');
  }
  function caption(tier) {
    return [
      `PULSE · Global ${tier === 'pro' ? 'Pro' : 'Quick'} · ${snapshot.instrument} · ${snapshot.timeframe}`,
      `${snapshot.venue} · ${snapshot.currency} · ${snapshot.observedAt}`,
      'Action: WAIT · Spot plan: WATCHING',
      `S1 ${price('reclaim')} reclaim + held retest → S2 ${price('target1')} → S3 ${price('target2')}.`,
      `Cancel: 1H close below ${price('floor')}; or below S1 after reclaim. Entry / stop / R:R pending.`,
      tier === 'pro' ? 'Pro: SMA family · regression · RSI14 · ATR14 · 4H context.' : 'Quick: candles · Elliott · SMA55 · volume · two paths.',
      notice,
    ].join('\n');
  }
  function fullText(tier) {
    return [
      messageText(tier), '',
      'HOW TO READ THIS CHART',
      'Observed anchors carry 1–5 / A–B labels. C? is an unconfirmed candidate. Projection arrows are conditional routes; their spacing does not forecast arrival time.',
      'The main downside view and the amber Spot alternative are different branches. The Spot plan activates only on its stated confirmation and retest.',
      '', 'SETUP CHECKS',
      `The ${price('floor')} floor is thesis invalidation, not the protective stop. The stop belongs below the observed retest low with a measured buffer.`,
      'A retest that has not formed provides no priced entry, stop or R:R. If the observed entry offers insufficient net reward to target 1, keep WAIT.',
      ...(tier === 'pro' ? [
        '', 'PRO CHART AND CONTEXT',
        'Default layers: SMA21/55/144, 120-bar regression channel ±2 residual sigma, RSI14, ATR14 and a 4H inset. Optional layers in the full report: all five SMAs (21/55/89/144/233), selected-anchor Fibonacci, anchored VWAP and confirmed pivots.',
        'The example 50% retracement of 101.00 → 125.20 is 113.10, near the 113.12 floor. Both observations share price-structure evidence; they are not independent confirmations.',
        '4H context conflicts with recovery. Reassess that context at confirmation. The >124.80 branch needs a fresh wave count and new setup geometry; do not reuse the recovery plan’s entry or stop.',
      ] : []),
      '', 'LIMITATIONS',
      'All market evidence in this preview is synthetic. The levels are historical screenshot references. No actual order-book data or live confirmation is claimed. Indicator defaults are proposed PULSE settings, not Vilarso’s private script.',
    ].join('\n');
  }
  globalThis.TelegramGlobalDesign = { snapshot, price, blocks, message, messageText, caption, fullText };
})();
