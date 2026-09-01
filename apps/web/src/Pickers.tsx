import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { apiGet } from "./api";
import type { Lang } from "./i18n";
import { WEB_NETWORKS, type WebNetworkKey } from "./networks";
import { NetworkLogo } from "./NetworkLogo";

export type SpotInstrument = {
  instId: string;
  baseCcy: string;
  quoteCcy: string;
  state: string;
  assetClass: "crypto" | "tokenized_stock" | "tokenized_etf" | "rwa";
};

type AssetFilter = "all" | SpotInstrument["assetClass"];
const assetClassLabel: Record<SpotInstrument["assetClass"], string> = {
  crypto: "Crypto",
  tokenized_stock: "Tokenized stock",
  tokenized_etf: "Tokenized ETF",
  rwa: "RWA",
};

export type XLayerToken = {
  address: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  priceUsd: number | null;
  change24h: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  holders: number | null;
  communityRecognized: boolean;
  dexUrl: string | null;
  sources: string[];
};

export type ExecutionPair = {
  pair: string;
  analysisBase: string;
  executionPair: string;
  routeStatus: "checked-when-selected";
  token: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    logoUrl: string | null;
  };
};

const copy = {
  en: {
    choosePair: "Choose market pair",
    pairTitle: "Choose an OKX spot market",
    pairLead: "Live instruments from OKX. Search, then select a listed pair.",
    pairSearch: "Search BTC, ETH, OKB or USDT…",
    pairEmpty: "No live OKX spot pairs found.",
    browseTokens: "Browse network tokens",
    tokenTitle: "Discover network tokens",
    tokenLead:
      "Choose a token to fill its contract address, or close this list and enter an address manually.",
    tokenSearch: "Search name, ticker or contract address…",
    tokenEmpty:
      "No matching catalog token found. You can still enter the contract address manually.",
    tokenDisclosure:
      "Discovery uses the selected network's configured catalog and OKX Onchain OS where supported. A listing is not an endorsement or safety result.",
    results: "results",
    loading: "Loading live catalog…",
    retry: "Try again",
    close: "Close",
    selected: "Selected",
    liquidity: "Liquidity",
    price: "Price",
  },
  zh: {
    choosePair: "选择市场交易对",
    pairTitle: "选择 OKX 现货市场",
    pairLead: "实时 OKX 交易对。搜索后从列表中选择。",
    pairSearch: "搜索 BTC、ETH、OKB 或 USDT…",
    pairEmpty: "未找到实时 OKX 现货交易对。",
    browseTokens: "浏览 X Layer 代币",
    tokenTitle: "发现 X Layer 代币",
    tokenLead:
      "选择代币以填入合约地址，也可关闭列表并手动输入任意 X Layer 地址。",
    tokenSearch: "搜索名称、代码或合约地址…",
    tokenEmpty: "未找到匹配代币。你仍可手动输入地址。",
    tokenDisclosure:
      "发现数据来自 OKX Onchain OS，并在可用时由 DexScreener 补充。收录不代表背书或安全验证。",
    results: "个结果",
    loading: "正在加载实时目录…",
    retry: "重试",
    close: "关闭",
    selected: "已选择",
    liquidity: "流动性",
    price: "价格",
  },
} as const;

function readError(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data)
    return String(data.error);
  return fallback;
}

function compactUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) < 0.01) return `$${value.toPrecision(3)}`;
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 1 ? 2 : 4,
  }).format(value);
}

function shortAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function PickerDialog({
  open,
  title,
  lead,
  closeLabel,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  lead: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useRef(`picker-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.classList.add("picker-open");
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("picker-open");
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="picker-layer"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId.current}
    >
      <button
        className="picker-backdrop"
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
      />
      <section className="picker-dialog">
        <header className="picker-header">
          <div>
            <span className="eyebrow">LIVE CATALOG</span>
            <h2 id={titleId.current}>{title}</h2>
            <p>{lead}</p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
          >
            ×
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}

const timeframeOptions = [
  {
    value: "15m",
    label: "15 minutes",
    note: "Fast momentum and intraday entries",
    horizon: "FAST",
  },
  {
    value: "1H",
    label: "1 hour",
    note: "Intraday trend and structure",
    horizon: "INTRADAY",
  },
  {
    value: "4H",
    label: "4 hours",
    note: "Swing setups and active trading",
    horizon: "SWING",
  },
  {
    value: "1D",
    label: "1 day",
    note: "Position context and major levels",
    horizon: "POSITION",
  },
  {
    value: "1W",
    label: "1 week",
    note: "Macro structure and long cycles",
    horizon: "MACRO",
  },
] as const;

export function TimeframePicker({
  id,
  value,
  networkKey,
  values,
  purpose = "analysis",
  onChange,
}: {
  id: string;
  value: string;
  networkKey: WebNetworkKey;
  values?: readonly string[];
  purpose?: "analysis" | "strategy";
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const network = WEB_NETWORKS[networkKey];
  const visibleOptions = values?.length
    ? timeframeOptions.filter((item) => values.includes(item.value))
    : timeframeOptions;
  const selected =
    visibleOptions.find((item) => item.value === value) ||
    visibleOptions[0] ||
    timeframeOptions[2];

  useEffect(() => {
    const query = window.matchMedia("(max-width: 620px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      )
        setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const popover = open ? (
    <div
      ref={popoverRef}
      className="timeframe-popover"
      role="listbox"
      aria-label={purpose === "strategy" ? "Strategy decision timeframe" : "Analysis timeframe"}
    >
      <header>
        <span className={`timeframe-network-logo ${networkKey}`}>
          <NetworkLogo network={networkKey} />
        </span>
        <span>
          <small>{purpose === "strategy" ? "AUTOPILOT CONTEXT" : "ANALYSIS CONTEXT"}</small>
          <strong>Choose timeframe</strong>
          <em>{purpose === "strategy" ? `${network.label} · candidate and strategy update together` : `${network.label} theme · report and chart update together`}</em>
        </span>
      </header>
      <div className="timeframe-options">
        {visibleOptions.map((item) => (
          <button
            type="button"
            role="option"
            aria-selected={item.value === selected.value}
            className={item.value === selected.value ? "selected" : ""}
            key={item.value}
            onClick={() => {
              onChange(item.value);
              setOpen(false);
            }}
          >
            <span className="timeframe-code">{item.value}</span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.note}</small>
            </span>
            <em>{item.value === selected.value ? "✓" : item.horizon}</em>
          </button>
        ))}
      </div>
      <footer>
        <i /> {purpose === "strategy"
          ? "Selected timeframe controls the candidate candle and strategy decision cadence."
          : "Selected timeframe controls candles, indicators and Premium chart overlays."}
      </footer>
    </div>
  ) : null;

  return (
    <div className="timeframe-picker" ref={rootRef}>
      <button
        id={id}
        type="button"
        className="timeframe-trigger"
        title={`${purpose === "strategy" ? "Strategy decision timeframe" : "Analysis timeframe"} · ${selected.value} · ${selected.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="timeframe-value">
          <b>{selected.value}</b>
          <small>{selected.label}</small>
        </span>
        <span className="timeframe-trigger-meta">
          <em>{selected.horizon}</em>
          <svg
            aria-hidden="true"
            width="11"
            height="7"
            viewBox="0 0 11 7"
            fill="none"
          >
            <path
              d="M1 1L5.5 5.5L10 1"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </button>
      {popover && (mobile ? createPortal(popover, document.body) : popover)}
    </div>
  );
}

export function MarketPairPicker({
  id,
  lang,
  value,
  onSelect,
}: {
  id: string;
  lang: Lang;
  value: string;
  onSelect: (instrument: SpotInstrument) => void;
}) {
  const c = copy[lang];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SpotInstrument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");

  useEffect(() => {
    if (!open) return;
    let current = true;
    const timeout = window.setTimeout(
      async () => {
        setLoading(true);
        setError(null);
        const response = await apiGet(
          `/v1/market/instruments?q=${encodeURIComponent(query)}&limit=80`,
        );
        if (!current) return;
        if (response.ok) {
          const data = response.data as { instruments?: SpotInstrument[] };
          setItems(data.instruments || []);
        } else {
          setItems([]);
          setError(
            readError(
              response.data,
              `Market catalog unavailable (${response.status})`,
            ),
          );
        }
        setLoading(false);
      },
      query ? 220 : 0,
    );
    return () => {
      current = false;
      window.clearTimeout(timeout);
    };
  }, [open, query, reload]);

  const [base, quote] = value.split("-");
  const visibleItems =
    assetFilter === "all"
      ? items
      : items.filter((item) => item.assetClass === assetFilter);
  return (
    <>
      <button
        id={id}
        type="button"
        className="selector-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span className="pair-symbols">
          <b>{base}</b>
          <i>/</i>
          <span>{quote}</span>
        </span>
        <span className="selector-action">
          {c.choosePair}
          <svg
            aria-hidden="true"
            width="11"
            height="7"
            viewBox="0 0 11 7"
            fill="none"
          >
            <path
              d="M1 1L5.5 5.5L10 1"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </button>
      <PickerDialog
        open={open}
        title={c.pairTitle}
        lead={c.pairLead}
        closeLabel={c.close}
        onClose={() => setOpen(false)}
      >
        <div className="picker-search-wrap">
          <span aria-hidden="true">⌕</span>
          <input
            autoFocus
            className="picker-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={c.pairSearch}
            aria-label={c.pairSearch}
          />
        </div>
        <div className="asset-filter-row" role="group" aria-label="Asset class">
          {(
            [
              "all",
              "crypto",
              "tokenized_stock",
              "tokenized_etf",
              "rwa",
            ] as AssetFilter[]
          ).map((filter) => (
            <button
              type="button"
              key={filter}
              className={assetFilter === filter ? "is-active" : ""}
              onClick={() => setAssetFilter(filter)}
            >
              {filter === "all" ? "All" : assetClassLabel[filter]}
            </button>
          ))}
        </div>
        <div className="picker-disclosure">
          Global Market includes crypto and OKX-listed tokenized assets.
          Analysis availability does not guarantee an identity-safe on-chain
          route on the selected network.
        </div>
        <div className="picker-result-head">
          <span>OKX GLOBAL SPOT</span>
          <span>
            {visibleItems.length} {c.results}
          </span>
        </div>
        <div className="picker-results" aria-live="polite" aria-busy={loading}>
          {loading && !items.length && (
            <div className="picker-state">{c.loading}</div>
          )}
          {error && (
            <div className="picker-state error-state">
              <span>{error}</span>
              <button type="button" onClick={() => setReload((n) => n + 1)}>
                {c.retry}
              </button>
            </div>
          )}
          {!loading && !error && !visibleItems.length && (
            <div className="picker-state">{c.pairEmpty}</div>
          )}
          {visibleItems.map((item) => (
            <button
              type="button"
              className={`picker-item pair-item ${item.instId === value ? "is-selected" : ""}`}
              key={item.instId}
              onClick={() => {
                onSelect(item);
                setOpen(false);
              }}
            >
              <span className="pair-avatar">{item.baseCcy.slice(0, 2)}</span>
              <span className="picker-item-main">
                <strong>
                  {item.baseCcy}
                  <i>/</i>
                  {item.quoteCcy}
                </strong>
                <small>{item.instId} · OKX spot</small>
              </span>
              <span className="pair-item-status">
                <small className={`asset-class-badge ${item.assetClass}`}>
                  {assetClassLabel[item.assetClass]}
                </small>
                <span className="live-chip">
                  {item.instId === value ? c.selected : "LIVE"}
                </span>
              </span>
            </button>
          ))}
        </div>
      </PickerDialog>
    </>
  );
}

export function ExecutionPairPicker({
  id,
  networkKey,
  value,
  custody = "wallet",
  onSelect,
}: {
  id: string;
  networkKey: WebNetworkKey;
  value: string;
  custody?: "wallet" | "erc20";
  onSelect: (pair: ExecutionPair) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ExecutionPair[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [verifyingPair, setVerifyingPair] = useState("");
  const [unavailable, setUnavailable] = useState<Record<string, string>>({});
  const network = WEB_NETWORKS[networkKey];

  useEffect(() => {
    if (!open || networkKey === "arc-testnet") return;
    let current = true;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      const response = await apiGet(`/v1/trading/pairs?network=${networkKey}&q=${encodeURIComponent(query)}&limit=160${custody === "erc20" ? "&custody=erc20" : ""}`);
      if (!current) return;
      if (response.ok) {
        setItems(((response.data as { pairs?: ExecutionPair[] }).pairs || []));
      } else {
        setItems([]);
        setError(readError(response.data, `Execution catalog unavailable (${response.status})`));
      }
      setLoading(false);
    }, query ? 200 : 0);
    return () => { current = false; window.clearTimeout(timeout); };
  }, [open, networkKey, query, reload, custody]);

  const [base, quote] = value.split("-");
  return <>
    <button id={id} type="button" className="selector-trigger execution-pair-trigger" aria-haspopup="dialog" aria-expanded={open} disabled={networkKey === "arc-testnet"} onClick={() => setOpen(true)}>
      <span className="pair-symbols"><b>{base}</b><i>/</i><span>{quote}</span></span>
      <span className="selector-action">Choose on {network.label}<svg aria-hidden="true" width="11" height="7" viewBox="0 0 11 7" fill="none"><path d="M1 1L5.5 5.5L10 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></span>
    </button>
    <PickerDialog open={open} title={`Choose a live pair on ${network.label}`} lead={`PULSE verifies the identity-safe token and a live OKX Onchain OS route before accepting your choice. A token contract by itself is not enough.`} closeLabel="Close" onClose={() => setOpen(false)}>
      <div className="picker-search-wrap"><span aria-hidden="true">⌕</span><input autoFocus className="picker-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search BTC, ETH, DOGE or token name…" aria-label="Search executable pairs"/></div>
      <div className="picker-disclosure">The left name is the market symbol. The right name is its verified on-chain representation. Select it to run the final live route check; unavailable choices remain unselected.</div>
      <div className="picker-result-head"><span>{network.label.toUpperCase()} EXECUTION CATALOG</span><span>{items.length} results</span></div>
      <div className="picker-results" aria-live="polite" aria-busy={loading}>
        {loading && !items.length && <div className="picker-state">Loading network assets…</div>}
        {error && <div className="picker-state error-state"><span>{error}</span><button type="button" onClick={() => setReload((value) => value + 1)}>Try again</button></div>}
        {!loading && !error && !items.length && <div className="picker-state">No matching on-chain asset found on this network.</div>}
        {items.map((item) => { const unavailableReason = unavailable[item.pair]; const checking = verifyingPair === item.pair; return <button type="button" disabled={Boolean(verifyingPair) || Boolean(unavailableReason)} className={`picker-item pair-item ${item.pair === value ? "is-selected" : ""} ${unavailableReason ? "is-unavailable" : ""}`} key={`${item.pair}-${item.token.address}`} onClick={() => {
          setVerifyingPair(item.pair);
          void apiGet(`/v1/trading/resolve-pair?network=${networkKey}&pair=${encodeURIComponent(item.pair)}${custody === "erc20" ? "&custody=erc20" : ""}`).then((response) => {
            const result = response.data as { available?: boolean; reason?: string; explanation?: string };
            if (response.ok && result.available) {
              onSelect(item);
              setOpen(false);
              return;
            }
            setUnavailable((current) => ({ ...current, [item.pair]: result.reason || `No safe live route on ${network.label}` }));
          }).catch((reason) => setUnavailable((current) => ({ ...current, [item.pair]: reason instanceof Error ? reason.message : String(reason) }))).finally(() => setVerifyingPair(""));
        }}>
          <span className="pair-avatar">{item.token.logoUrl ? <img src={item.token.logoUrl} alt=""/> : item.analysisBase.slice(0, 2)}</span>
          <span className="picker-item-main"><strong>{item.pair.replace("-", "/")}</strong><small>{unavailableReason || `Candidate ${item.executionPair}`}</small></span>
          <span className="pair-item-status"><small className="asset-class-badge crypto">{unavailableReason ? "UNAVAILABLE" : "ON-CHAIN"}</small><span className="live-chip">{checking ? "VERIFYING…" : unavailableReason ? "TRY ANOTHER" : item.pair === value ? "RECHECK" : "VERIFY ROUTE"}</span></span>
        </button>; })}
      </div>
    </PickerDialog>
  </>;
}

export function NetworkTokenPicker({
  lang,
  networkKey,
  selectedAddress,
  onSelect,
}: {
  lang: Lang;
  networkKey: WebNetworkKey;
  selectedAddress: string;
  onSelect: (token: XLayerToken) => void;
}) {
  const c = copy[lang];
  const network = WEB_NETWORKS[networkKey];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<XLayerToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!open) return;
    let current = true;
    const timeout = window.setTimeout(
      async () => {
        setLoading(true);
        setError(null);
        const prefix = networkKey === "xlayer" ? "" : `/${network.route}`;
        const response = await apiGet(
          `${prefix}/v1/tokens?q=${encodeURIComponent(query)}&limit=50`,
        );
        if (!current) return;
        if (response.ok) {
          const data = response.data as { tokens?: XLayerToken[] };
          setItems(data.tokens || []);
        } else {
          setItems([]);
          setError(
            readError(
              response.data,
              `Token catalog unavailable (${response.status})`,
            ),
          );
        }
        setLoading(false);
      },
      query ? 260 : 0,
    );
    return () => {
      current = false;
      window.clearTimeout(timeout);
    };
  }, [network.route, networkKey, open, query, reload]);

  return (
    <>
      <button
        className="browse-token-button"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">✦</span>{" "}
        {lang === "en" ? `Browse ${network.label} tokens` : c.browseTokens}
      </button>
      <PickerDialog
        open={open}
        title={
          lang === "en" ? `Discover tokens on ${network.label}` : c.tokenTitle
        }
        lead={
          lang === "en"
            ? `Choose a network token to inspect, or enter any ${network.label} contract address manually.`
            : c.tokenLead
        }
        closeLabel={c.close}
        onClose={() => setOpen(false)}
      >
        <div className="picker-search-wrap">
          <span aria-hidden="true">⌕</span>
          <input
            autoFocus
            className="picker-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={c.tokenSearch}
            aria-label={c.tokenSearch}
          />
        </div>
        <p className="catalog-disclosure">
          <i aria-hidden="true">i</i>
          {c.tokenDisclosure}
        </p>
        <div className="picker-result-head">
          <span>
            {network.label.toUpperCase()} · CHAIN {network.chainId}
          </span>
          <span>
            {items.length} {c.results}
          </span>
        </div>
        <div
          className="picker-results token-results"
          aria-live="polite"
          aria-busy={loading}
        >
          {loading && !items.length && (
            <div className="picker-state">{c.loading}</div>
          )}
          {error && (
            <div className="picker-state error-state">
              <span>{error}</span>
              <button type="button" onClick={() => setReload((n) => n + 1)}>
                {c.retry}
              </button>
            </div>
          )}
          {!loading && !error && !items.length && (
            <div className="picker-state">{c.tokenEmpty}</div>
          )}
          {items.map((token) => (
            <button
              type="button"
              className={`picker-item token-item ${token.address.toLowerCase() === selectedAddress.toLowerCase() ? "is-selected" : ""}`}
              key={token.address}
              onClick={() => {
                onSelect(token);
                setOpen(false);
              }}
            >
              <span className="token-avatar">
                <span>{token.symbol.slice(0, 2)}</span>
                {token.logoUrl && (
                  <img
                    src={token.logoUrl}
                    alt=""
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                )}
              </span>
              <span className="picker-item-main token-copy">
                <strong>
                  {token.symbol}
                  {token.communityRecognized && (
                    <em title="Community recognized">✓</em>
                  )}
                </strong>
                <small>
                  {token.name} · {shortAddress(token.address)}
                </small>
                <span className="source-row">
                  {token.sources.map((source) => (
                    <i key={source}>{source}</i>
                  ))}
                </span>
              </span>
              <span className="token-market">
                <span>
                  <small>{c.price}</small>
                  <b>{compactUsd(token.priceUsd)}</b>
                </span>
                <span>
                  <small>{c.liquidity}</small>
                  <b>{compactUsd(token.liquidityUsd)}</b>
                </span>
              </span>
            </button>
          ))}
        </div>
      </PickerDialog>
    </>
  );
}
