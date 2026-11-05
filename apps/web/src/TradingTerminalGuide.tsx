import type { Lang } from "./i18n";
import { TerminalPassPrices } from "./TerminalProductInfo";

export function TradingTerminalGuide({lang="en"}:{lang?:Lang}) {
  const zh=lang==="zh";
  return <div className="docs-copy terminal-guide" data-no-localize>
    <span className="eyebrow">PULSE TRADING TERMINAL</span>
    <h3>{zh?"从行情证据到持续跟踪":"From market evidence to ongoing monitoring"}</h3>
    <p>{zh?"在 Portfolio 后选择 Trading Terminal。使用原有顶部网络、外观和钱包控件。终端独立于 Global 报告和 Autopilot；无需先购买报告。":"Choose Trading Terminal immediately after Portfolio. Use the existing header for network, appearance and wallet controls. Terminal is independent of Global reports and Autopilot; no report purchase is required."}</p>
    <div className="terminal-guide-diagram">
      <div><strong>{zh?"1. Market tools：查看测量":"1. Market tools: inspect measurements"}</strong><p>{zh?"选择资产和周期，按各工具标明的数据窗口查看价值、成交资金流、持仓和流动性。":"Choose a market and timeframe; inspect value, executions, positioning and liquidity with each source window."}</p></div>
      <div><strong>{zh?"2. Market Radar：识别事件":"2. Market Radar: detect events"}</strong><p>{zh?"围绕选定边界观察收复、突破接受或突破失败的顺序。":"Observe a reclaim, breakout acceptance or failure around a selected boundary."}</p></div>
      <div><strong>{zh?"3. Follow setup：跟踪计划":"3. Follow setup: monitor a plan"}</strong><p>{zh?"保存一项仍有效的计划，查看下一条件并配置提醒。实际成交另外记录。":"Save an eligible plan, see its next condition and configure alerts. Record actual executions separately."}</p></div>
    </div>
    <h4>{zh?"开始使用":"Start with your market"}</h4>
    <ol><li>{zh?"连接钱包，并签署登录消息以访问私人工作区。登录消息不是交易，也不会购买通行证。":"Connect your wallet and sign the login message to access its private workspace. Signing in does not purchase a pass or place a trade."}</li><li>{zh?"查看终端中的当前价格、有效期、支持的付款网络及限制，再明确购买通行证。":"Review the current pass price, duration, supported payment networks and limits, then explicitly purchase access."}</li><li>{zh?"选择资产与主周期。图表同时说明入场和更高周期的证据角色。":"Select an asset and primary timeframe. The chart also identifies execution and higher-context evidence roles."}</li><li>{zh?"先检查数据时间、窗口与完整性。缺失数据保持未知，不会当作零值。":"Check source times, windows and completeness. Missing information stays unknown rather than becoming zero."}</li></ol>
    <TerminalPassPrices lang={lang}/>
    <p>{zh ? "终端顶部与 Portfolio 卡片显示已购买访问权限的剩余天、小时、分钟和秒。倒计时使用服务器记录的到期时间，重新打开后仍延续原有期限。续期叠加为连续访问时长，并标明当前正在使用的通行证；不会自动续费。到期后付费功能停止，持仓记录仍保留，到期也不会平仓或取消交易所订单。" : "The Terminal header and Portfolio card show days, hours, minutes and seconds of purchased access remaining. The countdown uses the server-recorded expiry and continues from that deadline after reopening. Renewals stack into continuous access; the label identifies the pass currently running. There is no automatic renewal. Paid functions stop at expiry, while journal records remain; expiry never closes positions or cancels exchange orders."}</p>
    <p>{zh?"通行证价格由服务端发布。Terminal 通行证、Global 报告和 Autopilot Entry Pass 是不同购买项目；相同的钱包地址不代表已有该服务的权限。":"Pass prices come from the server. Terminal passes, Global reports and Autopilot Entry Passes are distinct purchases. Using the same wallet does not imply access to every service."}</p>
    <h4>{zh?"Market tools 怎么读":"How to read Market tools"}</h4>
    <table className="terminal-guide-tools"><thead><tr><th>{zh?"工具":"Tool"}</th><th>{zh?"交易者的问题":"Trader's question"}</th><th>{zh?"检查方式":"What to inspect"}</th></tr></thead><tbody>
      <tr><td>VWAP & value</td><td>{zh?"价格相对价值区域在哪里？":"Where is price relative to traded value?"}</td><td>{zh?"锚点、窗口、VWAP 带和真实成交量分布；确认近似计算标记。":"Anchor, window, VWAP bands and executed-volume profile; check any approximation label."}</td></tr>
      <tr><td>Buy/sell flow</td><td>{zh?"成交是否支持这段价格变化？":"Do executions support this price move?"}</td><td>{zh?"分别查看现货与永续主动买卖、delta/CVD，以及价格反应。":"Separate spot/perpetual aggressive volume, delta/CVD and the price response."}</td></tr>
      <tr><td>Footprint</td><td>{zh?"测试价位时实际成交了什么？":"What traded during the level test?"}</td><td>{zh?"实际覆盖的时间与价位逐档买卖成交量。":"Actual covered time and price-by-price aggressive executions."}</td></tr>
      <tr><td>Open interest & funding</td><td>{zh?"衍生品持仓和资金费用如何变化？":"What are current derivative positioning and funding?"}</td><td>{zh?"合约单位、OI 时间与资金费率；OI 本身不说明方向。":"Contract units, OI timestamps and funding; OI alone does not establish side."}</td></tr>
      <tr><td>Liquidity</td><td>{zh?"当前数据源显示了哪些挂单流动性？":"What resting liquidity does the current source show?"}</td><td>{zh?"实际订单簿时间与覆盖；当前快照不能当成历史热图。":"Real book timestamps/coverage; a current snapshot is not a historical heatmap."}</td></tr>
    </tbody></table>
    <p>{zh?"先检查每项工具标明的数据时间窗口，再比较相关证据。图表缩放不会重新计算工具窗口，也不会改变 Entry、SL、TP 或策略规则。日线/周线结构与近期成交流有独立的时间窗口。":"Inspect each tool's stated source window, then compare the relevant evidence. Chart zoom does not recalculate tool windows or change Entry, SL, TP or strategy rules. Daily/weekly structure and recent execution flow have independent windows."}</p>
    <h4>{zh?"Market Radar 的用途":"Use Market Radar"}</h4>
    <ol><li>{zh?"选择边界、检测模式、观察周期及有效期。":"Choose a boundary, detector, observation frame and expiry."}</li><li>{zh?"查看 developing、completed、failed、expired 或 data needed 状态与时间顺序。":"Inspect Developing, Completed, Failed, Expired or Data needed, with ordered source events."}</li><li>{zh?"按需配置提醒，或回看保留的事件。历史回看不会把旧事件当作新提醒。":"Choose alerts or inspect retained events. Historical inspection does not turn past events into new alerts."}</li></ol>
    <p>{zh?"Radar 使用 Tapeout 逻辑组件处理事件顺序；市场测量来自已标明的数据源。事件完成不是买卖指令或已成交记录。":"Radar uses Tapeout logic components for event sequencing; market measurements come from the stated sources. A completed event is neither an order nor an execution record."}</p>
    <h4>{zh?"Follow setup 怎么帮助交易者":"How Follow setup helps"}</h4>
    <p>{zh?"打开计划，检查当前有效性、入场方式、Entry 区间、固定硬止损、目标、取消条件和期限，再开始跟踪。查看 Last event / Next required event / Status / Expiry。不同策略保留自己的限价或确认规则。":"Open a plan, review current eligibility, entry policy, Entry range, fixed hard stop, targets, cancellation and expiry, then follow it. Inspect Last event / Next required event / Status / Expiry. Each strategy retains its own limit-entry or confirmation policy."}</p>
    <p>{zh?"例子：新的支撑测试已发生，但后续确认仍缺失。你可以离开图表，等待状态改变后的复核提醒。确认发生在允许入场区之外时，仍需等待合格回测；不会假定已经成交。":"Example: a new support test occurs, but its required later confirmation is missing. You can leave the chart and receive a review alert when state changes. Confirmation outside the permitted Entry area still requires an eligible return; no fill is assumed."}</p>
    <p>{zh?"已过期、失效或已完成的旧计划不能通过重新开始跟踪恢复；需要单独审阅的新版本。数据不足时显示 Data needed。":"An expired, invalidated or completed plan cannot be revived by restarting monitoring; it needs a separately reviewed new version. Insufficient sources produce Data needed."}</p>
    <h4>{zh?"持仓、提醒和到期":"Positions, alerts and expiry"}</h4>
    <p>{zh?"在 My positions 记录实际买卖价格、数量与时间。手工记录始终标为用户提供；记录的止损不等于交易所已挂保护单。行情触及目标也不等于真实平仓。":"In My positions, record actual execution price, quantity and time. Manual records remain user-reported; a recorded stop does not establish an active exchange order. A price touching a target does not establish a filled close."}</p>
    <p>{zh?"Telegram 提醒需先关联自己的聊天并明确启用事件。Alerts & activity 展示观察与投递状态。通行证到期后查看工作区中的监控状态；到期不会平仓或取消交易所订单。":"Telegram alerts require linking your own chat and explicitly enabling events. Alerts & activity shows observations and delivery status. Inspect monitoring status after pass expiry; expiry does not close positions or cancel exchange orders."}</p>
    <details><summary>{zh?"遇到问题怎么办？":"Troubleshooting"}</summary><ul><li>{zh?"价格或时间过旧：检查各图层来源与覆盖，不要把周线收盘时间当作实时报价。":"Old-looking data: inspect each source/coverage clock; a completed weekly candle is distinct from the current quote."}</li><li>{zh?"付款后无权限：先重新同步已付款购买，勿立即重复支付。":"Paid but no access: recover/sync the paid purchase before attempting another payment."}</li><li>{zh?"没有提醒：检查通行证、观察来源、条件是否发生变化、接收人关联和事件开关。":"Missing alert: check pass access, source freshness, whether a state changed, linked recipient and event preferences."}</li><li>{zh?"重新登录不会把旧计划或价格触及变成成交。":"Signing in again does not turn old plans or level touches into executions."}</li></ul></details>
    <p><a href="/trading-terminal">{zh?"打开 Trading Terminal →":"Open Trading Terminal →"}</a></p>
  </div>;
}
