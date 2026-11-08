import type { Lang } from "./i18n";

const terminalHref = (section: string) => `/trading-terminal?terminalSection=${section}`;

/** Labelled illustrations, not current market observations. */
function IndicatorWalkthrough({ mode, lang }: {mode:"trader"|"creator";lang:Lang}) {
  const tr = (en:string,zh:string) => lang === "zh" ? zh : en;
  const creator = mode === "creator";
  const title = creator ? tr("Build, preview, then add to your chart", "构建、预览，再添加到图表") : tr("Buyer participation beside price", "价格旁的主动买入参与率");
  return <figure className="indicator-guide-figure">
    <svg viewBox="0 0 900 410" role="img" aria-labelledby={`indicator-guide-${mode}-title indicator-guide-${mode}-description`}>
      <title id={`indicator-guide-${mode}-title`}>{title}</title>
      <desc id={`indicator-guide-${mode}-description`}>{creator ? tr("Choose Rolling executed delta 20, preview the real selected market, and add it to the chart. Twenty contiguous source bars are required. This drawing is illustrative.","选择 Rolling executed delta 20，预览真实所选市场，再添加到图表。需要二十根连续来源柱。此图仅为示意。") : tr("An illustrated price chart and percentage pane share one time axis. An example with 120 bought and 80 sold gives 60 percent buyer participation. These numbers are not live market data.","示意价格图与百分比面板共享时间轴。买入 120、卖出 80 的示例给出 60% 主动买入参与率。这些数值并非实时行情。")}</desc>
      <rect className="indicator-guide-background" x="1" y="1" width="898" height="408" rx="12"/>
      <text className="indicator-guide-eyebrow" x="24" y="30">{tr("ILLUSTRATED WORKFLOW · NOT LIVE MARKET DATA", "流程示意 · 非实时行情")}</text>
      <text className="indicator-guide-title" x="24" y="66">{title}</text>
      <rect className="indicator-guide-card" x="24" y="90" width="300" height="280" rx="8"/>
      <text className="indicator-guide-label" x="44" y="124">{creator ? tr("1 / CHOOSE A TEMPLATE", "1 / 选择模板") : tr("1 / INDICATORS MARKET", "1 / 指标市场")}</text>
      <text x="44" y="164">{creator ? tr("Rolling executed delta 20", "滚动主动成交 delta 20") : tr("Buyer participation", "主动买入参与率")}</text>
      <text className="indicator-guide-muted" x="44" y="197">{creator ? tr("buy − sell → sum of 20 bars", "buy − sell → 20 根柱之和") : tr("120 bought / 200 total = 60%", "买入 120 / 总量 200 = 60%")}</text>
      <rect className="indicator-guide-button" x="44" y="225" width="260" height="44" rx="6"/>
      <text className="indicator-guide-button-text" x="174" y="253" textAnchor="middle">{creator ? tr("Add & view on chart", "添加并在图表查看") : tr("Add to chart", "添加到图表")}</text>
      <text className="indicator-guide-muted" x="44" y="308">{creator ? tr("Preview uses actual source history", "预览使用真实来源历史") : tr("Read this bucket beside its candle", "与对应 K 线一起读这一柱")}</text>
      <text className="indicator-guide-muted" x="44" y="338">{tr("No package ID or contract to enter", "无需填写包 ID 或合约地址")}</text>
      <rect className="indicator-guide-card" x="346" y="90" width="530" height="280" rx="8"/>
      <text className="indicator-guide-label" x="366" y="124">2 / BTC-USDT · {tr("PRICE + INDICATOR", "价格与指标")}</text>
      <g className="indicator-guide-grid"><path d="M366 150H852M366 190H852M366 230H852M366 280H852M366 330H852"/></g>
      <path className="indicator-guide-price" d="M370 208L425 192L480 205L535 165L590 182L645 146L700 158L755 174L810 154L850 165"/>
      <path className="indicator-guide-divider" d="M366 242H852"/>
      <text className="indicator-guide-muted" x="366" y="265">{creator ? tr("20-bar rolling delta · own quantity scale", "20 柱滚动 delta · 独立数量刻度") : tr("Buyer participation · own 0–100% scale", "主动买入参与率 · 独立 0–100% 刻度")}</text>
      <path className="indicator-guide-series" d="M370 335L425 330L480 336L535 318L590 325L645 300L700 306L755 315L810 290L850 285"/>
      <text className="indicator-guide-value" x="798" y="282">{creator ? tr("SUM 20", "求和 20") : "60%"}</text>
    </svg>
    <figcaption>{tr("Workflow illustration. Actual previews use the selected market’s captured inputs, show missing history and require enough contiguous bars. Example numbers are not a current report or a trade recommendation.","流程示意。实际预览使用所选市场已捕获输入，显示缺失历史并要求足够连续柱。示例数字并非当前报告或交易建议。")}</figcaption>
  </figure>;
}

