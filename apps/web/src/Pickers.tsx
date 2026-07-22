import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { apiGet } from "./api";
import type { Lang } from "./i18n";

export type SpotInstrument = {
  instId: string;
  baseCcy: string;
  quoteCcy: string;
  state: string;
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

const copy = {
  en: {
    choosePair: "Choose market pair",
    pairTitle: "Choose an OKX spot market",
    pairLead: "Live instruments from OKX. Search, then select a listed pair.",
    pairSearch: "Search BTC, ETH, OKB or USDT…",
    pairEmpty: "No live OKX spot pairs found.",
    browseTokens: "Browse X Layer tokens",
    tokenTitle: "Discover X Layer tokens",
    tokenLead: "Choose a token to fill its contract address, or close this list and enter any X Layer address manually.",
    tokenSearch: "Search name, ticker or contract address…",
    tokenEmpty: "No matching X Layer tokens found. You can still enter the address manually.",
    tokenDisclosure: "Discovery data from OKX Onchain OS, enriched by DexScreener when available. Listings are not endorsements or safety checks.",
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
    tokenLead: "选择代币以填入合约地址，也可关闭列表并手动输入任意 X Layer 地址。",
    tokenSearch: "搜索名称、代码或合约地址…",
    tokenEmpty: "未找到匹配代币。你仍可手动输入地址。",
    tokenDisclosure: "发现数据来自 OKX Onchain OS，并在可用时由 DexScreener 补充。收录不代表背书或安全验证。",
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
  if (data && typeof data === "object" && "error" in data) return String(data.error);
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
    <div className="picker-layer" role="dialog" aria-modal="true" aria-labelledby={titleId.current}>
      <button className="picker-backdrop" type="button" onClick={onClose} aria-label={closeLabel} />
      <section className="picker-dialog">
        <header className="picker-header">
          <div>
            <span className="eyebrow">LIVE CATALOG</span>
            <h2 id={titleId.current}>{title}</h2>
            <p>{lead}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={closeLabel}>×</button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
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

  useEffect(() => {
    if (!open) return;
    let current = true;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      const response = await apiGet(`/v1/market/instruments?q=${encodeURIComponent(query)}&limit=80`);
      if (!current) return;
      if (response.ok) {
        const data = response.data as { instruments?: SpotInstrument[] };
        setItems(data.instruments || []);
      } else {
        setItems([]);
        setError(readError(response.data, `Market catalog unavailable (${response.status})`));
      }
      setLoading(false);
    }, query ? 220 : 0);
    return () => {
      current = false;
      window.clearTimeout(timeout);
    };
  }, [open, query, reload]);

  const [base, quote] = value.split("-");
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
        <span className="pair-symbols"><b>{base}</b><i>/</i><span>{quote}</span></span>
        <span className="selector-action">
          {c.choosePair}
          <svg aria-hidden="true" width="11" height="7" viewBox="0 0 11 7" fill="none">
            <path d="M1 1L5.5 5.5L10 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
      </button>
      <PickerDialog open={open} title={c.pairTitle} lead={c.pairLead} closeLabel={c.close} onClose={() => setOpen(false)}>
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
        <div className="picker-result-head"><span>OKX SPOT</span><span>{items.length} {c.results}</span></div>
        <div className="picker-results" aria-live="polite" aria-busy={loading}>
          {loading && !items.length && <div className="picker-state">{c.loading}</div>}
          {error && <div className="picker-state error-state"><span>{error}</span><button type="button" onClick={() => setReload((n) => n + 1)}>{c.retry}</button></div>}
          {!loading && !error && !items.length && <div className="picker-state">{c.pairEmpty}</div>}
          {items.map((item) => (
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
              <span className="picker-item-main"><strong>{item.baseCcy}<i>/</i>{item.quoteCcy}</strong><small>{item.instId} · OKX spot</small></span>
              <span className="live-chip">{item.instId === value ? c.selected : "LIVE"}</span>
            </button>
          ))}
        </div>
      </PickerDialog>
    </>
  );
}

export function XLayerTokenPicker({
  lang,
  selectedAddress,
  onSelect,
}: {
  lang: Lang;
  selectedAddress: string;
  onSelect: (token: XLayerToken) => void;
}) {
  const c = copy[lang];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<XLayerToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!open) return;
    let current = true;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      const response = await apiGet(`/v1/xlayer/tokens?q=${encodeURIComponent(query)}&limit=50`);
      if (!current) return;
      if (response.ok) {
        const data = response.data as { tokens?: XLayerToken[] };
        setItems(data.tokens || []);
      } else {
        setItems([]);
        setError(readError(response.data, `Token catalog unavailable (${response.status})`));
      }
      setLoading(false);
    }, query ? 260 : 0);
    return () => {
      current = false;
      window.clearTimeout(timeout);
    };
  }, [open, query, reload]);

  return (
    <>
      <button className="browse-token-button" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <span aria-hidden="true">✦</span> {c.browseTokens}
      </button>
      <PickerDialog open={open} title={c.tokenTitle} lead={c.tokenLead} closeLabel={c.close} onClose={() => setOpen(false)}>
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
        <p className="catalog-disclosure"><i aria-hidden="true">i</i>{c.tokenDisclosure}</p>
        <div className="picker-result-head"><span>X LAYER · CHAIN 196</span><span>{items.length} {c.results}</span></div>
        <div className="picker-results token-results" aria-live="polite" aria-busy={loading}>
          {loading && !items.length && <div className="picker-state">{c.loading}</div>}
          {error && <div className="picker-state error-state"><span>{error}</span><button type="button" onClick={() => setReload((n) => n + 1)}>{c.retry}</button></div>}
          {!loading && !error && !items.length && <div className="picker-state">{c.tokenEmpty}</div>}
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
                {token.logoUrl && <img src={token.logoUrl} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
              </span>
              <span className="picker-item-main token-copy">
                <strong>{token.symbol}{token.communityRecognized && <em title="Community recognized">✓</em>}</strong>
                <small>{token.name} · {shortAddress(token.address)}</small>
                <span className="source-row">{token.sources.map((source) => <i key={source}>{source}</i>)}</span>
              </span>
              <span className="token-market">
                <span><small>{c.price}</small><b>{compactUsd(token.priceUsd)}</b></span>
                <span><small>{c.liquidity}</small><b>{compactUsd(token.liquidityUsd)}</b></span>
              </span>
            </button>
          ))}
        </div>
      </PickerDialog>
    </>
  );
}
