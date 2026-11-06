import type { Lang } from "./i18n";
import { TerminalPassPrices } from "./TerminalProductInfo";
import { TerminalSessionGuideExample, TerminalLiquidityGuideExample, TerminalRadarGuideExample } from "./TradingTerminalGuideExamples";

export function TradingTerminalGuide({ lang = "en" }: { lang?: Lang }) {
  const tr = (en: string, zh: string) => lang === "zh" ? zh : en;
  return <div className="docs-copy terminal-guide" data-no-localize>
    <span className="eyebrow">PULSE TRADING TERMINAL</span>
    <h3>{tr("Read the market. Follow your levels. Track your positions.", "读懂市场，跟踪价位，管理持仓记录。")}</h3>
    <p>{tr("Open Trading Terminal immediately after Portfolio. Choose a market and timeframe, inspect the chart, then watch a level, follow a setup or record a trade you already made. Terminal is separate from Global reports and Autopilot.", "在 Portfolio 后打开 Trading Terminal。选择市场和周期，查看图表，再监控价位、跟踪计划或记录已执行交易。终端独立于 Global 报告和 Autopilot。")}</p>
    <p>{tr("Use the Market dropdown to select BTC, ETH, HYPE, SOL, DOGE, BNB, Zcash (ZEC), OKB or another exact Spot pair. The current ticker is shared across chart timeframes and has its own source timestamp. A completed weekly or daily candle keeps its historical close; that close is not the current price.", "在 Market 下拉列表中选择 BTC、ETH、HYPE、SOL、DOGE、BNB、Zcash（ZEC）、OKB 或其他准确现货交易对。当前报价在图表周期之间共享，并显示独立来源时间。已完成周线或日线保留历史收盘价；该收盘价并非当前价格。")}</p>
    <p>{tr("The final LIVE candle is still forming. Its price and volume update from the source; it stays separate from completed-candle analysis and saved reports. Hover over a candle, or tap on a phone, to read its UTC opening time, open, high, low, close and volume. Zoom and pan remain until you choose Reset view.", "最后一根 LIVE K 线仍在形成中，价格与成交量随数据源更新，并与已完成 K 线分析及已保存报告分开。悬停 K 线或在手机上点击，可查看 UTC 开始时间、开高低收与成交量。缩放和平移会保持，直到选择 Reset view。")}</p>
    <div className="terminal-guide-diagram">
      <div><strong>{tr("1. Read the market", "1. 查看市场")}</strong><p>{tr("Compare price with traded value, buy/sell flow and nearby liquidity. Start with the question each tool helps answer.", "对比价格、成交价值区、主动买卖和附近流动性，先看每个工具能帮助回答什么问题。")}</p></div>
      <div><strong>{tr("2. Follow a level or setup", "2. 跟踪价位或计划")}</strong><p>{tr("Radar watches your chosen price event. Follow setup monitors one reviewed plan. Both explain what must happen next.", "Radar 监控所选价格事件，Follow setup 跟踪已审阅计划，两者都说明下一步条件。")}</p></div>
      <div><strong>{tr("3. Track an actual position", "3. 记录实际持仓")}</strong><p>{tr("Record an executed trade in My positions, add stop and target levels, then choose your Telegram alerts.", "在 My positions 记录实际成交，添加止损和目标，再选择 Telegram 提醒。")}</p></div>
    </div>
    <h4>{tr("Start here", "开始使用")}</h4>
    <ol>
      <li>{tr("Connect your wallet and sign the login message to open its private workspace. Signing in does not buy access or place a trade.", "连接钱包并签署登录消息以打开私人工作区。登录不会购买权限或下单。")}</li>
      <li>{tr("Review the current pass price and duration, then purchase your pass. Choose the asset and primary timeframe in Market.", "查看当前通行证价格和时长，再购买通行证。在 Market 选择资产和主要周期。")}</li>
      <li>{tr("Check the latest quote time and each tool’s covered window. Primary, execution and context timeframes have separate roles; recent order flow has its own shorter window.", "检查最新报价时间及工具覆盖窗口。主要、入场和背景周期各有作用，近期订单流使用独立的较短窗口。")}</li>
    </ol>
    <TerminalPassPrices lang={lang}/>
    <p>{tr("Terminal and Portfolio show the remaining days, hours, minutes and seconds. The timer uses the recorded expiry, continues after reopening and includes stacked renewals. There is no automatic renewal. Paid monitoring stops when access ends; your journal remains, and exchange positions and orders do not change.", "终端和 Portfolio 显示剩余天、时、分、秒。计时器使用记录到期时间，重新打开后继续，并包含叠加续期。不会自动续费。到期后付费监控停止，交易记录保留；交易所持仓和订单不会改变。")}</p>
    <h4>{tr("How Market tools help a trading decision", "市场工具如何帮助判断")}</h4>
    <p>{tr("Start with a question about the move on the chart. Measurements add evidence; one number or coloured bar does not choose a trade for you.", "先针对图表走势提出问题。测量提供证据，单个数值或彩色柱不会替你决定交易。")}</p>
    <table className="terminal-guide-tools"><thead><tr><th>{tr("Tool", "工具")}</th><th>{tr("Use it to ask", "需要回答的问题")}</th><th>{tr("What to compare", "如何对比")}</th></tr></thead><tbody>
      <tr><td>{tr("Value & levels", "价值区与价位")}</td><td>{tr("Where did trading concentrate?", "成交集中在哪里？")}</td><td>{tr("Price versus VWAP, point of control and value-area boundaries. Review a return to or rejection of a level. Recent-trade value is separate from the chart’s longer anchored VWAP.", "对比价格、VWAP、成交量控制点和价值区边界，观察回归或拒绝。近期成交价值区不同于长期锚定 VWAP。")}</td></tr>
      <tr><td>{tr("Buy/sell flow", "主动买卖")}</td><td>{tr("Do executions support this move?", "主动成交是否支持走势？")}</td><td>{tr("Aligned price and cumulative delta over the same buckets. Keep Spot and Futures units separate. Strong buying with little price progress deserves inspection; it does not prove absorption by itself.", "对齐同一时间分组的价格与累计 delta，分别查看现货和期货单位。强买入但价格进展有限值得观察，但本身不能证明吸收。")}</td></tr>
      <tr><td>Footprint</td><td>{tr("What traded during this level test?", "测试价位时发生了什么成交？")}</td><td>{tr("Select a candle and inspect buy/sell volume at its price rows. Compare the response with the executions actually covered.", "选择 K 线，查看各价格行的主动买卖量，将价格反应与实际覆盖成交对比。")}</td></tr>
      <tr><td>{tr("Open interest & funding", "持仓量与资金费率")}</td><td>{tr("What is happening in derivatives?", "衍生品发生了什么？")}</td><td>{tr("Current contract open interest, timestamp and funding. Open interest alone cannot identify longs or shorts; one reading does not establish a change over time.", "查看当前持仓量、时间和资金费率。持仓量本身不能区分多空，单次读数不能说明历史变化。")}</td></tr>
      <tr><td>{tr("Order book & liquidity history", "盘口与流动性历史")}</td><td>{tr("What displayed orders persisted or changed near price?", "附近显示挂单如何保持或变化？")}</td><td>{tr("Read current bid/offer size and spread in Order book. Use Liquidity over time for genuine retained snapshots, source timestamps and visible gaps. Resting size is separate from executed volume and liquidation prices.", "在 Order book 查看当前买卖盘数量与价差，在 Liquidity over time 查看真实保留快照、来源时间与可见缺口。挂单量不同于已成交量或清算价位。")}</td></tr>
    </tbody></table>
    <TerminalSessionGuideExample lang={lang}/>
    <TerminalLiquidityGuideExample lang={lang}/>
    <details><summary>{tr("What does incomplete or partial coverage mean?", "未完成或部分覆盖是什么意思？")}</summary><p>{tr("Read the requested range and covered intervals, not only the status badge. A complete session uses verified retained executions across the whole requested window. Backfill in progress or a recent partial sample covers less; its profile, footprint and delta describe only those executions. Missing intervals stay unknown. Collecting more history may update the tool measurements, while the saved report and its original setup remain unchanged.", "查看请求区间与已覆盖区间，而非只看状态标签。完整时段使用整个请求窗口内已验证保留成交。回填中或近期部分样本覆盖较少，其分布、Footprint 和 delta 仅描述这些成交。缺失区间保持未知。收集更多历史可更新工具测量，但已保存报告及原始计划不变。")}</p></details>
    <h4>{tr("Use Radar to watch a price level", "用 Radar 监控价位")}</h4>
    <p>{tr("Example: price is below resistance and you want to see a break above followed by a hold. Select the level and breakout acceptance, review the observation timeframe and next candle time, then start Radar. You can leave the chart and inspect or receive the event later.", "例如，价格处于阻力下方，你想观察突破并站稳。选择价位和突破接受模式，检查观察周期及下一根 K 线时间，再启动 Radar。之后可离开图表，稍后查看或接收事件。")}</p>
    <ol>
      <li>{tr("Choose a level and an event: reclaim, breakout acceptance or failed breakout. Level actions in Market tools open a review before monitoring starts.", "选择价位和事件：收复、突破接受或突破失败。工具中的价位操作先打开审阅，再启动监控。")}</li>
      <li>{tr("Choose an observation timeframe. A daily detector waits for completed daily candles. A faster detector is a separate choice from the chart’s primary timeframe.", "选择观察周期。日线检测需等待日线收盘。更快的检测周期独立于图表主要周期。")}</li>
      <li>{tr("Read the last event, next required event and expiry. Developing means the sequence is incomplete. Completed means the price event occurred: reassess the trade; it is not an entry fill or a profit guarantee.", "查看最近事件、下一事件和到期时间。Developing 表示序列未完成，Completed 表示价格事件发生，提示重新评估交易；不代表入场成交或盈利保证。")}</li>
    </ol>
    <TerminalRadarGuideExample lang={lang}/>
    <details><summary>{tr("How Tapeout is used", "Tapeout 如何参与")}</summary><p>{tr("Radar loads verified Tapeout logic from X Layer and applies it to ordered candle events locally. It shows each stage and the next required candle, so one wick or repeated polling cannot complete a multi-step event. Verification details identify the registered component; individual Radar events are not on-chain transactions, and the chain does not verify market prices. Prices and executions come from the stated sources.", "Radar 从 X Layer 加载已验证的 Tapeout 逻辑，在本地处理有序 K 线事件，显示各阶段和下一根所需 K 线。单次影线或重复轮询不能完成多步事件。验证详情标明注册组件；单个事件不是链上交易，区块链也不验证市场价格。价格和成交来自标明的数据源。")}</p></details>
    <h4>{tr("Follow a setup’s original rules", "跟踪计划原始规则")}</h4>
    <p>{tr("Review direction evidence, Entry range, fixed hard stop, targets, entry conditions and expiry. Follow this setup saves that exact version and explains the next condition. A data issue pauses progression until missing observations can be verified. Refreshing cannot revive an expired, invalidated or completed plan.", "审阅方向依据、入场区间、固定止损、目标、入场条件和到期时间。Follow this setup 保存确切版本并说明下一条件。数据问题会暂停进度直至缺失观察得到验证。刷新不能恢复已到期、失效或完成的计划。")}</p>
    <h4>{tr("Record a trade in My positions", "在 My positions 记录交易")}</h4>
    <ol>
      <li>{tr("Choose the market, Spot or Futures, and direction. Enter the price you actually received.", "选择市场、现货或期货及方向，填写实际成交价格。")}</li>
      <li>{tr("Enter size as position value in USDT or coin amount. Futures also supports margin and leverage. The form shows the corresponding coin quantity before saving.", "使用 USDT 仓位价值或币数量填写规模。期货还支持保证金和杠杆。保存前显示对应币数量。")}</li>
      <li>{tr("Optionally add a stop and individual targets. Just now is the default opening time; extra details let you change the actual time or exchange.", "可选填止损和逐个目标。默认开仓时间为刚刚，额外详情可修改实际时间或交易所。")}</li>
    </ol>
    <p>{tr("These are manual records. Saving does not place orders or verify a fill. Record an actual close or reduction separately; a target touch alone does not close the journal position.", "这些是手动记录。保存不会下单或验证成交。实际平仓或减仓后请另行记录，触及目标不会关闭记录持仓。")}</p>
    <h4>{tr("Receive Telegram notifications in the bot", "在机器人接收 Telegram 提醒")}</h4>
    <ol>
      <li>{tr("In Alerts & activity, use the Telegram connection action to open the PULSE bot. Start it, link your wallet with its ownership confirmation and confirm the connection.", "在 Alerts & activity 打开 PULSE 机器人，启动后完成钱包所有权关联并确认连接。")}</li>
      <li>{tr("Return to the same wallet in Terminal. Check the linked wallet and recipient, enable notifications and select the event types you want.", "回到同一钱包，确认关联钱包和接收方，启用通知并选择事件类型。")}</li>
      <li>{tr("Include the setups, Radars or positions you want alerts for. Pause all notifications to stop Terminal Telegram delivery; pause one watch to stop that watch. These controls do not close trades.", "选择需要提醒的计划、Radar 或持仓。暂停全部通知停止终端投递，暂停单个监控只停止该监控。这些操作不会平仓。")}</li>
    </ol>
    <p>{tr("Linking and enabling are separate steps. A bot recipient must be linked to the signed-in wallet before delivery can be enabled. Activity shows delivery status. Missing data or an unchanged condition does not become a trade signal.", "关联与启用是两个步骤。接收方须先关联当前钱包，之后才可启用投递。活动显示投递状态。缺失数据或未变化条件不会变成交易信号。")}</p>
    <h4>{tr("Read the Activity timeline", "查看活动时间线")}</h4>
    <p>{tr("Activity is this wallet’s dated history: pass activation, monitoring started or paused, detected events, data issues, manual position changes and Telegram delivery. Filter by event type, then open the linked subject. Data needed means the next step could not be verified; it is not a buy or sell recommendation.", "活动是钱包的带时间历史：通行证、监控变化、检测事件、数据问题、持仓变化和 Telegram 投递。按类型筛选并打开关联对象。Data needed 表示下一步无法验证，不是买卖建议。")}</p>
    <details><summary>{tr("Troubleshooting", "遇到问题时")}</summary><ul>
      <li>{tr("Paid but no access: recover or sync the existing purchase before paying again.", "已付款但无权限：先恢复或同步购买，不要立即重复付款。")}</li>
      <li>{tr("No alert: check the linked wallet, global switch, selected events, subject switch, pass expiry and source availability.", "没有提醒：检查关联钱包、总开关、事件、对象开关、通行证到期及数据源。")}</li>
      <li>{tr("Data needed: inspect source and coverage details. Wait for verified recovery or use an observation window with available data; do not substitute zero for a missing reading.", "Data needed：检查来源和覆盖，等待验证恢复或使用有数据的窗口；不要将缺失读数视为零。")}</li>
    </ul></details>
    <p><a href="/trading-terminal">{tr("Open Trading Terminal →", "打开 Trading Terminal →")}</a></p>
  </div>;
}