function TapeoutExplanation({lang}:{lang:Lang}) {
  const tr = (en:string,zh:string) => lang === "zh" ? zh : en;
  return <>
    <h4>{tr("What Tapeout actually does", "Tapeout 实际负责什么")}</h4>
    <p>{tr("The per-bar formula is compiled into a numerical NAND circuit, and that circuit performs the buy/sell calculation. Registered circuits also have an independently checked executable identity on X Layer, so a compatible app can inspect and run the same calculation. Changing the formula changes its numerical circuit.","每柱公式编译成数值 NAND 电路，电路实际执行买卖数量计算。已注册电路还在 X Layer 拥有独立验证的可执行身份，兼容应用可检查并运行同一计算。修改公式会改变其数值电路。")}</p>
    <p>{tr("Market data, EMA/SMA, rolling windows, cumulative state, threshold conditions and drawing are explicit host responsibilities. A per-bar circuit registration does not prove that a complete multi-bar study ran on-chain. Live chart calculations do not send a transaction or ask you to enter a processor address. Registration cannot prove an exchange feed is complete or that an indicator will make money.","行情、EMA/SMA、滚动窗口、累计状态、阈值条件及绘图明确由宿主负责。每柱电路注册不证明完整多柱研究已在链上运行。实时图表不会发送交易，也不要求填写处理器地址。注册不能证明交易所数据完整或指标能盈利。")}</p>
  </>;
}

function IndicatorSessionCapture({kind,lang}:{kind:"builder"|"chart";lang:Lang}) {
  const tr = (en:string,zh:string) => lang === "zh" ? zh : en;
  const builder = kind === "builder";
  const src = builder ? "/docs/indicator-builder-live-example.png" : "/docs/indicator-chart-live-example.png";
  return <figure className="terminal-guide-figure">
    <a href={src} target="_blank" rel="noopener noreferrer">
      <img src={src} width={builder?1440:1114} height={builder?1050:1260} loading="lazy" decoding="async" alt={builder
        ? tr("Actual 8 November 2026 BTC-USDT 1H Spot test-session builder: working templates and formula settings beside a real execution-price and indicator preview, with partial coverage, 60-second source bars and UTC source times shown.","2026 年 11 月 8 日 BTC-USDT 1H 现货真实测试会话构建器：模板、公式设置与真实成交价格及指标预览并列，显示部分覆盖、60 秒来源柱及 UTC 来源时间。")
        : tr("Actual BTC-USDT test-session chart with a created buyer-participation indicator in its named percentage pane and the configured Above 60 percent condition; the captured Spot execution-price trace and shared UTC time axis remain visible.","BTC-USDT 真实测试会话图表：创建的主动买入参与率指标在具名百分比面板显示，配置高于 60% 条件，并保留绘图时间及部分来源覆盖。")}/>
    </a>
    <figcaption><strong>{tr("Real test-session capture · 8 November 2026.","真实测试会话截图 · 2026 年 11 月 8 日。")}</strong>{" "}{builder
      ? tr("BTC-USDT / 1H / Spot. The preview uses captured executions, not typed 120/80 sample values. Read its UTC source start/end, last resolved reading and partial-coverage label. The 60-second source bars are separate from the 1H price-chart timeframe; this is not a complete hourly session or a current trade call.","BTC-USDT / 1H / 现货。预览使用捕获成交，而非输入的 120/80 样本。请读 UTC 来源起止、最后已解析时间及部分覆盖标签。60 秒来源柱独立于 1H 价格图周期；这不是完整小时成交会话或当前交易指令。")
      : tr("After Add & view on chart, find the indicator by its name below price and use its independent percentage scale. The Above 60% condition marks a captured measurement above that threshold; it is not a filled trade, automatic order, Telegram alert or prediction. Read the plotted UTC times and the source coverage shown in the preview before interpreting it.","选择 Add & view on chart 后，在价格下方按名称找到指标，并使用独立百分比刻度。高于 60% 条件标记捕获测量超过阈值，不代表成交、自动订单、Telegram 提醒或预测。解读前先读绘图 UTC 时间及来源覆盖。")}{" "}<a href={src} target="_blank" rel="noopener noreferrer">{tr("Open full-size screenshot →","打开完整尺寸截图 →")}</a></figcaption>
  </figure>;
}

