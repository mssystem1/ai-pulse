import {useState} from "react";
import {useGlobalChartAppearance} from "./useGlobalChartAppearance";
import "./globalReport.css";

const illustrationVersion="20261028";
const captureVersion="20261027";
type ExampleFrame="15m"|"1H"|"4H"|"1Dutc"|"1Wutc";
export function GlobalChartGuide({lang="en"}:{lang?:"en"|"zh"}){
  const tr=(en:string,zh:string)=>lang==="zh"?zh:en,appearance=useGlobalChartAppearance();
  const [frame,setFrame]=useState<ExampleFrame>("1Wutc");
  const imagePath=(name:string)=>`/docs/global-chart/${name}-${captureVersion}-${appearance}-${lang}.png`;
  const figure=(src:string,title:string,caption:string)=><figure className="global-guide-figure"><a href={src} target="_blank" rel="noreferrer"><img src={src} alt={title} loading="lazy" decoding="async"/></a><figcaption><strong>{title}</strong><p>{caption}</p><a href={src} target="_blank" rel="noreferrer">{tr("Open full-size image ↗","打开完整尺寸图片 ↗")}</a></figcaption></figure>;
  const frames:Array<{id:ExampleFrame;label:string;reading:string;entry:string;context:string}>=[
    {id:"15m",label:tr("15m · Fast","15m · 快速"),reading:tr("Session value, nearby levels and fast reactions","时段价值、邻近价位与快速反应"),entry:"5m",context:"1H"},
    {id:"1H",label:tr("1H · Intraday","1H · 日内"),reading:tr("Weekly value and intraday structure","周价值与日内结构"),entry:"15m",context:"4H"},
    {id:"4H",label:tr("4H · Swing","4H · 波段"),reading:tr("Swing structure, value and active balance","波段结构、价值与当前平衡区"),entry:"1H",context:"1D (UTC)"},
    {id:"1Dutc",label:tr("1D · Position","1D · 中期"),reading:tr("Multi-month recovery/decline and daily levels","数月恢复／下跌结构与日线价位"),entry:"4H",context:"1W (UTC)"},
    {id:"1Wutc",label:tr("1W · Macro","1W · 宏观"),reading:tr("Cycle value, major legs and weekly support/resistance","周期价值、主要波段与周线支撑阻力"),entry:"1D (UTC)",context:"1M (UTC)"},
  ];
  const views=[
    [tr("Setup view","入场视图"),tr("Restore the default trend, value and range studies around the saved plan.","恢复计划周围默认的趋势、价值与区间指标。"),tr("Keeps your inspection zoom and pan.","保留当前检查缩放与平移。")],
    [tr("Value context","价值背景"),tr("Include broader saved value references in automatic price scaling. This changes the scale context, not the VWAP anchor or data feed.","将更广的已保存价值参考纳入自动价格比例；不会更换VWAP锚点或数据源。"),tr("Keeps manual inspection; Reset view restores automatic scale.","保留手动检查；重置视图恢复自动价格比例。")],
    [tr("Structure view","结构视图"),tr("Show the available wider studies, including channels, averages, regression and measured Fibonacci.","显示可用的更广研究，包括通道、均线、回归与测量斐波那契。"),tr("Keeps live-chart zoom; use Full history to fit all candles.","保留交互图缩放；全部历史才会显示所有K线。")],
    [tr("Full history","全部历史"),tr("Fit every saved completed candle and include value context.","显示所有已保存完整K线，并纳入价值背景。"),tr("Explicitly fits the saved history.","明确调整为全部已保存历史。")],
    [tr("Reset view","重置视图"),tr("Restore the initial time window and automatic price scale.","恢复初始时间范围与自动价格比例。"),tr("Moves the view; keeps selected studies.","调整视图，保留所选指标。")],
    [tr("Reset studies","恢复默认指标"),tr("Restore the report's default indicator switches.","恢复报告默认指标开关。"),tr("Keeps the current viewport.","保留当前视图范围。")],
    [tr("Show measured swing","查看斐波那契锚点"),tr("Fit the saved A/B anchors when Fibonacci is enabled and a measured swing is available.","启用斐波那契且存在测量波段时，显示已保存A／B锚点。"),tr("Explicitly fits that swing's history.","明确调整为该测量波段的历史。")],
    [tr("Inspect candles / Show full map","检查K线／显示完整走势"),tr("On mobile, switch between the complete saved map and the interactive chart.","手机端可在完整已保存图与交互K线图之间切换。"),tr("Changes presentation; keeps the report.","切换展示方式，不更新报告。")],
  ];
  const indicators=[
    ["EMA 12 / 25",tr("A trend ribbon for the selected primary timeframe. Read it alongside price structure and the entry condition.","所选主周期的趋势均线带，结合价格结构与入场条件阅读。")],
    [tr("Anchored VWAP / VWAP bands","锚定VWAP／VWAP偏差带"),tr("Saved volume-weighted value from the named anchor, with available deviation bands. Zooming does not re-anchor it.","从注明锚点计算的已保存成交量加权价值及可用偏差带；缩放不会重新锚定。")],
    [tr("Range references","区间参考"),tr("Primary support/resistance and available balance, recovery, decline or cycle ranges. A geometric midpoint is not volume-profile POC.","主周期支撑阻力，以及可用平衡、恢复、下跌或周期范围；几何中点不是成交量分布POC。")],
    [tr("Broad / local parallel channel · Channel midlines","宽／局部平行通道 · 通道中线"),tr("Saved qualifying channels at different scales. A disabled control or an availability message explains missing channel evidence.","不同尺度上符合条件的已保存通道；禁用按钮或可用性说明表示缺少相应通道依据。")],
    ["SMA 21/55/89/144/233",tr("The available family of simple moving averages for broader trend context.","可用简单移动平均线组合，用于更广趋势背景。")],
    ["Regression 120 ±2σ",tr("A statistical corridor fitted to saved bars. It is separate from a qualifying parallel price channel.","根据已保存K线拟合的统计走廊，与符合条件的价格平行通道分别显示。")],
    [tr("Fibonacci retracement","斐波那契回撤"),tr("Retracements of the stated measured swing. Read the A/B prices and dates; use Show measured swing to inspect both anchors.","注明测量波段的回撤；阅读A／B价格与日期，并用查看斐波那契锚点检查两端。")],
    [tr("Confirmed pivots / Wave hypotheses","已确认转折点／波浪候选"),tr("Observed swing references and the saved wave interpretation. A drawing does not establish an executed entry.","已观察到的摆动参考与保存的波浪解释；图形本身不代表已执行入场。")],
    ["ATR14",tr("A volatility reading for the primary timeframe. Showing it does not move the saved protective stop.","主周期波动读数；显示此指标不会移动已保存保护止损。")],
    [tr("Volume profile / Trade footprint","成交量分布／成交足迹"),tr("Appear only when the report retained executed-trade evidence. Read its venue, window and price rows; it does not supply resting order-book liquidity.","报告保留实际成交依据时才显示；阅读交易所、时段与价格档位；它不提供挂单簿流动性。")],
  ];
  const selected=frames.find(row=>row.id===frame)!;
  return <div className="global-chart-reading" data-no-localize data-global-guide-version={illustrationVersion}>
    <p className="global-guide-updated">{tr("Updated 28 October 2026 · Current chart controls and export flow","更新于2026年10月28日 · 当前图表控件与导出流程")}</p>
    <h2>{tr("Use the Global chart","使用Global图表")}</h2>
    <p>{tr("Use this panel to inspect a saved market setup, compare its timeframes and export what you have selected. View and indicator controls change the presentation; they do not generate another analysis.","此面板用于检查已保存市场计划、比较周期并导出所选内容。视图及指标控件调整展示方式，不会生成另一份分析。")}</p>
    <ol className="global-guide-steps">
      <li>{tr("Confirm the asset, report timeframe and saved source times. Read the priced setup and its exact entry condition.","确认资产、报告周期与保存的来源时间，阅读具体价格计划及确切入场条件。")}</li>
      <li>{tr("Start with Setup view. Use Value context or Structure view for additional context, then inspect candles and the entry study.","从入场视图开始；需要更多背景时选择价值背景或结构视图，再检查K线及入场研究。")}</li>
      <li>{tr("Turn on the indicators you need. Compare the primary chart with the lower entry study and higher context.","启用所需指标，比较主图、小周期入场研究与高周期背景。")}</li>
      <li>{tr("Choose Download chart PNG or Download report TXT. Wait for preparation, then use Save file or Share / Save to Files.","选择下载图表PNG或报告TXT，准备完成后使用保存文件或分享／存储到文件。")}</li>
    </ol>
    {figure(imagePath("chart-controls"),tr("The current chart controls","当前图表控件"),tr("The highlighted PNG action saves the full report map. The TXT action is in the report header. The hints beside the controls explain what changes and what stays in place.","突出显示的PNG按钮用于保存完整报告图；TXT按钮位于报告顶部。控件旁提示说明各操作的变化及保留内容。"))}

    <h3>{tr("Choose a view without losing your place","选择视图并保留检查位置")}</h3>
    <div className="global-guide-controls"><table><thead><tr><th>{tr("Control","控件")}</th><th>{tr("Use it for","用途")}</th><th>{tr("Effect on your view","对视图的影响")}</th></tr></thead><tbody>{views.map(([name,use,effect])=><tr key={name}><td><strong>{name}</strong></td><td>{use}</td><td>{effect}</td></tr>)}</tbody></table></div>
    <p>{tr("Drag to pan, scroll or pinch to zoom time, and drag the price axis to adjust price scale. Polling, resizing, language changes and study switches preserve inspection within the same snapshot. Axis double-click does not reset it. Opening a different report starts that snapshot's view.","拖动平移、滚轮或双指缩放时间，拖动价格轴调整价格比例。同一快照内，轮询、窗口尺寸、语言和指标切换均保留检查位置；双击坐标轴不会重置。打开不同报告时使用该快照自身视图。")}</p>

    <h3>{tr("Understand the indicator switches","理解指标开关")}</h3>
    <p>{tr("Pressed buttons show active studies. Disabled or absent controls mean that evidence was not retained or does not qualify in this snapshot. Hover, focus or open the nearby hints for details; adding studies does not change Entry, SL or targets.","按下状态表示指标已启用；禁用或缺失控件表示快照未保留相应依据或不符合条件。可悬停、聚焦或打开旁边提示查看说明；增加指标不会改变Entry、SL或目标。")}</p>
    <div className="global-guide-controls"><table><thead><tr><th>{tr("Study","指标")}</th><th>{tr("What to read","阅读重点")}</th></tr></thead><tbody>{indicators.map(([name,meaning])=><tr key={name}><td><strong>{name}</strong></td><td>{meaning}</td></tr>)}</tbody></table></div>

    <h3>{tr("Read the primary, entry and context frames together","结合主周期、入场周期与背景周期")}</h3>
    <p>{tr("The Primary chart describes the selected horizon. Entry study shows a lower timeframe for the stated reaction. Context shows a higher timeframe and its agreement with the setup. Their candles, indicator anchors and protection distances belong to their own timeframes. Panel availability depends on saved coverage; missing entry or context candles are shown as unavailable.","主图描述所选周期；入场研究用更小周期检查指定反应；背景图展示更高周期及其与计划的关系。各自K线、指标锚点与保护距离属于各自周期。面板是否可用取决于已保存数据覆盖；缺少入场或背景K线时会注明不可用。")}</p>
    <div className="global-guide-controls"><table><thead><tr><th>{tr("Primary chart","主图")}</th><th>{tr("Reading","阅读重点")}</th><th>{tr("Entry study","入场研究")}</th><th>{tr("Context","背景")}</th></tr></thead><tbody>{frames.map(row=><tr key={row.id}><td>{row.label}</td><td>{row.reading}</td><td>{row.entry}</td><td>{row.context}</td></tr>)}</tbody></table></div>
    <p>{tr("Candle coordinates and source times use UTC. The moving clock shows current local time; it does not refresh a saved report. A completed weekly close can be older than the quote captured with the report or the lower-timeframe candles.","K线坐标及来源时间使用UTC；走动时钟显示当前本地时间，不会刷新已保存报告。完整周线收盘可能早于报告捕获的报价或小周期K线。")}</p>

    <h3>{tr("Compare the current chart illustrations","比较当前图表样例")}</h3>
    <p className="global-guide-snapshot">{tr("These are historical examples from public candles, rendered with the current layout. Select a timeframe to see its own reading. They are chart excerpts; the full report and exported PNG also include the written evidence.","以下使用公开历史K线及当前布局绘制。选择周期查看其各自读法。图片为图表节选，完整报告及导出PNG还包含文字依据。")}</p>
    <div className="global-guide-examples" role="group" aria-label={tr("Choose an example timeframe","选择样例周期")}>{frames.map(row=><button type="button" key={row.id} aria-pressed={frame===row.id} onClick={()=>setFrame(row.id)}>{row.label}</button>)}</div>
    {figure(`/docs/global-chart/chart-guide-${illustrationVersion}-${frame}-${appearance}-${lang}.png`,selected.label+" · "+selected.reading,tr("Same saved candles and priced setup as the report renderer. Green/red support-resistance zones, VWAP references and entry/target/stop areas have different meanings; read their labels.","使用与报告绘制器相同的已保存K线及价格计划。绿／红支撑阻力区、VWAP参考及入场／目标／止损区含义不同，请阅读各自标注。")+(frame==="15m"?tr(" This historical example has no saved 5m candles, so its Entry study is explicitly unavailable."," 此历史样例未保存5m K线，因此入场研究明确显示不可用。"):""))}

    <h3>{tr("Read the setup before deciding","决定前阅读交易计划")}</h3>
    <p>{tr("Entry and TP can be source-backed price ranges. The SL zone shows invalidation and its protective margin; Hard SL is the fixed outer stop. Read the entry trigger and nearest obstacle together with the reward/risk. A trend or a historical touch alone does not establish a new entry, and a confirmation close outside Entry does not inherit that range's payoff.","Entry与TP可以是有依据的价格区间；SL区域显示失效与保护余量，Hard SL为固定外侧止损。结合入场触发条件、最近障碍及收益风险比阅读；趋势或历史触及本身不构成新入场，Entry区间外的确认收盘也不继承该区间收益风险比。")}</p>
    <p>{tr("Read obstacles along the planned Entry-to-target route, even when the captured quote is already beyond them. A visited level can still obstruct a fresh retest. A wick touching it does not by itself show acceptance beyond it; lower-timeframe spikes do not erase primary-timeframe zones.","应沿计划的Entry至目标路径阅读障碍，即使快照报价已越过该处。此前触及的价位仍可能阻碍新的回测。影线触及不等于确认突破；小周期尖峰不会抹去主周期区域。")}</p>
    <p>{tr("If Entry overlaps an opposing support/resistance zone, those fills have limited clear room ahead. That limitation stays visible even when a farther TP looks attractive. Read the least favorable Entry fill and nearest obstacle together; the original source price and selected entry range are separate references.","若Entry与相反方向的支撑／阻力区域重叠，这些成交位置前方缺少清晰空间。即使较远TP看起来有吸引力，仍会显示该限制。请结合最不利Entry成交价与最近障碍阅读；原始来源价格与所选入场区间是不同参考。")}</p>
    <p>{tr("Older conditional plans can use Review setup and targets · free to review their original saved candles. The review corrects that snapshot without replacing the purchased original or fetching current market data.","较早的条件计划可使用“免费复核计划与目标”，从原始保存K线重新复核。复核修正同一快照的解读，不会替换已购买原件，也不会获取当前行情。")}</p>
    <p>{tr("Green target areas can sit below Entry for a SHORT. Candle colors show that candle's move; support/resistance shading describes structure. These colors do not replace the LONG/SHORT direction or the written condition.","SHORT的绿色目标区可位于Entry下方；K线颜色表示该根K线涨跌，支撑阻力阴影描述结构。颜色不能替代LONG／SHORT方向及文字条件。")}</p>

    <h3>{tr("Save PNG or TXT on desktop and mobile","在电脑与手机保存PNG或TXT")}</h3>
    <ol className="global-guide-steps">
      <li>{tr("Download chart PNG keeps the selected studies and appearance as a full report map. It does not crop to your temporary inspection zoom. Download report TXT keeps the complete readable report and source details.","下载图表PNG会保留所选指标与外观，输出完整报告图而非临时缩放截图；下载报告TXT保留完整可读报告及来源信息。")}</li>
      <li>{tr("Wait for the preview, then press Save file or Share / Save to Files. Supported Telegram clients use a native download prompt; older clients can open the secure file in a browser.","等待预览后点击保存文件或分享／存储到文件。支持的Telegram客户端使用原生下载提示，旧客户端可在浏览器打开安全文件。")}</li>
      <li>{tr("On iPhone or Android you can also touch and hold the image. TXT is selectable. Canceling leaves the preview available. If a secure link expires, close and reopen Download.","iPhone或Android也可长按图片保存；TXT全文可选择。取消后预览仍可使用；安全链接过期时关闭并重新打开下载。")}</li>
    </ol>
    {figure(imagePath("chart-text-download"),tr("Find the report text download","找到报告文本下载"),tr("Download report TXT is highlighted in the report heading. Download chart PNG is highlighted in the chart toolbar below. Choose the format you need, then save it from the preview.","报告顶部突出显示下载报告TXT；下方图表工具栏突出显示下载图表PNG。选择所需格式，再从预览中保存。"))}
    {figure(imagePath("chart-save"),tr("Prepare, preview and save the file","准备、预览与保存文件"),tr("The final Save/Share tap opens the device interface. Exporting reads the saved report and does not purchase or refresh analysis. PNG uses the selected appearance, bundled fonts and a bounded high-resolution render.","最后的保存／分享点击打开设备界面。导出读取已保存报告，不会购买或刷新分析。PNG保留所选外观，并使用内置字体及受大小限制的高清渲染。"))}
    <p>{tr("Review a fresh execution quote and position size if you choose to trade. A report signal is separate from an actual fill. Spot SELL reduces owned inventory; research does not open leverage.","若决定交易，请检查新的执行报价及仓位；报告信号与实际成交分别说明。现货SELL减少已有资产，研究不会自动开启杠杆。")}</p>
  </div>;
}