export function IndicatorMarketGuide({lang="en"}:{lang?:Lang}) {
  const tr = (en:string,zh:string) => lang === "zh" ? zh : en;
  return <div className="docs-copy terminal-guide indicator-guide" data-no-localize>
    <span className="eyebrow">PULSE INDICATOR MARKET · TRADER GUIDE</span>
    <h3>{tr("Add a useful reading to the market you already selected.","为已选市场添加有用读数。")}</h3>
    <p>{tr("Open Trading Terminal → Indicators Market. Market tools, Market Radar, Create indicator, positions and alerts have their own workspace sections. Your asset and primary timeframe remain selected while you move between them.","打开 Trading Terminal → Indicators Market。市场工具、Market Radar、创建指标、持仓及提醒各有工作区页面，切换时保留已选资产和主周期。")}</p>
    <p><a href={terminalHref("indicators")}>{tr("Open Indicators Market →","打开指标市场 →")}</a>{" · "}<a href="#docs-create-indicator">{tr("Build your own indicator →","构建自己的指标 →")}</a></p>
    <h4>{tr("First try: Buyer participation", "首次使用：主动买入参与率")}</h4>
    <ol>
      <li>{tr("Sign in with your wallet, check your Terminal pass, then select a market such as BTC-USDT and 15m. Opening an indicator does not place a trade.","使用钱包登录，检查终端通行证，再选择 BTC-USDT、15m 等市场和周期。打开指标不会下单。")}</li>
      <li>{tr("In Indicators Market, find Buyer participation and choose Add to chart. Review the price and service terms first if choosing a creator’s paid listing instead. A Terminal pass and paid indicator service are separate purchases.","在指标市场找到 Buyer participation，选择 Add to chart。若选作者付费条目，先审阅价格及服务条款。终端通行证与付费指标服务是独立购买。")}</li>
      <li>{tr("Open Trading Terminal. The price chart and percentage pane share the same time axis; the percentage pane uses its own scale. Hover or tap a resolved point to compare its reading with the candle at that time. Show/hide changes the display; Remove uninstalls the tool.","打开 Trading Terminal。价格图与百分比面板共享时间轴，百分比使用独立刻度。悬停或点击已解析点，与同一时间 K 线对比。显示/隐藏仅改变显示，Remove 卸载工具。")}</li>
      <li>{tr("Check the named source, Spot/Futures stream, bar interval and covered dates. Read bought and sold quantities for that same bucket in the source details or Market tools. You do not need to type sample quantities, export a file or enter a contract address to use the indicator.","检查来源名称、现货/期货数据流、来源柱周期及覆盖日期。在来源详情或市场工具读取同一分组买卖数量。使用指标不需输入样本数量、导出文件或填写合约地址。")}</li>
    </ol>
    <IndicatorWalkthrough mode="trader" lang={lang}/>
    <div className="terminal-guide-example-reading"><strong>{tr("Worked reading: what does 60% mean?","读数示例：60% 是什么意思？")}</strong><p>{tr("Use the actual quantities at your selected point: buyer share = bought / (bought + sold). For illustration only, 120 bought and 80 sold gives 60%; normalized delta is 20%. Your live point will usually have different numbers. Compare its candle and nearby price level: aggressive buying can coexist with flat or falling price. This describes participation, not an automatic long entry.","使用所选点真实数量：主动买入比例 = 买入 /（买入 + 卖出）。仅作说明，买入 120、卖出 80 得到 60%，归一化 delta 为 20%。实际点通常数值不同。对比对应 K 线及附近价位：主动买入也可能与横盘或下跌同时发生。这描述参与情况，不是自动做多入场。")}</p></div>
    <h4>{tr("Warm-up, gaps and different timeframes", "预热、缺口及不同周期")}</h4>
    <p>{tr("The source interval printed beside the indicator defines a bar for its calculation. Twenty one-minute source bars are twenty minutes, even on a daily price chart. A broad price timeframe does not manufacture historical executions. Incomplete, stale and missing inputs remain labelled. Missing history is not zero volume, a bearish condition or a failed trade.","指标旁显示的来源周期定义其计算柱。二十根一分钟来源柱就是二十分钟，即使价格图是日线。较大价格周期不会制造历史成交。不完整、过期及缺失输入保留标签。缺失历史不等于零成交、看空条件或交易失败。")}</p>
    <p>{tr("A capture can begin or end inside a source bar. If that clipped bar is shorter than the declared interval, it does not count toward rolling, smoothed or cumulative calculations. A plain per-bar reading may still appear with a partial label, but it cannot confirm a crossover. Check Last resolved reading: its timestamp can be earlier than the newest captured point while a study is warming up.","捕获可能从来源柱中途开始或结束。若截短柱比声明周期短，它不计入滚动、平滑或累计计算。普通单柱读数仍可显示，但带部分标签，不能确认交叉。检查 Last resolved reading：研究预热时，其时间可能早于最新捕获点。")}</p>
    <p>{tr("Rolling and smoothed studies wait for their full contiguous input window. A source gap restarts their warm-up and comparison memory. An above/below or crossover mark describes the configured measurement condition; it does not create a Radar, Telegram subscription or exchange order by itself.","滚动及平滑研究等待完整连续输入窗口。来源缺口会重新开始预热及比较记忆。高于/低于或交叉标记描述配置的测量条件，本身不会创建 Radar、Telegram 订阅或交易所订单。")}</p>
    <TapeoutExplanation lang={lang}/>
    <h4>{tr("Paid service and purchase recovery", "付费服务及购买恢复")}</h4>
    <p>{tr("A paid listing provides the exact versioned managed Terminal service stated in its quote. Its numerical formula remains public. Select an enabled supported network in the existing header: USDT0 on X Layer or native USDC on Base and Arbitrum One. Review chain, token, amount, creator recipient and version before approving. Gas is separate; there is no automatic renewal or bridge. Arc and Robinhood indicator checkout are unavailable.","付费条目提供报价中确切版本化托管终端服务，数值公式保持公开。在现有页头选择已启用支持网络：X Layer USDT0，或 Base、Arbitrum One 原生 USDC。批准前审阅网络、代币、金额、作者收款地址及版本。Gas 另计，不自动续费或跨链。Arc、Robinhood 暂不支持指标付款。")}</p>
    <p>{tr("Recover an interrupted purchase on its original network before signing again. A purchased version can restore for the same wallet after removal or delisting without another service charge. Managed installation still requires an active Terminal pass. Exported public formulas cannot be recalled.","付款中断时先在原网络恢复，再考虑重新签名。同一钱包的已购版本在移除或下架后可恢复，无需再次支付服务费。托管安装仍需有效终端通行证。已导出公开公式无法召回。")}</p>
    <details><summary>{tr("Optional: move a saved indicator between apps", "可选：在应用间移动已保存指标")}</summary><p>{tr("Open Move a saved indicator between apps for import/export. The .pulse-indicator.json file contains the calculation, series recipe and declared inputs, not wallet keys, private source history or positions. A compatible host supplies its own data and implements the same gap and warm-up policies. File portability is optional for ordinary chart use; third-party adoption must be verified separately.","打开 Move a saved indicator between apps 导入/导出。.pulse-indicator.json 包含计算、序列规则和声明输入，不含钱包密钥、私人历史或持仓。兼容宿主提供自己的数据并执行相同缺口、预热规则。普通图表使用无需文件移植；第三方应用支持须单独验证。")}</p></details>
    <p>{tr("Use the highlighted Ask PULSE button to explain captured inputs, opposing evidence and limits. AI cannot change the indicator’s numerical result or amend your saved trade setup.","使用高亮 Ask PULSE 按钮解释捕获输入、反向证据及限制。AI 无法更改指标数值结果或已保存交易计划。")}</p>
  </div>;
}

export function CreateIndicatorGuide({lang="en"}:{lang?:Lang}) {
  const tr = (en:string,zh:string) => lang === "zh" ? zh : en;
  return <div className="docs-copy terminal-guide indicator-guide" data-no-localize>
    <span className="eyebrow">PULSE INDICATOR MARKET · BUILDER GUIDE</span>
    <h3>{tr("Start with a working indicator. Make it yours.","从可用指标开始，按需调整。")}</h3>
    <p>{tr("Open Create indicator from the Terminal sidebar. Choose a template, adjust Inputs & formula or Appearance, then inspect the actual selected market preview. Add & view on chart installs it; Save draft keeps your work in this browser. Publishing is a separate optional step.","在终端侧栏打开 Create indicator。选择模板，调整 Inputs & formula 或 Appearance，再检查真实所选市场预览。Add & view on chart 安装指标，Save draft 在本浏览器保留工作。发布是独立可选步骤。")}</p>
    <p><a href={terminalHref("creator")}>{tr("Open Create indicator →","打开创建指标 →")}</a>{" · "}<a href="#docs-indicator-market">{tr("First chart walkthrough →","首次图表教程 →")}</a></p>
    <h4>{tr("Choose the question you want to inspect", "选择要检查的问题")}</h4>
    <table className="terminal-guide-tools"><thead><tr><th>{tr("Template", "模板")}</th><th>{tr("What it measures", "测量内容")}</th><th>{tr("First usable result", "首次可用结果")}</th></tr></thead><tbody>
      <tr><td>{tr("Buyer participation", "主动买入参与率")}</td><td>{tr("Bought volume as a percentage of bought plus sold volume", "主动买入占买卖总成交量百分比")}</td><td>{tr("A covered source bar with non-zero volume", "有非零成交量的已覆盖来源柱")}</td></tr>
      <tr><td>{tr("Volume delta", "成交量 delta")}</td><td>{tr("Bought minus sold quantity for each bar", "每柱买入减卖出数量")}</td><td>{tr("One covered source bar", "一根已覆盖来源柱")}</td></tr>
      <tr><td>{tr("Cumulative executed delta", "累计主动成交 delta")}</td><td>{tr("Running delta since this contiguous source segment began", "从当前连续来源段起累计 delta")}</td><td>{tr("The first full covered source bar; gaps restart the segment", "第一根完整覆盖来源柱；缺口重新开始一段")}</td></tr>
      <tr><td>{tr("Delta % with EMA 8", "Delta % 与 EMA 8")}</td><td>{tr("Smoothed normalized bought-minus-sold volume", "平滑后的归一化买入减卖出成交量")}</td><td>{tr("Eight contiguous valid source bars", "八根连续有效来源柱")}</td></tr>
      <tr><td>{tr("Rolling executed delta 20", "滚动主动成交 delta 20")}</td><td>{tr("Total delta in the latest twenty source bars", "最近二十根来源柱的 delta 总和")}</td><td>{tr("Twenty contiguous valid source bars", "二十根连续有效来源柱")}</td></tr>
    </tbody></table>
    <h4>{tr("Worked build: Rolling executed delta 20", "构建示例：滚动主动成交 delta 20")}</h4>
    <ol>
      <li>{tr("Keep your selected asset and chart timeframe. Choose Rolling executed delta 20 under Start with a working indicator.","保留已选资产和图表周期。在 Start with a working indicator 下选择 Rolling executed delta 20。")}</li>
      <li>{tr("In Inputs & formula, inspect the pipeline: source → buy minus sell → rolling sum over 20 bars → optional above/below or crossover condition → plot. The period counts source bars. Use the printed source interval to understand the duration, rather than assuming twenty primary chart candles.","在 Inputs & formula 检查流程：来源 → 买入减卖出 → 20 柱滚动求和 → 可选高于/低于或交叉条件 → 绘图。周期计算来源柱。使用显示的来源周期理解时长，不要假定为二十根主图 K 线。")}</li>
      <li>{tr("Read the actual market preview. The first nineteen full, valid source bars have no rolling-20 result. The twentieth sums all twenty deltas. The next removes the oldest and includes the newest. A short clipped edge does not count as a full bar. If only ten eligible bars are covered, the preview remains in warm-up; it must not display a fabricated twenty-bar sum.","阅读真实市场预览。前十九根完整有效来源柱没有滚动 20 结果，第二十根为二十根 delta 总和。下一结果去除最旧、加入最新值。截短边缘不计为完整柱。若仅覆盖十根合格柱，预览继续预热，不能显示虚构二十柱总和。")}</li>
      <li>{tr("In Appearance, choose line or histogram and inspect the independent quantity scale. A gap resets the window, requiring another twenty contiguous valid bars. A condition mark is a measurement event, not an order or a promise of Telegram delivery.","在 Appearance 选择线或柱状图，检查独立数量刻度。缺口重置窗口，须重新积累二十根连续有效柱。条件标记是测量事件，不是订单或 Telegram 投递承诺。")}</li>
      <li>{tr("Choose Add & view on chart to compare the installed result with price, or Save draft to continue in this browser. To share it, open Publish, add a useful name and description, identify the creator and choose free access or a paid managed service. Review the exact version and terms before publishing.","选择 Add & view on chart 与价格对比，或 Save draft 后在本浏览器继续。若需分享，打开 Publish，填写有用名称和说明、标识作者并选择免费或付费托管服务。发布前审阅确切版本和条款。")}</li>
    </ol>
    <IndicatorWalkthrough mode="creator" lang={lang}/>
    <h4>{tr("See the actual builder and applied chart", "查看真实构建器及已应用图表")}</h4>
    <IndicatorSessionCapture kind="builder" lang={lang}/>
    <IndicatorSessionCapture kind="chart" lang={lang}/>
    <h4>{tr("Transforms, warm-up and conditions", "变换、预热及条件")}</h4>
    <p>{tr("SMA and rolling sum require their full period. EMA also waits for that many contiguous full-bar values, uses their SMA as its first value, then updates causally. Chained transforms each warm up on their own eligible inputs. Short clipped bars are excluded from every transform, including cumulative sum. Conditions compare available outputs; a gap or partial bar cannot invent a confirmed crossover. The recipe and state rules travel with the indicator.","SMA 与滚动求和需要完整周期。EMA 同样等待足够连续完整柱，以其 SMA 为首值，再因果更新。串联变换各自使用合格输入预热。截短柱从每种变换中排除，包括累计求和。条件比较可用输出；缺口或部分柱不能制造已确认交叉。规则及状态语义随指标移植。")}</p>
    <h4>{tr("What you need to fill in", "需要填写哪些内容")}</h4>
    <p>{tr("Normal creation needs a template and its useful settings. Package IDs and versions are generated; processor addresses, circuit IDs and integer ABI tests are developer details. Import/export is under Portability and is not required to preview or install. Drafts and your private installed library are browser-local; published listings and purchased-version receipts have separate service storage.","普通创建需要模板及有用设置。包 ID 和版本自动生成；处理器地址、电路 ID 及整数 ABI 测试属于开发者详情。导入导出位于 Portability，不是预览或安装前提。草稿及私有安装库保存在本浏览器，公开条目和已购版本凭据另由服务存储。")}</p>
    <details><summary>{tr("Advanced: edit the per-bar formula", "高级：编辑每柱公式")}</summary><p>{tr("Expressions support buy, sell, integer arithmetic and abs/min/max/clamp. The builder checks numerical range, units and circuit size. Volume must scale linearly with source quantity; ratios must remain independent of that scale. buy - sell is volume; 10000 * buy / (buy + sell) is basis points, displayed as a percentage where selected. min(buy,100) mixes incompatible dimensions. Division by zero is unknown. This is a bounded executed-flow language; unsupported scripts, price inputs and external fetches are rejected.","表达式支持 buy、sell、整数算术及 abs/min/max/clamp。构建器检查数值范围、单位及电路大小。成交量须随来源数量线性缩放，比率须独立于数量刻度。buy - sell 为成交量，10000 * buy / (buy + sell) 为基点，在所选显示中转换为百分比。min(buy,100) 混合不兼容量纲，除零为未知。这是有界主动成交数据语言；不支持的脚本、价格输入及外部请求会被拒绝。")}</p></details>
    <TapeoutExplanation lang={lang}/>
    <h4>{tr("Describe what another trader will get", "说明其他交易者获得什么")}</h4>
    <blockquote>{tr("Rolling executed delta sums actual bought-minus-sold volume over twenty contiguous source bars. Compare it with price during a level test. The source interval, stream, units and missing coverage remain visible. It restarts after a gap and does not establish an entry on its own.","滚动主动成交 delta 对二十根连续来源柱的实际买入减卖出数量求和。价位测试时与价格对比。来源周期、数据流、单位及缺失覆盖保持可见。缺口后重新开始，本身不构成入场。")}</blockquote>
    <p>{tr("Publishing authenticates the publishing wallet; the creator display name is descriptive. Published versions and terms are immutable. New calculations or commercial terms require a new version. A paid service must state exactly what is included. Open calculations do not become secret, and buying a service does not buy profitable trades or renew Terminal time.","发布验证发布钱包身份，作者显示名仅为说明。已发布版本和条款不可变，计算或商业条款变更需要新版本。付费服务须明确包含内容。开放计算不会变成秘密；购买服务不购买盈利交易，也不续期终端。")}</p>
    <p>{tr("Before sharing, inspect the real available-data preview, test warm-up and missing-history behavior, and review the chart and description another wallet will see. Optional export/import can check a compatible host’s implementation. A local preview does not imply X Layer registration or third-party adoption.","分享前检查真实可用数据预览，测试预热及缺失历史，并审阅其他钱包看到的图表和说明。可选导入导出可检查兼容宿主实现。本地预览不代表 X Layer 注册或第三方应用已采用。")}</p>
  </div>;
}
