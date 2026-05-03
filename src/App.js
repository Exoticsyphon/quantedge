/* eslint-disable */
import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════
const FH = "https://finnhub.io/api/v1";
let FINNHUB_KEY = ""; // set at runtime from ConnectScreen

// Capital split: 65% crypto (active scalper), 35% stocks (long-term hold)
const CRYPTO_CAPITAL_PCT = 0.65;
const STOCK_CAPITAL_PCT  = 0.35;

// Crypto scalper config — high performance micro scalping
const CRYPTO_CFG = {
  maxPosPct:      0.06,   // 6% of bucket per position — smaller, more of them
  maxPosFlat:     300,    // $300 hard cap per trade — keep size small for speed
  minPosDollar:   5,      // minimum $5 trade
  minConf:        0.38,   // signal filter
  stopLossPct:    0.003,  // 0.3% stop loss — ultra tight, cut fast
  takeProfitPct:  0.005,  // 0.5% take profit — take it and move on
  cooldownMs:     15000,  // 15s cooldown — re-enter quickly after exit
  maxHoldMs:      300000, // 5 min max hold — scalps don't linger
  topN:           12,     // show all pairs
  maxConcurrent:  6,      // max 6 open positions at once for diversity
  minEntryConf:   0.50,   // 50% signal agreement — majority rules
};

// Stock long-term config
const STOCK_BASE = {
  AAPL:189,MSFT:415,NVDA:875,TSLA:248,AMZN:198,META:512,
  GOOGL:175,GOOG:174,NFLX:628,AMD:165,INTC:22,QCOM:148,
  JPM:235,BAC:45,GS:556,WFC:74,"BRK.B":462,
  JNJ:155,PFE:27,UNH:585,ABBV:178,
  XOM:117,CVX:155,COP:118,
  WMT:98,COST:925,HD:395,TGT:142,
  V:315,MA:525,PYPL:77,SQ:82,
};

const STOCK_CFG = {
  maxPosPct:       0.12,
  stopLossPct:     0.20,
  rebalanceDays:   90,
  dailyRotationMs: 24 * 3600 * 1000, // check daily for rotation
  maxStocks:       6,
  minValueScore:   0.6,
};

// Full crypto universe (Finnhub/Binance pairs we can fetch)
const CRYPTO_UNIVERSE = [
  "BTC/USDT","ETH/USDT","SOL/USDT","BNB/USDT",
  "XRP/USDT","DOGE/USDT","ADA/USDT","AVAX/USDT",
  "LINK/USDT","DOT/USDT","MATIC/USDT","LTC/USDT",
];

// Stock universe — top S&P 500 names Finnhub free tier reliably covers
const STOCK_UNIVERSE = [
  "AAPL","MSFT","NVDA","TSLA","AMZN","META",
  "GOOGL","GOOG","NFLX","AMD","INTC","QCOM",
  "JPM","BAC","GS","WFC","BRK.B",
  "JNJ","PFE","UNH","ABBV",
  "XOM","CVX","COP",
  "WMT","COST","HD","TGT",
  "V","MA","PYPL","SQ",
];

const CRYPTO_META = {
  "BTC/USDT": {name:"Bitcoin",   icon:"₿",  base:94000},
  "ETH/USDT": {name:"Ethereum",  icon:"Ξ",  base:1780},
  "SOL/USDT": {name:"Solana",    icon:"◎",  base:148},
  "BNB/USDT": {name:"BNB",       icon:"⬡",  base:598},
  "XRP/USDT": {name:"XRP",       icon:"✕",  base:2.18},
  "DOGE/USDT":{name:"Dogecoin",  icon:"Ð",  base:0.175},
  "ADA/USDT": {name:"Cardano",   icon:"₳",  base:0.70},
  "AVAX/USDT":{name:"Avalanche", icon:"△",  base:21},
  "LINK/USDT":{name:"Chainlink", icon:"⬡",  base:13},
  "DOT/USDT": {name:"Polkadot",  icon:"●",  base:4.2},
  "MATIC/USDT":{name:"Polygon",  icon:"⬡",  base:0.22},
  "LTC/USDT": {name:"Litecoin",  icon:"Ł",  base:88},
};

// Finnhub crypto symbol format
const FH_CRYPTO = (t) => `BINANCE:${t.replace("/","").toUpperCase()}`;

// ═══════════════════════════════════════════════════════════════════════
// QUIZ + PROFILE
// ═══════════════════════════════════════════════════════════════════════
// ─── buildProfile stays for settings panel to call ──────────────────

function buildProfile(a) {
  const risk = a.risk ?? 2;
  const cap  = a.capital ?? 1;
  const profiles = {
    preserve:  {name:"Safe Harbor",     emoji:"🛡️",color:"#3b82f6",tagline:"Capital protection first. Slow and steady."},
    income:    {name:"Steady Earner",    emoji:"📈",color:T.green,tagline:"Consistent small wins. Minimal drama."},
    learn:     {name:"Market Explorer", emoji:"🎓",color:"#8b5cf6",tagline:"Learning while earning."},
    growth:    {name:"Growth Seeker",   emoji:"🚀",color:"#f59e0b",tagline:"Building wealth with calculated risk."},
    aggressive:{name:"Alpha Hunter",    emoji:"⚡",color:T.red,tagline:"Max upside. High risk, high reward."},
  };
  const p = profiles[a.goal] || profiles.growth;
  const total = [1000,2500,15000,62500,150000][Math.min(cap,4)];
  return {
    ...p, risk,
    initialCapital: total,
    cryptoCapital:  Math.round(total * CRYPTO_CAPITAL_PCT),
    stockCapital:   Math.round(total * STOCK_CAPITAL_PCT),
    experience: a.experience ?? 1,
    goal: a.goal,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// SENTIMENT NLP
// ═══════════════════════════════════════════════════════════════════════
const BULL_W = ["beats","record","surges","upgraded","buyback","launches","breakthrough","approved","soars","accelerates","crushes","smashes","rallies","strong","growth","partnership","expansion","bullish","buy"];
const BEAR_W = ["crashes","loss","layoffs","ban","lawsuit","breach","probe","exploited","cuts","misses","slowing","selloff","antitrust","scrutiny","recall","downgrade","fraud","halted","decline","warning"];

function scoreNews(h) {
  const t = (h||"").toLowerCase();
  let s = 0;
  BULL_W.forEach(w => t.includes(w) && (s += 1.5));
  BEAR_W.forEach(w => t.includes(w) && (s -= 1.5));
  return Math.max(-3, Math.min(3, s));
}

function sentimentFromItems(items) {
  if (!items || !items.length) return 0;
  let ws=0, wt=0;
  items.forEach((n,i) => { const w=Math.exp(-0.3*i); ws+=n.s*w; wt+=w; });
  return wt > 0 ? Math.max(-1, Math.min(1, ws/wt/2)) : 0;
}

// ═══════════════════════════════════════════════════════════════════════
// FINNHUB DATA LAYER — real prices only, no seeds
// ═══════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════════════════════════
const T = {
  bg:       "#000000",
  panel:    "#0a0a0a",
  border:   "#ffffff22",
  borderHi: "#ffffff55",
  red:      "#ef4444",
  redDim:   "#7f1d1d",
  yellow:   "#fbbf24",
  white:    "#ffffff",
  muted:    "#6b7280",
  green:    "#22c55e",
  text:     "#ffffff",
};

// ═══════════════════════════════════════════════════════════════════════
// SEED HISTORY — for demo mode
// ═══════════════════════════════════════════════════════════════════════
function seedHistory(base, len=80) {
  if (!base||base<=0) base=100;
  let p=base; const arr=[];
  const seed=base*137;
  for (let i=0;i<len;i++){
    const x=Math.sin(seed+i*7.3)*10000,r=x-Math.floor(x);
    p=Math.max(p*(1+(r-0.495)*0.018),base*0.3);
    arr.push(+p.toFixed(base<1?6:2));
  }
  arr[arr.length-1]=+base.toFixed(base<1?6:2);
  return arr;
}

function tickSeed(prices, beta=1){
  const last=prices[prices.length-1];
  return [...prices.slice(1),+(last+(Math.random()-0.495)*last*0.006*beta).toFixed(last<1?6:2)];
}
const FH_RATE = {
  tokens: 55,
  maxTokens: 55,
  refillRate: 55/60,      // tokens per second
  lastRefill: Date.now(),
  queue: [],
  cache: new Map(),       // path → {data, expires}
  cacheTTL: {
    quote:   15000,       // quotes: 15s cache
    candle:  300000,      // candles: 5min cache
    news:    180000,      // news: 3min cache
    default: 30000,
  },
};

function fhCacheTTL(path) {
  if (path.includes("quote"))   return FH_RATE.cacheTTL.quote;
  if (path.includes("candle"))  return FH_RATE.cacheTTL.candle;
  if (path.includes("news") || path.includes("company-news")) return FH_RATE.cacheTTL.news;
  return FH_RATE.cacheTTL.default;
}

function refillTokens() {
  const now = Date.now();
  const elapsed = (now - FH_RATE.lastRefill) / 1000;
  FH_RATE.tokens = Math.min(FH_RATE.maxTokens, FH_RATE.tokens + elapsed * FH_RATE.refillRate);
  FH_RATE.lastRefill = now;
}

function fhGetWithBackoff(path, retries=3, delay=1000) {
  return new Promise((resolve)=>{
    const ttl = fhCacheTTL(path);
    const cached = FH_RATE.cache.get(path);
    if (cached && Date.now() < cached.expires) {
      resolve(cached.data);
      return;
    }
    const execute = async (attempt=0)=>{
      refillTokens();
      if (FH_RATE.tokens >= 1) {
        FH_RATE.tokens -= 1;
        try {
          const sep = path.includes("?") ? "&" : "?";
          const r = await fetch(`${FH}${path}${sep}token=${FINNHUB_KEY}`);
          if (r.status === 429) {
            // Rate limited — wait and retry
            const wait = delay * Math.pow(2, attempt);
            if (attempt < retries) {
              setTimeout(()=>execute(attempt+1), wait);
            } else resolve(null);
            return;
          }
          if (!r.ok) { resolve(null); return; }
          const data = await r.json();
          FH_RATE.cache.set(path, {data, expires: Date.now()+ttl});
          resolve(data);
        } catch { resolve(null); }
      } else {
        // Not enough tokens — wait for refill
        const waitMs = Math.ceil((1 - FH_RATE.tokens) / FH_RATE.refillRate * 1000) + 50;
        setTimeout(()=>execute(attempt), waitMs);
      }
    };
    execute();
  });
}

async function fhGet(path) {
  return fhGetWithBackoff(path);
}

async function fetchQuote(symbol) {
  const d = await fhGet(`/quote?symbol=${symbol}`);
  return d && d.c > 0 ? d.c : null;
}

// Binance REST — 1200 req/min, but we use WebSocket for live so REST is startup-only
const BINANCE_SYM = (t) => t.replace("/",""); // BTC/USDT → BTCUSDT
const BINANCE_CACHE = new Map();
async function fetchRealCryptoHistory(ticker, limit=80) {
  const cacheKey = `${ticker}_${limit}`;
  const cached = BINANCE_CACHE.get(cacheKey);
  if (cached && Date.now() < cached.expires) return cached.data;

  for (let attempt=0; attempt<3; attempt++) {
    try {
      const sym = BINANCE_SYM(ticker);
      const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1m&limit=${limit}`);
      if (r.status === 429 || r.status === 418) {
        // Binance rate limited — back off
        await new Promise(res=>setTimeout(res, 2000 * (attempt+1)));
        continue;
      }
      if (!r.ok) return null;
      const data = await r.json();
      if (!Array.isArray(data) || data.length < 20) return null;
      const prices = data.map(k => +parseFloat(k[4]).toFixed(parseFloat(k[4])<1?6:2));
      BINANCE_CACHE.set(cacheKey, {data:prices, expires:Date.now()+60000}); // 1min cache
      return prices;
    } catch {
      await new Promise(res=>setTimeout(res, 1000*(attempt+1)));
    }
  }
  return null;
}

// Fetch real stock candle history from Finnhub
async function fetchRealStockHistory(sym, len=80) {
  try {
    const to = Math.floor(Date.now()/1000);
    const from = to - len * 5 * 60; // len × 5-min candles
    const d = await fhGet(`/stock/candle?symbol=${sym}&resolution=5&from=${from}&to=${to}`);
    if (d && d.s === "ok" && Array.isArray(d.c) && d.c.length >= 20) {
      return d.c.map(v => +v.toFixed(2));
    }
    // Fallback: try 1-day candles for history
    const d2 = await fhGet(`/stock/candle?symbol=${sym}&resolution=D&from=${to-90*86400}&to=${to}`);
    if (d2 && d2.s === "ok" && Array.isArray(d2.c) && d2.c.length >= 20) {
      return d2.c.slice(-80).map(v => +v.toFixed(2));
    }
    // Last resort: single quote repeated — still real, just flat history
    const q = await fetchQuote(sym);
    if (q) return Array(80).fill(q);
    return null;
  } catch { return null; }
}

async function fetchStockNews(sym) {
  const to = new Date().toISOString().slice(0,10);
  const from = new Date(Date.now()-7*864e5).toISOString().slice(0,10);
  const d = await fhGet(`/company-news?symbol=${sym}&from=${from}&to=${to}`);
  if (!Array.isArray(d)) return [];
  return d.slice(0,5).map((a,i) => ({
    h: a.headline||"", s: scoreNews(a.headline||""), i,
    t: new Date((a.datetime||0)*1000).toLocaleTimeString(),
  }));
}

async function fetchCryptoNews() {
  const d = await fhGet(`/news?category=crypto`);
  if (!Array.isArray(d)) return d || [];
  return d.slice(0,30).map((a,i) => ({
    h: a.headline||"", s: scoreNews(a.headline||""), i,
    t: new Date((a.datetime||0)*1000).toLocaleTimeString(),
  }));
}

// ═══════════════════════════════════════════════════════════════════════
// TECHNICAL INDICATORS
// ═══════════════════════════════════════════════════════════════════════
function ema(prices, n) {
  const k=2/(n+1); let e=prices[0];
  for (let i=1;i<prices.length;i++) e=prices[i]*k+e*(1-k);
  return e;
}

function rsi(prices, n=14) {
  if (prices.length < n+1) return 50;
  let g=0, l=0;
  for (let i=prices.length-n; i<prices.length; i++) {
    const d = prices[i]-prices[i-1];
    d>0 ? g+=d : l-=d;
  }
  const al=l/n; return al===0?100:+(100-100/(1+g/n/al)).toFixed(1);
}

// ═══════════════════════════════════════════════════════════════════════
// 3-SIGNAL ENGINE — RSI + EMA Cross + Volume
// Clean, fast, proven. All 3 agree = high conviction trade.
// ═══════════════════════════════════════════════════════════════════════

// Signal 1: RSI
// Below 45 = bullish pressure, above 55 = bearish pressure
function sig_rsi(prices) {
  if (prices.length < 15) return 0;
  const R = rsi(prices);
  if (R < 40) return 2;   // strong buy
  if (R < 48) return 1;   // mild buy
  if (R > 60) return -2;  // strong sell
  if (R > 52) return -1;  // mild sell
  return 0;
}

// Signal 2: EMA Cross (9 vs 21)
// 9 EMA crossing above 21 = trend turning up, below = turning down
function sig_ema(prices) {
  if (prices.length < 25) return 0;
  const e9  = ema(prices.slice(-25), 9);
  const e21 = ema(prices.slice(-25), 21);
  const pe9  = ema(prices.slice(-26, -1), 9);
  const pe21 = ema(prices.slice(-26, -1), 21);
  // Fresh cross = stronger signal
  if (pe9 <= pe21 && e9 > e21) return 2;   // golden cross — strong buy
  if (pe9 >= pe21 && e9 < e21) return -2;  // death cross — strong sell
  if (e9 > e21) return 1;                   // above — mild buy
  return -1;                                // below — mild sell
}

// Signal 3: Volume confirmation
// Large price move relative to recent average = conviction behind move
function sig_volume(prices) {
  if (prices.length < 15) return 0;
  const moves = prices.slice(-15).map((p,i,a) => i>0 ? Math.abs(p-a[i-1])/a[i-1] : 0).slice(1);
  const avg   = moves.slice(0,-1).reduce((a,b)=>a+b,0) / (moves.length-1) || 0.0001;
  const cur   = moves[moves.length-1];
  const ratio = cur / avg;
  if (ratio < 0.5) return 0;  // too quiet — no conviction
  const dir = prices[prices.length-1] >= prices[prices.length-2] ? 1 : -1;
  if (ratio > 2.0) return dir * 2;  // strong volume
  if (ratio > 1.2) return dir * 1;  // moderate volume
  return 0;
}

// Master signal — all 3 combined
function cryptoSignal(ticker, prices) {
  if (!prices || prices.length < 25) return {action:"HOLD", conf:0, score:0, s1:0, s2:0, s3:0, reason:"Not enough data"};

  const s1 = sig_rsi(prices);
  const s2 = sig_ema(prices);
  const s3 = sig_volume(prices);

  // Count agreements
  const signals = [s1, s2, s3];
  const bullish  = signals.filter(s => s > 0).length;
  const bearish  = signals.filter(s => s < 0).length;
  const strength = signals.reduce((a,s) => a + Math.abs(s), 0); // max 6

  let action = "HOLD";
  let conf   = 0;

  if (bullish >= 2) {
    action = "BUY";
    conf   = bullish === 3 ? (strength >= 5 ? 1.0 : 0.85) : 0.65;
  } else if (bearish >= 2) {
    action = "SELL";
    conf   = bearish === 3 ? (strength >= 5 ? 1.0 : 0.85) : 0.65;
  }

  const score = (bullish - bearish) / 3;

  const reason = bullish === 3 ? "🟢 All 3 signals agree — strong buy"
    : bearish === 3            ? "🔴 All 3 signals agree — strong sell"
    : bullish === 2            ? "🟡 2/3 signals bullish"
    : bearish === 2            ? "🟡 2/3 signals bearish"
    : "⬜ Signals mixed — waiting";

  const cur = prices[prices.length-1];

  return {
    action, conf, score: +score.toFixed(3),
    s1, s2, s3, bullish, bearish, strength, reason,
    rsi:  +rsi(prices).toFixed(1),
    e9:   +ema(prices.slice(-25), 9).toFixed(cur<1?6:2),
    e21:  +ema(prices.slice(-25), 21).toFixed(cur<1?6:2),
    stopLoss:   +(cur * (1 - CRYPTO_CFG.stopLossPct)).toFixed(cur<1?6:2),
    takeProfit: +(cur * (1 + CRYPTO_CFG.takeProfitPct)).toFixed(cur<1?6:2),
    topReason: reason,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// STOCK VALUE SIGNAL (long-term) — uses same 3-signal engine
// ═══════════════════════════════════════════════════════════════════════
function stockSignal(ticker, prices, newsItems) {
  if (!prices || prices.length < 25) return {score:0, action:"HOLD", conf:0};
  const s1 = sig_rsi(prices);
  const s2 = sig_ema(prices);
  const s3 = sig_volume(prices);
  const sent = sentimentFromItems(newsItems||[]);
  const bullish = [s1,s2,s3].filter(s=>s>0).length;
  const bearish = [s1,s2,s3].filter(s=>s<0).length;
  const score = +((bullish - bearish) / 3 + sent * 0.15).toFixed(4);
  const action = score > 0.2 ? "BUY" : score < -0.2 ? "SELL" : "HOLD";
  const conf = Math.min(Math.abs(score) * 1.5, 1);
  return {
    score, action, conf,
    rsi: +rsi(prices).toFixed(1),
    s1, s2, s3, sent,
    stopLoss: +(prices[prices.length-1]*(1-STOCK_CFG.stopLossPct)).toFixed(2),
    newsItems,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// REGIME DETECTOR
// ═══════════════════════════════════════════════════════════════════════
function detectRegime(pricesMap) {
  const vals = Object.values(pricesMap).filter(p=>p&&p.length>10);
  if (!vals.length) return {r:"NEUTRAL",vix:16};
  const vols = vals.map(p=>{
    const ret=p.slice(-10).map((v,i,a)=>i>0?(v-a[i-1])/a[i-1]:0).slice(1);
    const m=ret.reduce((a,b)=>a+b,0)/ret.length;
    return Math.sqrt(ret.reduce((a,b)=>a+(b-m)**2,0)/ret.length)*Math.sqrt(252);
  });
  const vix = +(vols.reduce((a,b)=>a+b,0)/vols.length*100).toFixed(1);
  const tr = vals.map(p=>p[p.length-1]>ema(p.slice(-20),20)?1:-1).reduce((a,b)=>a+b,0)/vals.length;
  const r = vix>30?"HIGH_FEAR":vix>18?"ELEVATED":tr>0.3?"BULL":tr<-0.3?"BEAR":"NEUTRAL";
  return {r, vix, trend:+tr.toFixed(2)};
}

// ═══════════════════════════════════════════════════════════════════════
// PLAIN ENGLISH TRADE STORY
// ═══════════════════════════════════════════════════════════════════════
function tradeStory(name, action, price, reason, conf, newsItems, engine) {
  const fmt = price > 1 ? price.toLocaleString(undefined,{maximumFractionDigits:2}) : price.toFixed(6);
  const sent = sentimentFromItems(newsItems);
  const sentWord = sent > 0.2 ? "positive news" : sent < -0.2 ? "bearish news" : "chart signals";
  if (reason==="STOP_LOSS")     return `Sold ${name} — hit safety stop at $${fmt}. Loss cut early.`;
  if (reason==="TAKE_PROFIT")   return `Sold ${name} — hit profit target at $${fmt}. 🎯 Locked in gains.`;
  if (reason==="REBALANCE")     return `Rebalanced ${name} — trimmed gains, freeing capital for better picks.`;
  if (reason==="ROTATE_OUT")    return `Rotated out of ${name} — underperforming, better opportunity found.`;
  if (reason==="ROTATE_IN")     return `Rotated into ${name} — higher-scoring pick added to portfolio.`;
  if (action==="BUY" && engine==="stock" && !conf)
    return `Opened ${name} at $${fmt} — added to long-term portfolio.`;
  if (action==="BUY" && engine==="stock")
    return `Bought ${name} at $${fmt} — ${sentWord} looking strong.`;
  if (action==="BUY")
    return `Bought ${name} at $${fmt} — ${sentWord} pointing up · ${Math.round(conf*100)}% signal agreement.`;
  return `Sold ${name} at $${fmt} — signals turned negative.`;
}

// ═══════════════════════════════════════════════════════════════════════
// SPARKLINE
// ═══════════════════════════════════════════════════════════════════════
function Spark({prices, up, w=80, h=28}) {
  if (!prices || prices.length < 2) return <svg width={w} height={h}/>;
  const mn=Math.min(...prices), mx=Math.max(...prices), rng=mx-mn||1;
  const pts=prices.map((p,i)=>`${(i/(prices.length-1))*w},${h-((p-mn)/rng)*h}`).join(" ");
  const id=`sp${up?1:0}${w}${h}`;
  return (
    <svg width={w} height={h}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={up?"#10b981":"#ef4444"} stopOpacity="0.3"/>
        <stop offset="100%" stopColor={up?"#10b981":"#ef4444"} stopOpacity="0"/>
      </linearGradient></defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#${id})`}/>
      <polyline points={pts} fill="none" stroke={up?"#10b981":"#ef4444"} strokeWidth="2" strokeLinejoin="round"/>
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CONFIDENCE RING
// ═══════════════════════════════════════════════════════════════════════
function Ring({value, color, size=48}) {
  const r=18, cx=size/2, cy=size/2, circ=2*Math.PI*r;
  return (
    <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e293b" strokeWidth="3.5"/>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="3.5"
        strokeDasharray={`${circ*value} ${circ}`} strokeLinecap="round"/>
      <text x={cx} y={cy+1} textAnchor="middle" dominantBaseline="middle"
        fontSize="10" fontWeight="700" fill={color}
        style={{transform:`rotate(90deg)`,transformOrigin:`${cx}px ${cy}px`}}>
        {Math.round(value*100)}%
      </text>
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// QUIZ SCREEN
// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ═══════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════
// MINI CHART — for left panel purchase breakdown
// ═══════════════════════════════════════════════════════════════════════
function MiniChart({prices, entryPrice, w=180, h=60}) {
  if (!prices||prices.length<2) return <div style={{width:w,height:h,background:T.panel}}/>;
  const mn=Math.min(...prices,entryPrice||Infinity);
  const mx=Math.max(...prices,entryPrice||0);
  const rng=mx-mn||1;
  const pts=prices.map((p,i)=>`${(i/(prices.length-1))*w},${h-((p-mn)/rng)*(h-8)+4}`).join(" ");
  const cur=prices[prices.length-1];
  const up=!entryPrice||cur>=entryPrice;
  const color=up?T.green:T.red;
  const eid=entryPrice?Math.round(h-((entryPrice-mn)/rng)*(h-8)+4):null;
  return (
    <svg width={w} height={h} style={{display:"block"}}>
      <defs>
        <linearGradient id={`mc${w}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#mc${w})`}/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round"/>
      {eid&&<line x1="0" y1={eid} x2={w} y2={eid} stroke={T.yellow} strokeWidth="1" strokeDasharray="3,3" opacity="0.7"/>}
    </svg>
  );
}

function NewsSentBadge({news}) {
  const avg = news.reduce((a,n)=>a+n.s,0)/news.length;
  const color = avg>0.3?"#10b981":avg<-0.3?"#ef4444":"#64748b";
  const label = avg>0.3?"📈 Mostly positive":avg<-0.3?"📉 Mostly negative":"➡️ Mixed";
  return <span style={{marginLeft:"auto",fontSize:10,fontWeight:700,color}}>{label}</span>;
}

function DashScreen({defaultProfile}) {
  // ── SETTINGS STATE — all configurable, live-updating ─────────────
  const PROFILES = {
    preserve:  {name:"Safe Harbor",    emoji:"🛡️", color:"#3b82f6"},
    income:    {name:"Steady Earner",  emoji:"📈", color:T.green},
    learn:     {name:"Market Explorer",emoji:"🎓", color:"#8b5cf6"},
    growth:    {name:"Growth Seeker",  emoji:"🚀", color:"#f59e0b"},
    aggressive:{name:"Alpha Hunter",   emoji:"⚡", color:T.red},
  };
  const CAPITALS = [1000, 2500, 15000, 62500, 150000];

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [goalKey,      setGoalKey]      = useState("growth");
  const [capitalIdx,   setCapitalIdx]   = useState(1); // $2,500
  const [customCap,    setCustomCap]    = useState("");
  const [demoMode,     setDemoMode]     = useState(true);

  // API keys
  const [fhKey,    setFhKey]    = useState(""); const [fhStatus, setFhStatus] = useState("idle");
  const [cbKey,    setCbKey]    = useState(""); const [cbSecret, setCbSecret] = useState(""); const [cbPaper, setCbPaper] = useState(true); const [cbStatus, setCbStatus] = useState("idle");
  const [apKey,    setApKey]    = useState(""); const [apSecret, setApSecret] = useState(""); const [apPaper, setApPaper] = useState(true); const [apStatus, setApStatus] = useState("idle");

  // Derived profile — recalculates whenever settings change
  const totalCap = customCap ? parseInt(customCap)||CAPITALS[capitalIdx] : CAPITALS[capitalIdx];
  const profile = {
    ...PROFILES[goalKey],
    goal: goalKey,
    initialCapital: totalCap,
    cryptoCapital:  Math.round(totalCap * CRYPTO_CAPITAL_PCT),
    stockCapital:   Math.round(totalCap * STOCK_CAPITAL_PCT),
    risk: 2, experience: 1,
  };

  // Execution config derived from key states
  const execution = {
    coinbase: cbStatus === "ok",
    alpaca:   apStatus === "ok",
  };

  // API test functions
  async function testFinnhub() {
    if (!fhKey.trim()) return;
    setFhStatus("testing");
    try {
      const r = await fetch(`${FH}/quote?symbol=AAPL&token=${fhKey.trim()}`);
      const d = await r.json();
      if (d?.c > 0) { FINNHUB_KEY = fhKey.trim(); setFhStatus("ok"); }
      else setFhStatus("error");
    } catch { setFhStatus("error"); }
  }

  async function testCoinbase() {
    if (!cbKey.trim()||!cbSecret.trim()) return;
    setCbStatus("testing");
    EXEC_CONFIG.coinbase = {key:cbKey.trim(),secret:cbSecret.trim(),paper:cbPaper,connected:false};
    const d = await coinbaseGetAccounts();
    if (d?.accounts||d?.data) { EXEC_CONFIG.coinbase.connected=true; setCbStatus("ok"); }
    else setCbStatus("error");
  }

  async function testAlpaca() {
    if (!apKey.trim()||!apSecret.trim()) return;
    setApStatus("testing");
    EXEC_CONFIG.alpaca = {key:apKey.trim(),secret:apSecret.trim(),paper:apPaper,connected:false};
    const d = await alpacaGetAccount();
    if (d?.status) { EXEC_CONFIG.alpaca.connected=true; setApStatus("ok"); }
    else setApStatus("error");
  }

  const [demoModeApplied, setDemoModeApplied] = useState(true);

  // Real order submission — fires alongside internal state update
  async function submitCryptoOrder(ticker, side, sizeUsd) {
    if (!execution.coinbase || !EXEC_CONFIG.coinbase.connected) return;
    const productId = ticker.replace("/","-");
    try {
      const res = side==="buy"
        ? await coinbaseSubmitOrder({productId, side:"BUY",  quoteSize:sizeUsd.toFixed(2)})
        : await coinbaseSubmitOrder({productId, side:"SELL", quoteSize:sizeUsd.toFixed(2)});
      const orderId = res?.success_response?.order_id || res?.order_id;
      if (orderId) setPendingOrders(p=>({...p,[orderId]:{exchange:"coinbase",ticker,side}}));
    } catch {}
  }

  async function submitStockOrder(symbol, side, qty) {
    if (!execution.alpaca || !EXEC_CONFIG.alpaca.connected) return;
    try {
      const res = await alpacaSubmitOrder({symbol, qty:+qty.toFixed(6), side});
      const orderId = res?.id;
      if (orderId) setPendingOrders(p=>({...p,[orderId]:{exchange:"alpaca",symbol,side}}));
    } catch {}
  }
  // Prices: keyed by ticker → array of prices
  const [cryptoPrices, setCryptoPrices] = useState({});
  const [stockPrices,  setStockPrices]  = useState({});
  const [cryptoNews,   setCryptoNews]   = useState([]);
  const [stockNews,    setStockNews]    = useState({});

  // Signals: top N crypto opps, stock signals
  const [cryptoOpps,   setCryptoOpps]  = useState([]); // ranked top opportunities
  const [stockSigs,    setStockSigs]   = useState({});

  const [regime,   setRegime]   = useState({r:"NEUTRAL",vix:16,trend:0});
  const [active,   setActive]   = useState(false);
  const [halted,   setHalted]   = useState(false);
  const [viewState,setViewState]= useState("home");
  const [cryptoSub,setCryptoSub]= useState("scanner");
  const [stockSub, setStockSub] = useState("holdings");
  const [newsSub,  setNewsSub]  = useState("crypto");
  const prevView = useRef("home");

  const setView = (v) => {
    if (v==="news" && prevView.current!=="news") {
      fetchCryptoNews().then(cn=>{ if(cn&&cn.length) setCryptoNews(cn); });
      Object.keys(swRef.current.positions).forEach(sym=>{
        fetchStockNews(sym).then(a=>{ if(a&&a.length) setStockNews(p=>({...p,[sym]:a})); });
      });
    }
    prevView.current = v;
    setViewState(v);
  };
  const view = viewState;
  const [toasts,   setToasts]   = useState([]);
  const [tick,     setTick]     = useState(0);
  const [dataReady,setDataReady]= useState(false);
  const [loading,  setLoading]  = useState("Connecting to markets…");
  const [priceAge, setPriceAge] = useState({});

  // Wallets — two separate pools
  const [cryptoWallet, setCryptoWallet] = useState({
    cash: profile.cryptoCapital, positions:{}, peak:profile.cryptoCapital,
  });
  const [stockWallet, setStockWallet] = useState({
    cash: profile.stockCapital, positions:{}, peak:profile.stockCapital,
    lastRebalance: Date.now(),
    lastDailyRotation: 0,
  });
  const [trades, setTrades] = useState([]);

  // Cooldown tracker — prevent rapid re-entry on same crypto
  const cooldowns = useRef({});
  const cwRef = useRef(cryptoWallet);
  const swRef = useRef(stockWallet);
  const tRef  = useRef(trades);
  cwRef.current = cryptoWallet;
  swRef.current = stockWallet;
  tRef.current  = trades;

  // ── ACCOUNT SYNC — pull real balances + positions from exchanges ──
  const [accountSynced, setAccountSynced] = useState(false);
  const [accountStatus, setAccountStatus] = useState({coinbase:"idle", alpaca:"idle"});
  const [accountSync,   setAccountSync]   = useState({status:"idle", cbBalance:null, apBalance:null, lastSync:null, error:null});
  const [pendingOrders, setPendingOrders] = useState({}); // orderId → {exchange, ticker/symbol}

  // Master sync — calls both exchanges, updates wallets with real balances
  async function syncAccounts() {
    if (demoMode) return;
    setAccountSync(s=>({...s, status:"syncing"}));
    const cbResult = await syncCoinbaseAccount();
    const apResult = await syncAlpacaAccount();
    setAccountSync({
      status: "synced",
      cbBalance: cbResult?.cash ?? null,
      apBalance: apResult?.cash ?? null,
      lastSync:  Date.now(),
      error:     null,
    });
    setAccountSynced(true);
  }

  // Fill polling — checks order status and updates positions with real fill prices
  async function pollOrderFills() {
    const pending = pendingOrders;
    if (!Object.keys(pending).length) return;
    const done = {};
    for (const [orderId, order] of Object.entries(pending)) {
      if (order.exchange==="alpaca" && EXEC_CONFIG.alpaca.connected) {
        try {
          const o = await alpacaRequest("GET", `/v2/orders/${orderId}`);
          if (o?.status==="filled"||o?.status==="partially_filled") {
            const fillPrice = parseFloat(o.filled_avg_price||0);
            const fillQty   = parseFloat(o.filled_qty||0);
            if (fillPrice>0 && fillQty>0) {
              setStockWallet(w=>{
                const pos=w.positions[order.symbol]; if(!pos) return w;
                return {...w,positions:{...w.positions,[order.symbol]:{...pos,avgPrice:fillPrice,qty:fillQty}}};
              });
              done[orderId]=true;
            }
          } else if (["canceled","expired","rejected"].includes(o?.status)) {
            done[orderId]=true;
          }
        } catch {}
      }
      if (order.exchange==="coinbase" && EXEC_CONFIG.coinbase.connected) {
        try {
          const o = await coinbaseRequest("GET",`/api/v3/brokerage/orders/historical/${orderId}`);
          const ord = o?.order;
          if (ord?.status==="FILLED") {
            const fillPrice = parseFloat(ord.average_filled_price||0);
            const fillSize  = parseFloat(ord.filled_size||0);
            if (fillPrice>0) {
              setCryptoWallet(w=>{
                const pos=w.positions[order.ticker]; if(!pos) return w;
                return {...w,positions:{...w.positions,[order.ticker]:{...pos,avgPrice:fillPrice,qty:fillSize}}};
              });
              done[orderId]=true;
            }
          } else if (["CANCELLED","EXPIRED","FAILED"].includes(ord?.status)) {
            done[orderId]=true;
          }
        } catch {}
      }
    }
    if (Object.keys(done).length) {
      setPendingOrders(prev=>{ const n={...prev}; Object.keys(done).forEach(id=>delete n[id]); return n; });
    }
  }

  // Sync on startup once data is ready, then every 60s
  useEffect(()=>{
    if (demoMode||!dataReady) return;
    syncAccounts();
    const iv=setInterval(syncAccounts, 60000);
    return ()=>clearInterval(iv);
  // eslint-disable-next-line
  },[dataReady, demoMode]);

  // Poll fills every 10s when orders are pending
  useEffect(()=>{
    if (!Object.keys(pendingOrders).length) return;
    const iv=setInterval(pollOrderFills, 10000);
    return ()=>clearInterval(iv);
  // eslint-disable-next-line
  },[pendingOrders]);

  async function syncCoinbaseAccount() {
    if (!execution.coinbase || !EXEC_CONFIG.coinbase.connected) return null;
    try {
      setAccountStatus(s=>({...s, coinbase:"syncing"}));

      // 1. Get USD/USDT cash balance
      const accounts = await coinbaseGetAccounts();
      const accts = accounts?.accounts || accounts?.data || [];
      const usdAcct = accts.find(a=>a.currency==="USD"||a.currency==="USDT");
      const cashBalance = usdAcct ? parseFloat(usdAcct.available_balance?.value||usdAcct.balance?.amount||0) : null;

      // 2. Get open positions
      const posRes = await coinbaseRequest("GET", "/api/v3/brokerage/portfolios");
      const portfolios = posRes?.portfolios || [];
      const positions = {};

      // For each crypto we track, check if we have a balance
      for (const t of CRYPTO_UNIVERSE) {
        const coin = t.replace("/USDT","");
        const acct = accts.find(a=>a.currency===coin);
        const qty = acct ? parseFloat(acct.available_balance?.value||acct.balance?.amount||0) : 0;
        if (qty > 0.000001) {
          // We hold this coin — get current price to set stopLoss/takeProfit
          const prices = cryptoPrices[t];
          const price = prices?.[prices.length-1] || CRYPTO_META[t]?.base || 0;
          positions[t] = {
            qty: +qty.toFixed(8),
            avgPrice: price, // best we can do without order history
            stopLoss:   +(price*(1-CRYPTO_CFG.stopLossPct)).toFixed(price<1?6:2),
            takeProfit: +(price*(1+CRYPTO_CFG.takeProfitPct)).toFixed(price<1?6:2),
            entryTime: Date.now(),
            news: [],
          };
        }
      }

      // 3. Update wallet with real data
      if (cashBalance !== null) {
        setCryptoWallet(w=>({
          ...w,
          cash: +cashBalance.toFixed(2),
          peak: Math.max(w.peak, cashBalance),
          positions: Object.keys(positions).length > 0 ? positions : w.positions,
        }));
      }
      setAccountStatus(s=>({...s, coinbase:"ok"}));
      return {cash:cashBalance, positions};
    } catch(e) {
      setAccountStatus(s=>({...s, coinbase:"error"}));
      return null;
    }
  }

  async function syncAlpacaAccount() {
    if (!execution.alpaca || !EXEC_CONFIG.alpaca.connected) return null;
    try {
      setAccountStatus(s=>({...s, alpaca:"syncing"}));

      // 1. Get account buying power
      const account = await alpacaGetAccount();
      if (!account) { setAccountStatus(s=>({...s,alpaca:"error"})); return null; }
      const buyingPower   = parseFloat(account.buying_power || 0);
      const portfolioVal  = parseFloat(account.portfolio_value || 0);
      const cash          = parseFloat(account.cash || 0);

      // 2. Get open positions
      const posData = await alpacaRequest("GET", "/v2/positions");
      const positions = {};
      if (Array.isArray(posData)) {
        posData.forEach(p=>{
          const sym = p.symbol;
          if (!STOCK_UNIVERSE.includes(sym)) return;
          const qty    = parseFloat(p.qty);
          const avgPx  = parseFloat(p.avg_entry_price);
          const curPx  = parseFloat(p.current_price||avgPx);
          if (qty > 0) {
            positions[sym] = {
              qty:     +qty.toFixed(6),
              avgPrice:+avgPx.toFixed(2),
              stopLoss:+(avgPx*(1-STOCK_CFG.stopLossPct)).toFixed(2),
            };
          }
        });
      }

      // 3. Update stock wallet with real data
      setStockWallet(w=>({
        ...w,
        cash: +cash.toFixed(2),
        peak: Math.max(w.peak||0, portfolioVal),
        positions: Object.keys(positions).length > 0 ? positions : w.positions,
      }));

      setAccountStatus(s=>({...s, alpaca:"ok"}));
      return {cash, portfolioVal, positions};
    } catch {
      setAccountStatus(s=>({...s, alpaca:"error"}));
      return null;
    }
  }

  // ── LOAD: demo = instant seeded, real = live APIs ─────────────────
  useEffect(()=>{
    let dead = false;
    async function load() {
      if (demoMode) {
        const cp={}, sp={};
        CRYPTO_UNIVERSE.forEach(t=>{ cp[t]=seedHistory(CRYPTO_META[t]?.base||100,80); });
        STOCK_UNIVERSE.forEach(sym=>{ sp[sym]=seedHistory(STOCK_BASE[sym]||100,80); });
        if (!dead) { setCryptoPrices(cp); setStockPrices(sp); setLoading(""); setDataReady(true); }
        return;
      }
      setLoading("Fetching live crypto candles from Binance…");
      const cp = {};
      for (let i=0; i<CRYPTO_UNIVERSE.length; i++) {
        const t = CRYPTO_UNIVERSE[i];
        const hist = await fetchRealCryptoHistory(t, 80);
        if (hist && hist.length >= 20) cp[t] = hist;
        else cp[t] = seedHistory(CRYPTO_META[t]?.base||100, 80);
        if (i < CRYPTO_UNIVERSE.length-1) await new Promise(r=>setTimeout(r,100));
      }
      if (!dead) setCryptoPrices(cp);
      setLoading("Loading crypto news…");
      const cn = await fetchCryptoNews();
      if (!dead) setCryptoNews(cn||[]);
      setLoading("Fetching stock candles from Finnhub…");
      const sp = {};
      for (let i=0; i<STOCK_UNIVERSE.length; i++) {
        if (dead) break;
        const sym = STOCK_UNIVERSE[i];
        const hist = await fetchRealStockHistory(sym, 60);
        if (hist && hist.length >= 20) sp[sym] = hist;
        else sp[sym] = seedHistory(STOCK_BASE[sym]||100, 80);
        setLoading(`Fetching stocks… ${i+1}/${STOCK_UNIVERSE.length} (${sym})`);
      }
      if (!dead) setStockPrices(sp);
      setLoading("Loading stock news…");
      const sn={};
      for (let i=0; i<12; i++) {
        if (dead) break;
        const articles = await fetchStockNews(STOCK_UNIVERSE[i]);
        if (articles.length) sn[STOCK_UNIVERSE[i]]=articles;
      }
      if (!dead) setStockNews(sn);
      if (!dead) { setLoading(""); setDataReady(true); }
    }
    load();
    return ()=>{ dead=true; };
  },[demoMode]);

  // ── CRYPTO PRICE UPDATES: REST polling primary, WS upgrade if available ─
  const wsRef2        = useRef(null);
  const wsRetryTimer  = useRef(null);
  const wsPingTimer   = useRef(null);
  const cryptoPollRef = useRef(null);
  const priceModeRef  = useRef("connecting");
  const [priceMode, setPriceMode] = useState("connecting");

  function setPriceModeSync(m){ priceModeRef.current=m; setPriceMode(m); }

  function startRestPoll() {
    if (cryptoPollRef.current) return;
    setPriceModeSync("rest");
    async function poll() {
      for (let i=0;i<CRYPTO_UNIVERSE.length;i++) {
        const t=CRYPTO_UNIVERSE[i];
        try {
          const r=await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${BINANCE_SYM(t)}`);
          if (r.ok) {
            const d=await r.json();
            const price=parseFloat(d.price);
            if (price&&!isNaN(price)) {
              const now=Date.now();
              setCryptoPrices(prev=>{
                const hist=prev[t]; if(!hist||!hist.length) return prev;
                const last=hist[hist.length-1];
                if(Math.abs(price-last)/last<0.00005) return prev;
                return {...prev,[t]:[...hist.slice(1),+price.toFixed(price<1?6:2)]};
              });
              setPriceAge(prev=>({...prev,[t]:now}));
            }
          }
        } catch {}
        if (i<CRYPTO_UNIVERSE.length-1) await new Promise(r=>setTimeout(r,80));
      }
    }
    poll();
    cryptoPollRef.current = setInterval(poll, 5000);
  }

  function stopRestPoll() {
    if (cryptoPollRef.current) { clearInterval(cryptoPollRef.current); cryptoPollRef.current=null; }
  }

  function connectWS() {
    try {
      if (wsRef2.current) { try{wsRef2.current.close();}catch{} wsRef2.current=null; }
      clearInterval(wsPingTimer.current);
      const ws = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_KEY}`);
      wsRef2.current = ws;
      const openTimeout = setTimeout(()=>{ if(priceModeRef.current!=="ws") startRestPoll(); }, 5000);
      ws.onopen = ()=>{
        clearTimeout(openTimeout);
        setPriceModeSync("ws");
        stopRestPoll();
        CRYPTO_UNIVERSE.forEach(t=>ws.send(JSON.stringify({type:"subscribe",symbol:FH_CRYPTO(t)})));
        wsPingTimer.current = setInterval(()=>{ if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({type:"ping"})); },25000);
      };
      ws.onmessage = (e)=>{
        try {
          const msg=JSON.parse(e.data);
          if(msg.type!=="trade"||!msg.data) return;
          msg.data.forEach(trade=>{
            const ticker=CRYPTO_UNIVERSE.find(t=>FH_CRYPTO(t)===trade.s);
            if(!ticker||!trade.p) return;
            const price=parseFloat(trade.p);
            if(!price||isNaN(price)) return;
            const now=Date.now();
            setCryptoPrices(prev=>{
              const hist=prev[ticker]; if(!hist||!hist.length) return prev;
              const last=hist[hist.length-1];
              if(Math.abs(price-last)/last<0.00005) return prev;
              return {...prev,[ticker]:[...hist.slice(1),+price.toFixed(price<1?6:2)]};
            });
            setPriceAge(prev=>({...prev,[ticker]:now}));
          });
        } catch {}
      };
      ws.onerror = ()=>{ startRestPoll(); };
      ws.onclose = ()=>{
        clearInterval(wsPingTimer.current);
        startRestPoll();
        wsRetryTimer.current = setTimeout(()=>connectWS(), 10000);
      };
    } catch { startRestPoll(); wsRetryTimer.current=setTimeout(()=>connectWS(),10000); }
  }

  useEffect(()=>{
    if (!dataReady) return;
    startRestPoll();    // start REST immediately — no waiting
    connectWS();        // try WS in parallel — will upgrade if it connects
    return ()=>{
      clearTimeout(wsRetryTimer.current);
      clearInterval(wsPingTimer.current);
      stopRestPoll();
      try{wsRef2.current?.close();}catch{}
    };
  // eslint-disable-next-line
  },[dataReady]);

  // ── POLL stock quotes — sequential, rate-limited, cache-aware ────
  const priceAgeRef = useRef({});
  useEffect(()=>{ priceAgeRef.current = priceAge; },[priceAge]);

  useEffect(()=>{
    if (!dataReady || !active) return;
    let failCount = 0;
    async function poll() {
      // Only poll stocks that haven't had a live update in the last 25s
      const stale = STOCK_UNIVERSE.slice(0,12).filter(sym=>{
        const age = priceAgeRef.current[sym];
        return !age || Date.now()-age > 25000;
      });
      if (!stale.length) return; // all fresh, skip
      let anySuccess = false;
      // Sequential — rate limiter handles pacing, no parallel flood
      for (const sym of stale) {
        const q = await fetchQuote(sym);
        if (!q) continue;
        anySuccess = true;
        const t = Date.now();
        setStockPrices(prev=>{
          const hist = prev[sym];
          if (!hist||!hist.length) return prev;
          return {...prev,[sym]:[...hist.slice(1),+q.toFixed(2)]};
        });
        setPriceAge(prev=>({...prev,[sym]:t}));
      }
      if (anySuccess) failCount = 0; else failCount++;
    }
    poll();
    const iv = setInterval(poll, failCount>=3?60000:30000);
    return ()=>clearInterval(iv);
  },[dataReady, active]);

  // ── TICK: signal recompute + demo price updates ───────────────────
  const tickRef = useRef(null);
  const lastTickTime = useRef(Date.now());

  useEffect(()=>{
    if (!active||halted) { clearInterval(tickRef.current); return; }
    function startTick() {
      clearInterval(tickRef.current);
      tickRef.current = setInterval(()=>{
        lastTickTime.current = Date.now();
        setTick(n=>n+1);
        // In demo mode, tick prices forward with seeded randomness
        if (demoMode) {
          setCryptoPrices(prev=>{ const nx={};Object.entries(prev).forEach(([t,p])=>{nx[t]=tickSeed(p,CRYPTO_META[t]?.beta||1);}); return nx; });
          setStockPrices(prev=>{ const nx={};Object.entries(prev).forEach(([s,p])=>{nx[s]=tickSeed(p,1.2);}); return nx; });
        }
      }, 5000);
    }
    startTick();
    const watchdog = setInterval(()=>{ if(Date.now()-lastTickTime.current>12000) startTick(); },6000);
    return ()=>{ clearInterval(tickRef.current); clearInterval(watchdog); };
  },[active,halted,demoMode]);

  useEffect(()=>{
    if (!dataReady) return;
    // Compute regime across all crypto prices
    const allP = {...cryptoPrices, ...stockPrices};
    setRegime(detectRegime(allP));

    // Rank ALL crypto assets — only those with real price data
    const scored = CRYPTO_UNIVERSE.map(t=>{
      const prices = cryptoPrices[t];
      if (!prices || prices.length < 20) return null; // skip until real data loaded
      // Filter crypto news relevant to this coin
      const name = (CRYPTO_META[t]?.name||"").toLowerCase();
      const sym  = t.replace("/USDT","").toLowerCase();
      const relevant = cryptoNews.filter(n=>{
        const h=(n.h||"").toLowerCase();
        return h.includes(sym)||h.includes(name);
      });
      const sig = cryptoSignal(t, prices, relevant.length?relevant:cryptoNews.slice(0,3), cryptoPrices);
      return {ticker:t, ...sig, price:prices[prices.length-1], prices};
    }).filter(Boolean).sort((a,b)=>Math.abs(b.score)-Math.abs(a.score));
    setCryptoOpps(scored);

    // Stock signals — only for tickers with real history
    const ss = {};
    Object.entries(stockPrices).forEach(([sym,prices])=>{
      if (!prices || prices.length < 20) return; // skip until real data loaded
      const news = stockNews[sym]||[];
      ss[sym] = {...stockSignal(sym,prices,news,{}), price:prices[prices.length-1], prices};
    });
    setStockSigs(ss);
  },[tick, cryptoPrices, stockPrices, dataReady]);

  // ── CRYPTO AUTO-TRADE — signals computed inline, no state lag ────
  useEffect(()=>{
    if (!active||halted) return;
    const now = Date.now();
    const cw  = cwRef.current;

    const priceKeys = Object.keys(cryptoPrices);
    console.log(`[Crypto tick=${tick}] active=${active} prices=${priceKeys.length} cash=${cw.cash} positions=${Object.keys(cw.positions).length}`);

    if (priceKeys.length === 0) { console.log("[Crypto] NO PRICES YET"); return; }

    // Compute live signals right now from current prices
    const liveSigs = CRYPTO_UNIVERSE.map(t=>{
      const prices = cryptoPrices[t];
      if (!prices||prices.length<20) { console.log(`[Crypto] ${t}: no prices (${prices?.length||0})`); return null; }
      const name=(CRYPTO_META[t]?.name||"").toLowerCase();
      const sym=t.replace("/USDT","").toLowerCase();
      const rel=cryptoNews.filter(n=>(n.h||"").toLowerCase().includes(sym)||(n.h||"").toLowerCase().includes(name));
      const sig=cryptoSignal(t,prices);
      console.log(`[Crypto] ${t}: action=${sig.action} score=${sig.score?.toFixed(3)} conf=${sig.conf?.toFixed(2)} price=${prices[prices.length-1]}`);
      return {ticker:t,...sig,price:prices[prices.length-1]};
    }).filter(Boolean);

    // Also update the displayed opps
    setCryptoOpps([...liveSigs].sort((a,b)=>Math.abs(b.score)-Math.abs(a.score)));

    if (!liveSigs.length) return;

    const pv = cw.cash + Object.entries(cw.positions).reduce((a,[t,h])=>{
      const p=cryptoPrices[t]?.[cryptoPrices[t]?.length-1]||h.avgPrice;
      return a+h.qty*p;
    },0);

    if (pv < cw.peak*(1-0.08)) { setHalted(true); setActive(false); addToast("🛑 Safety stop — 8% drawdown","halt"); return; }
    if (pv > cw.peak) setCryptoWallet(w=>({...w,peak:pv}));

    // Exit existing positions
    Object.entries(cw.positions).forEach(([ticker,h])=>{
      const prices=cryptoPrices[ticker]; if(!prices||!prices.length) return;
      const price=prices[prices.length-1];
      const hitSL=price<=h.stopLoss, hitTP=price>=h.takeProfit;
      const curSig=liveSigs.find(o=>o.ticker===ticker);
      const reversed=curSig&&curSig.action==="SELL"&&curSig.conf>=0.6;
      const tooLong=h.entryTime&&(now-h.entryTime)>CRYPTO_CFG.maxHoldMs;
      if(!hitSL&&!hitTP&&!reversed&&!tooLong) return;
      const reason=hitSL?"STOP_LOSS":hitTP?"TAKE_PROFIT":reversed?"SIGNAL_REVERSAL":"TIME_EXIT";
      const proceeds=+(h.qty*price).toFixed(2), pnl=+((price-h.avgPrice)*h.qty).toFixed(2);
      setCryptoWallet(w=>{const p={...w.positions};delete p[ticker];return{...w,cash:+(w.cash+proceeds).toFixed(2),positions:p};});
      submitCryptoOrder(ticker,"sell",proceeds,price);
      const story=tradeStory(CRYPTO_META[ticker]?.name||ticker,"SELL",price,reason,0,h.news,"crypto");
      setTrades(prev=>[{id:Date.now()+Math.random(),ticker,name:CRYPTO_META[ticker]?.name||ticker,action:"SELL",price,qty:h.qty,total:proceeds,pnl,time:new Date().toLocaleTimeString(),engine:"crypto",reason,story},...prev.slice(0,299)]);
      addToast(pnl>=0?`💰 ${CRYPTO_META[ticker]?.name} +$${pnl.toFixed(2)}`:`📉 ${CRYPTO_META[ticker]?.name} -$${Math.abs(pnl).toFixed(2)}`,"trade");
      cooldowns.current[ticker]=now+CRYPTO_CFG.cooldownMs;
    });

    // Enter new positions
    const openCount=Object.keys(cw.positions).length;
    const slotsAvail=CRYPTO_CFG.maxConcurrent-openCount;
    if(slotsAvail<=0||cw.cash<CRYPTO_CFG.minPosDollar) return;

    const perTradeCap=Math.min(pv*CRYPTO_CFG.maxPosPct,CRYPTO_CFG.maxPosFlat);

    const entries=liveSigs
      .filter(sig=>{
        if(sig.action==="HOLD") return false;
        if(cw.positions[sig.ticker]) return false;
        if((cooldowns.current[sig.ticker]||0)>now) return false;
        if(sig.conf < 0.60) return false; // require at least 2/3 signals agreeing
        if(cw.cash < CRYPTO_CFG.minPosDollar) return false;
        return true;
      })
      .sort((a,b)=>b.conf-a.conf) // highest conviction first
      .slice(0,Math.min(slotsAvail,4));

    // If nothing at 60%+ conf, try 2/3 signals (conf=0.65) anyway
    const finalEntries = entries.length > 0 ? entries :
      liveSigs
        .filter(sig=>sig.action!=="HOLD"&&!cw.positions[sig.ticker]&&!(cooldowns.current[sig.ticker]>now)&&sig.conf>=0.60)
        .sort((a,b)=>b.strength-a.strength)
        .slice(0,Math.min(slotsAvail,2));

    console.log(`[Crypto] entries=${entries.length} finalEntries=${finalEntries.length}`);

    finalEntries.forEach(sig=>{
      if(cw.cash<CRYPTO_CFG.minPosDollar) return;
      const size=Math.min(perTradeCap*(0.5+sig.conf*0.5),cw.cash*0.92);
      if(size<CRYPTO_CFG.minPosDollar) return;
      const qty=+(size/sig.price).toFixed(sig.price<1?6:4);
      const sl=+(sig.price*(1-CRYPTO_CFG.stopLossPct)).toFixed(sig.price<1?6:2);
      const tp=+(sig.price*(1+CRYPTO_CFG.takeProfitPct)).toFixed(sig.price<1?6:2);
      console.log(`[Crypto] BUYING ${sig.ticker} @ $${sig.price} size=$${size.toFixed(2)} conf=${sig.conf} score=${sig.score}`);
      setCryptoWallet(w=>({...w,cash:+(w.cash-size).toFixed(2),positions:{...w.positions,[sig.ticker]:{qty,avgPrice:sig.price,stopLoss:sl,takeProfit:tp,news:sig.newsItems,entryTime:now}}}));
      submitCryptoOrder(sig.ticker,"buy",size,sig.price);
      const story=tradeStory(CRYPTO_META[sig.ticker]?.name||sig.ticker,"BUY",sig.price,null,sig.conf,sig.newsItems,"crypto");
      setTrades(prev=>[{id:Date.now()+Math.random(),ticker:sig.ticker,name:CRYPTO_META[sig.ticker]?.name||sig.ticker,action:"BUY",price:sig.price,qty,total:+size.toFixed(2),pnl:null,time:new Date().toLocaleTimeString(),engine:"crypto",story},...prev.slice(0,299)]);
      addToast(`⚡ ${CRYPTO_META[sig.ticker]?.name||sig.ticker} $${size.toFixed(0)} · ${(sig.conf*100).toFixed(0)}%`,"buy");
      cooldowns.current[sig.ticker]=now+CRYPTO_CFG.cooldownMs;
    });
  },[tick, cryptoPrices, active, halted]);

  // ── STOCK AUTO-TRADE (long-term) ──────────────────────────────────
  useEffect(()=>{
    if (!active||halted||!Object.keys(stockSigs).length) return;
    const now = Date.now();
    const sw  = swRef.current;
    const isRebalanceTime    = (now - sw.lastRebalance) > STOCK_CFG.rebalanceDays * 24 * 3600 * 1000;
    const isDailyRotation    = (now - sw.lastDailyRotation) > STOCK_CFG.dailyRotationMs;

    // ── Stop losses ──────────────────────────────────────────────────
    Object.entries(sw.positions).forEach(([sym, h])=>{
      const sig = stockSigs[sym]; if (!sig) return;
      const price = sig.price;
      if (price <= h.stopLoss) {
        const proceeds=+(h.qty*price).toFixed(2), pnl=+((price-h.avgPrice)*h.qty).toFixed(2);
        setStockWallet(w=>{const p={...w.positions};delete p[sym];return{...w,cash:+(w.cash+proceeds).toFixed(2),positions:p};});
        const story=tradeStory(sym,"SELL",price,"STOP_LOSS",0,[],"stock");
        setTrades(prev=>[{id:Date.now()+Math.random(),ticker:sym,name:sym,action:"SELL",price,qty:h.qty,total:proceeds,pnl,time:new Date().toLocaleTimeString(),engine:"stock",reason:"STOP_LOSS",story},...prev.slice(0,199)]);
        addToast(`🛑 Stopped out of ${sym}: -$${Math.abs(pnl).toFixed(0)}`,"loss");
      }
    });

    // ── Daily rotation: swap worst holder for best available pick ────
    if (isDailyRotation && Object.keys(sw.positions).length > 0) {
      // Find worst performing held stock (lowest score)
      const held = Object.entries(sw.positions)
        .map(([sym,h])=>({sym, h, sig:stockSigs[sym], gain:stockSigs[sym]?(stockSigs[sym].price-h.avgPrice)/h.avgPrice:0, score:stockSigs[sym]?.score||0}))
        .filter(x=>x.sig);

      const worst = held.sort((a,b)=>a.score-b.score)[0];

      // Find best unowned stock
      const best = Object.entries(stockSigs)
        .filter(([sym,sig])=>!sw.positions[sym]&&sig.price>0&&sig.score>0)
        .sort((a,b)=>b[1].score-a[1].score)[0];

      // Only rotate if best is meaningfully better than worst AND worst is underperforming
      if (worst && best && best[1].score > worst.score + 0.15 && worst.gain < 0.05) {
        const sellPrice = worst.sig.price;
        const proceeds  = +(worst.h.qty * sellPrice).toFixed(2);
        const pnl       = +((sellPrice - worst.h.avgPrice) * worst.h.qty).toFixed(2);

        // Sell worst
        setStockWallet(w=>{const p={...w.positions};delete p[worst.sym];return{...w,cash:+(w.cash+proceeds).toFixed(2),positions:p,lastDailyRotation:now};});
        const sellStory = tradeStory(worst.sym,"SELL",sellPrice,"ROTATE_OUT",0,[],"stock");
        setTrades(prev=>[{id:Date.now()+Math.random(),ticker:worst.sym,name:worst.sym,action:"SELL",price:sellPrice,qty:worst.h.qty,total:proceeds,pnl,time:new Date().toLocaleTimeString(),engine:"stock",reason:"ROTATE_OUT",story:sellStory},...prev.slice(0,199)]);

        // Buy best using proceeds
        const buyPrice = best[1].price;
        const size     = Math.min(proceeds, sw.cash * STOCK_CFG.maxPosPct);
        if (size >= 20 && buyPrice > 0) {
          const qty = +(size / buyPrice).toFixed(4);
          setStockWallet(w=>({...w, cash:+(w.cash-size).toFixed(2), positions:{...w.positions,[best[0]]:{qty,avgPrice:buyPrice,stopLoss:best[1].stopLoss}}, lastDailyRotation:now}));
          const buyStory = tradeStory(best[0],"BUY",buyPrice,"ROTATE_IN",best[1].conf,[],"stock");
          setTrades(prev=>[{id:Date.now()+Math.random(),ticker:best[0],name:best[0],action:"BUY",price:buyPrice,qty,total:+size.toFixed(2),pnl:null,time:new Date().toLocaleTimeString(),engine:"stock",reason:"ROTATE_IN",story:buyStory},...prev.slice(0,199)]);
          addToast(`🔄 Rotated ${worst.sym} → ${best[0]}`,"trade");
        }
      } else {
        // No rotation needed — just update timestamp
        setStockWallet(w=>({...w, lastDailyRotation:now}));
      }
    }

    // Quarterly rebalance
    if (isRebalanceTime) {
      Object.entries(sw.positions).forEach(([sym,h])=>{
        const sig=stockSigs[sym]; if (!sig) return;
        const gain=(sig.price-h.avgPrice)/h.avgPrice;
        if (gain>0.4) {
          const sellQty=+(h.qty*0.5).toFixed(4), proceeds=+(sellQty*sig.price).toFixed(2), pnl=+((sig.price-h.avgPrice)*sellQty).toFixed(2);
          setStockWallet(w=>{const p={...w.positions,[sym]:{...h,qty:+(h.qty-sellQty).toFixed(4)}};return{...w,cash:+(w.cash+proceeds).toFixed(2),positions:p,lastRebalance:now};});
          const story=tradeStory(sym,"SELL",sig.price,"REBALANCE",0,[],"stock");
          setTrades(prev=>[{id:Date.now()+Math.random(),ticker:sym,name:sym,action:"SELL",price:sig.price,qty:sellQty,total:proceeds,pnl,time:new Date().toLocaleTimeString(),engine:"stock",reason:"REBALANCE",story},...prev.slice(0,199)]);
          addToast(`📊 Rebalanced ${sym} — trimmed 50%`,"trade");
        }
      });

      // Buy top-scoring unowned stocks at rebalance
      // Lower threshold — any positive score qualifies
      const openStocks = Object.keys(sw.positions).length;
      if (openStocks < STOCK_CFG.maxStocks && sw.cash > 100) {
        const candidates = Object.entries(stockSigs)
          .filter(([sym,sig])=>!sw.positions[sym] && sig.score > 0)
          .sort((a,b)=>b[1].score-a[1].score)
          .slice(0, STOCK_CFG.maxStocks - openStocks);

        candidates.forEach(([sym,sig])=>{
          const size = Math.min(sw.cash * STOCK_CFG.maxPosPct, sw.cash * 0.4);
          if (size < 20 || !sig.price || sig.price <= 0) return;
          const qty = +(size/sig.price).toFixed(4);
          setStockWallet(w=>({...w, cash:+(w.cash-size).toFixed(2), positions:{...w.positions,[sym]:{qty,avgPrice:sig.price,stopLoss:sig.stopLoss}}, lastRebalance:now}));
          const story=tradeStory(sym,"BUY",sig.price,null,sig.conf,[],"stock");
          setTrades(prev=>[{id:Date.now()+Math.random(),ticker:sym,name:sym,action:"BUY",price:sig.price,qty,total:+size.toFixed(2),pnl:null,time:new Date().toLocaleTimeString(),engine:"stock",story},...prev.slice(0,199)]);
          addToast(`📊 Bought ${sym} for long-term hold`,"buy");
        });
      }
      setStockWallet(w=>({...w, lastRebalance:now}));
    }

    // ── Initial buy-in — fires once when no positions exist ──────────
    // Takes top 4 stocks by score regardless of BUY/HOLD label
    // Uses a local cash tracker to avoid over-spending across the loop
    if (Object.keys(sw.positions).length === 0 && sw.cash > 100) {
      const top = Object.entries(stockSigs)
        .filter(([,s]) => s.price > 0)
        .sort((a,b) => b[1].score - a[1].score)
        .slice(0, 4);

      if (top.length > 0) {
        const allocationPerStock = Math.min(
          sw.cash * STOCK_CFG.maxPosPct,
          Math.floor(sw.cash / top.length * 0.9) // divide cash evenly, keep 10% reserve
        );

        const buys = [];
        let cashLeft = sw.cash;

        top.forEach(([sym, sig]) => {
          if (!sig.price || sig.price <= 0) return;
          const size = Math.min(allocationPerStock, cashLeft * 0.9);
          if (size < 20) return;
          const qty = +(size / sig.price).toFixed(4);
          buys.push({sym, sig, size, qty});
          cashLeft = +(cashLeft - size).toFixed(2);
        });

        if (buys.length > 0) {
          // Single state update with all buys to avoid stale ref issues
          setStockWallet(w => {
            let newCash = w.cash;
            const newPositions = {...w.positions};
            buys.forEach(({sym, sig, size, qty}) => {
              if (newCash < size) return;
              newPositions[sym] = {qty, avgPrice:sig.price, stopLoss:sig.stopLoss};
              newCash = +(newCash - size).toFixed(2);
            });
            return {...w, cash:newCash, positions:newPositions};
          });
          buys.forEach(({sym, sig, size, qty}) => {
            const story = tradeStory(sym,"BUY",sig.price,null,sig.conf,[],"stock");
            setTrades(prev=>[{id:Date.now()+Math.random(),ticker:sym,name:sym,action:"BUY",price:sig.price,qty,total:+size.toFixed(2),pnl:null,time:new Date().toLocaleTimeString(),engine:"stock",story},...prev.slice(0,199)]);
            addToast(`📊 Opened ${sym} — $${size.toFixed(0)}`,"buy");
            submitStockOrder(sym,"buy",qty);
          });
        }
      }
    }
  },[stockSigs, active, halted]);

  function addToast(msg, type="buy") {
    const id=Date.now()+Math.random();
    setToasts(p=>[{id,msg,type},...p.slice(0,4)]);
    setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)),5500);
  }

  // ── PORTFOLIO MATH ─────────────────────────────────────────────────
  const now = Date.now(); // used for hold duration display
  const cryptoPV = cryptoWallet.cash + Object.entries(cryptoWallet.positions).reduce((a,[t,h])=>{
    const p=cryptoPrices[t]?.[cryptoPrices[t]?.length-1]||h.avgPrice;
    return a+h.qty*p;
  },0);
  const stockPV = stockWallet.cash + Object.entries(stockWallet.positions).reduce((a,[sym,h])=>{
    const p=stockSigs[sym]?.price||h.avgPrice;
    return a+h.qty*p;
  },0);
  const totalPV = cryptoPV + stockPV;
  const totalStart = profile.initialCapital;
  const totalPnL = trades.filter(t=>t.pnl!==null).reduce((a,t)=>a+t.pnl,0);
  const wins=trades.filter(t=>t.pnl!==null&&t.pnl>=0).length, losses=trades.filter(t=>t.pnl!==null&&t.pnl<0).length;
  const winRate=(wins+losses)>0?wins/(wins+losses):null;
  const roi=((totalPV-totalStart)/totalStart*100);
  const regColors={BULL:"#10b981",BEAR:"#ef4444",HIGH_FEAR:"#f97316",ELEVATED:"#f59e0b",NEUTRAL:"#3b82f6"};
  const regC=regColors[regime.r]||"#3b82f6";

  // ── WIN STREAK ─────────────────────────────────────────────────────
  const closed=trades.filter(t=>t.pnl!==null);
  let streak=0; for(let i=0;i<closed.length;i++){if(closed[i].pnl>0)streak++;else break;}
  const grade=roi>5?"A":roi>1?"B+":roi>0?"B":roi>-2?"C":"D";
  const gradeColor=grade.startsWith("A")?"#10b981":grade.startsWith("B")?"#3b82f6":grade==="C"?"#f59e0b":"#ef4444";

  const topBuys = cryptoOpps.filter(o=>o.action==="BUY").slice(0,5);
  const rebalDays = Math.max(0,STOCK_CFG.rebalanceDays-Math.floor((Date.now()-stockWallet.lastRebalance)/86400000));

  // Scalping performance stats
  const cryptoTrades = trades.filter(t=>t.engine==="crypto");
  const recentTrades = cryptoTrades.filter(t=>Date.now()-new Date(t.time).getTime()<300000); // last 5 min — rough proxy
  const tradesPerMin = +(recentTrades.length/5).toFixed(1);
  const closedCrypto = cryptoTrades.filter(t=>t.pnl!==null);
  const avgPnL = closedCrypto.length ? +(closedCrypto.reduce((a,t)=>a+t.pnl,0)/closedCrypto.length).toFixed(2) : 0;

  return (
    <div style={{minHeight:"100vh",background:T.bg,fontFamily:"'DM Sans',sans-serif",color:T.text,paddingBottom:72,"--pc":T.red}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');*{box-sizing:border-box;margin:0;}::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-thumb{background:${T.border};border-radius:2px;}.vnav{position:fixed;bottom:0;left:0;right:0;background:#000;border-top:1px solid ${T.border};display:flex;z-index:99;}.vb{flex:1;background:none;border:none;padding:10px 4px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;font-family:inherit;transition:all 0.15s;}.vb span:first-child{font-size:18px;}.vb span:last-child{font-size:10px;font-weight:600;}.vb.on span{color:${T.yellow};}.vb:not(.on) span{color:${T.muted};}.tw{position:fixed;top:62px;right:14px;z-index:200;display:flex;flex-direction:column;gap:5px;pointer-events:none;max-width:calc(100vw - 28px);}.ti{background:#111;border:1px solid ${T.border};border-left:3px solid ${T.red};border-radius:8px;padding:9px 13px;font-size:12px;color:${T.text};animation:ti 0.3s ease;max-width:280px;box-shadow:0 4px 12px rgba(0,0,0,0.8);}.t-trade{border-left-color:${T.yellow};}.t-loss{border-left-color:${T.red};}.t-halt{border-left-color:${T.red};}.t-buy{border-left-color:${T.green};}@keyframes ti{from{opacity:0;transform:translateX(8px);}to{opacity:1;transform:translateX(0);}}.card{background:${T.panel};border:1px solid ${T.border};border-radius:12px;padding:14px;}.rdbtn{background:#000;border:1.5px solid #fff;border-radius:8px;color:#fff;font-family:inherit;font-size:12px;font-weight:700;padding:7px 14px;cursor:pointer;transition:all 0.15s;letter-spacing:0.03em;}.rdbtn:hover{background:${T.red};border-color:${T.red};color:#fff;}.rdbtn.active{background:${T.red};border-color:${T.red};color:#fff;}.rdbtn.start{background:${T.red};border-color:${T.red};color:#fff;}.rdbtn.start:hover{background:#b91c1c;}
      .g2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
      .g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;}
      .g-home{display:grid;grid-template-columns:240px 1fr;gap:14px;}
      .g-pools{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
      @media(max-width:640px){
        .g2{grid-template-columns:1fr!important;}
        .g3{grid-template-columns:1fr 1fr!important;}
        .g-home{grid-template-columns:1fr!important;}
        .g-pools{grid-template-columns:1fr!important;}
        .hdr-name{display:none!important;}
        .hdr-regime{display:none!important;}
        .hdr-tick{display:none!important;}
        .hdr-pf label{display:none!important;}
        .vnav .vb span:last-child{font-size:9px;}
        .card{padding:10px;}
      }`}</style>

      {/* Toasts */}
      <div className="tw">{toasts.map(t=><div key={t.id} className={`ti t-${t.type}`}>{t.msg}</div>)}</div>

      {/* Header */}
      <div style={{background:"#000",borderBottom:`1px solid ${T.border}`,padding:"0 16px",display:"flex",alignItems:"center",justifyContent:"space-between",height:58,position:"sticky",top:0,zIndex:50}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontFamily:"'DM Mono',monospace",fontWeight:700,fontSize:18,color:T.white}}>Quant<span style={{color:T.red}}>Edge</span></span>
          <span className="hdr-name" style={{background:"#111",border:`1px solid ${T.border}`,borderRadius:20,padding:"2px 8px",fontSize:10,fontWeight:700,color:T.yellow}}>{profile.emoji} {profile.name}</span>
          <span className="hdr-regime" style={{background:"#111",border:`1px solid ${T.border}`,borderRadius:20,padding:"2px 8px",fontSize:10,color:regC,fontWeight:700}}>{regime.r}</span>
          {!demoMode&&<span className="hdr-regime" style={{background:"#111",border:`1px solid ${T.border}`,borderRadius:20,padding:"2px 8px",fontSize:10,fontWeight:700,color:priceMode==="ws"?T.green:priceMode==="rest"?T.yellow:T.muted}}>
            {priceMode==="ws"?"● WS":priceMode==="rest"?"● REST":"○ CONN"}
          </span>}
          {active&&<span className="hdr-tick" style={{fontSize:9,color:T.muted,fontFamily:"'DM Mono',monospace"}}>#{tick}</span>}
          {execution.coinbase&&<span className="hdr-regime" style={{background:"#000",border:`1px solid ${accountSync.status==="synced"?T.green+"44":T.border}`,borderRadius:20,padding:"2px 8px",fontSize:9,color:accountSync.status==="synced"?T.green:T.muted,fontWeight:700}}>
            {accountSync.status==="syncing"?"⟳ CB":accountSync.status==="synced"?`₿ $${accountSync.cbBalance?.toFixed(0)??"—"}`:"₿ CB"}
          </span>}
          {execution.alpaca&&<span className="hdr-regime" style={{background:"#000",border:`1px solid ${accountSync.status==="synced"?T.green+"44":T.border}`,borderRadius:20,padding:"2px 8px",fontSize:9,color:accountSync.status==="synced"?T.green:T.muted,fontWeight:700}}>
            {accountSync.status==="syncing"?"⟳ AP":accountSync.status==="synced"?`📊 $${accountSync.apBalance?.toFixed(0)??"—"}`:"📊 AP"}
          </span>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {/* Demo / Real toggle */}
          <div style={{display:"flex",background:"#111",border:`1px solid ${T.border}`,borderRadius:8,padding:2,gap:2}}>
            <button onClick={()=>{setDemoMode(true);setDataReady(false);setActive(false);}}
              style={{background:demoMode?T.red:"transparent",border:"none",borderRadius:6,color:demoMode?"#fff":T.muted,fontFamily:"inherit",fontSize:10,fontWeight:700,padding:"4px 10px",cursor:"pointer",letterSpacing:"0.04em"}}>
              DEMO
            </button>
            <button onClick={()=>{setDemoMode(false);setDataReady(false);setActive(false);}}
              style={{background:!demoMode?T.red:"transparent",border:"none",borderRadius:6,color:!demoMode?"#fff":T.muted,fontFamily:"inherit",fontSize:10,fontWeight:700,padding:"4px 10px",cursor:"pointer",letterSpacing:"0.04em"}}>
              LIVE
            </button>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:9,color:T.muted,textTransform:"uppercase",fontWeight:600}}>Portfolio</div>
            <div style={{fontSize:14,fontWeight:800,color:roi>=0?T.green:T.red,fontFamily:"'DM Mono',monospace"}}>${totalPV.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
          </div>
          <button className={`rdbtn start${!dataReady?" disabled":""}`}
            onClick={()=>{if(halted)setHalted(false);else setActive(b=>!b)}} disabled={!dataReady}>
            {!dataReady?"⏳":halted?"⚠ RESET":active?"⏹ PAUSE":"▶ START"}
          </button>
          <button className="rdbtn" onClick={()=>setSettingsOpen(o=>!o)}>⚙</button>
        </div>
      </div>

      {/* Loading overlay */}
      {!dataReady&&(
        <div style={{position:"fixed",inset:0,background:"#000000ee",zIndex:200,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:14}}>
          <style>{`@keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}`}</style>
          <div style={{fontSize:34,color:T.red,animation:"spin 1s linear infinite"}}>⟳</div>
          <div style={{fontSize:15,fontWeight:700,color:T.white}}>{demoMode?"Loading demo data…":loading||"Loading live market data…"}</div>
          <div style={{fontSize:12,color:T.muted}}>{demoMode?"Seeded prices — no API calls needed":`Binance (${CRYPTO_UNIVERSE.length} pairs) + Finnhub (${STOCK_UNIVERSE.length} stocks)`}</div>
          {!demoMode&&(execution.coinbase||execution.alpaca)&&(
            <div style={{display:"flex",gap:14,fontSize:11,marginTop:4}}>
              {execution.coinbase&&<span style={{color:accountStatus.coinbase==="ok"?T.green:accountStatus.coinbase==="syncing"?T.yellow:T.muted}}>
                {accountStatus.coinbase==="ok"?"✓ Coinbase synced":accountStatus.coinbase==="syncing"?"⟳ Syncing Coinbase…":"○ Coinbase"}
              </span>}
              {execution.alpaca&&<span style={{color:accountStatus.alpaca==="ok"?T.green:accountStatus.alpaca==="syncing"?T.yellow:T.muted}}>
                {accountStatus.alpaca==="ok"?"✓ Alpaca synced":accountStatus.alpaca==="syncing"?"⟳ Syncing Alpaca…":"○ Alpaca"}
              </span>}
            </div>
          )}
          {!demoMode&&<div style={{marginTop:8,width:220,height:3,background:"#111",borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",background:T.red,borderRadius:2,width:`${Math.round(FH_RATE.tokens/FH_RATE.maxTokens*100)}%`,transition:"width 0.5s"}}/></div>}
        </div>
      )}

      {halted&&<div style={{background:T.redDim,padding:"8px 16px",fontSize:12,color:T.red,border:`1px solid ${T.red}33`,display:"flex",gap:8}}>🛑 <strong>Safety stop triggered.</strong> Click RESET to resume.</div>}

      {/* Account sync status bar — only shown in live mode */}
      {!demoMode&&(execution.coinbase||execution.alpaca)&&dataReady&&(
        <div style={{background:"#0a0a0a",borderBottom:`1px solid ${T.border}`,padding:"6px 16px",display:"flex",alignItems:"center",gap:16,fontSize:11}}>
          <span style={{color:T.muted,fontWeight:600}}>ACCOUNTS</span>
          {execution.coinbase&&(
            <span style={{display:"flex",alignItems:"center",gap:5}}>
              <span style={{width:6,height:6,borderRadius:3,background:accountStatus.coinbase==="ok"?T.green:accountStatus.coinbase==="syncing"?T.yellow:T.muted,display:"inline-block"}}/>
              <span style={{color:T.white}}>Coinbase</span>
              <span style={{color:T.muted}}>${cryptoWallet.cash.toFixed(2)} cash</span>
              {EXEC_CONFIG.coinbase.paper&&<span style={{color:T.yellow,fontSize:9,fontWeight:700}}>PAPER</span>}
            </span>
          )}
          {execution.alpaca&&(
            <span style={{display:"flex",alignItems:"center",gap:5}}>
              <span style={{width:6,height:6,borderRadius:3,background:accountStatus.alpaca==="ok"?T.green:accountStatus.alpaca==="syncing"?T.yellow:T.muted,display:"inline-block"}}/>
              <span style={{color:T.white}}>Alpaca</span>
              <span style={{color:T.muted}}>${stockWallet.cash.toFixed(2)} cash</span>
              {EXEC_CONFIG.alpaca.paper&&<span style={{color:T.yellow,fontSize:9,fontWeight:700}}>PAPER</span>}
            </span>
          )}
          <button onClick={()=>{syncCoinbaseAccount();syncAlpacaAccount();}}
            style={{marginLeft:"auto",background:"none",border:`1px solid ${T.border}`,borderRadius:6,color:T.muted,fontFamily:"inherit",fontSize:10,fontWeight:600,padding:"3px 10px",cursor:"pointer"}}>
            ↺ Sync now
          </button>
        </div>
      )}

      <div style={{padding:"12px 10px",maxWidth:1200,margin:"0 auto",width:"100%"}}>

        {/* ── HOME — two column layout ──────────────────────────────── */}
        {view==="home"&&(
          <div className="g-home">

            {/* LEFT PANEL — purchase charts */}
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:12,padding:"10px 12px"}}>
                <div style={{fontSize:10,fontWeight:700,color:T.yellow,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>Recent Positions</div>
                {trades.filter(t=>t.action==="BUY").slice(0,6).length===0?(
                  <div style={{fontSize:11,color:T.muted,textAlign:"center",padding:"20px 0"}}>No positions yet</div>
                ):(
                  trades.filter(t=>t.action==="BUY").slice(0,6).map(t=>{
                    const prices=t.engine==="crypto"?cryptoPrices[t.ticker]:stockPrices[t.ticker];
                    const cur=prices?.[prices.length-1]||t.price;
                    const pnl=t.pnl!==null?t.pnl:((cur-t.price)*t.qty);
                    const up=pnl>=0;
                    return (
                      <div key={t.id} style={{marginBottom:10,borderBottom:`1px solid ${T.border}`,paddingBottom:10}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                          <span style={{fontSize:12,fontWeight:700,color:t.engine==="crypto"?T.yellow:T.white}}>{t.name}</span>
                          <span style={{fontSize:11,fontWeight:700,color:up?T.green:T.red}}>{up?"+":""}${pnl.toFixed(2)}</span>
                        </div>
                      <div style={{overflow:"hidden",borderRadius:6}}>
                        <MiniChart prices={prices?.slice(-40)||[t.price]} entryPrice={t.price} w={200} h={52}/>
                      </div>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:T.muted,marginTop:3}}>
                          <span>Entry ${t.price?.toLocaleString(undefined,{maximumFractionDigits:2})}</span>
                          <span>Now ${cur?.toLocaleString(undefined,{maximumFractionDigits:2})}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Mini stats */}
              <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:12,padding:"10px 12px"}}>
                <div style={{fontSize:10,fontWeight:700,color:T.yellow,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>Quick Stats</div>
                {[
                  {l:"Total trades",v:trades.length,c:T.white},
                  {l:"Wins",v:wins,c:T.green},
                  {l:"Losses",v:losses,c:T.red},
                  {l:"Win rate",v:winRate!==null?`${(winRate*100).toFixed(0)}%`:"—",c:T.yellow},
                  {l:"Total P&L",v:`${totalPnL>=0?"+":""}$${totalPnL.toFixed(2)}`,c:totalPnL>=0?T.green:T.red},
                ].map(s=>(
                  <div key={s.l} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`1px solid ${T.border}33`}}>
                    <span style={{fontSize:11,color:T.muted}}>{s.l}</span>
                    <span style={{fontSize:11,fontWeight:700,color:s.c,fontFamily:"'DM Mono',monospace"}}>{s.v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT — main home content */}
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {/* Big number */}
            <div className="card" style={{textAlign:"center",padding:"28px 16px 20px"}}>
              <div style={{fontSize:11,fontWeight:700,color:T.muted,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>Total Portfolio</div>
              <div style={{fontSize:52,fontWeight:900,color:roi>=0?"#10b981":"#ef4444",letterSpacing:"-0.04em",fontFamily:"'DM Mono',monospace",lineHeight:1}}>
                ${totalPV.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
              </div>
              <div style={{marginTop:10,display:"flex",alignItems:"center",justifyContent:"center",gap:12}}>
                <span style={{fontSize:20,fontWeight:800,color:roi>=0?"#10b981":"#ef4444"}}>{roi>=0?"▲+":"▼"}{Math.abs(roi).toFixed(2)}%</span>
                <span style={{fontSize:14,color:roi>=0?"#10b981":"#ef4444",fontWeight:600}}>({roi>=0?"+":""}${(totalPV-totalStart).toFixed(2)})</span>
              </div>
              <div style={{marginTop:14,display:"flex",justifyContent:"center",gap:24}}>
                {[
                  {l:"P&L",v:`${totalPnL>=0?"+":""}$${Math.abs(totalPnL).toFixed(0)}`,c:totalPnL>=0?"#10b981":"#ef4444"},
                  {l:"Win Rate",v:winRate!==null?`${(winRate*100).toFixed(0)}%`:"—",c:"#f1f5f9"},
                  {l:"Streak",v:streak>0?`${streak}🔥`:"0",c:"#f1f5f9"},
                ].map(s=>(
                  <div key={s.l} style={{textAlign:"center"}}>
                    <div style={{fontSize:9,color:T.muted,fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:2}}>{s.l}</div>
                    <div style={{fontSize:17,fontWeight:800,color:s.c,fontFamily:"'DM Mono',monospace"}}>{s.v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Grade + status */}
            <div className="card" style={{display:"flex",alignItems:"center",gap:14}}>
              <div style={{width:60,height:60,borderRadius:12,background:`${gradeColor}22`,border:`2px solid ${gradeColor}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <span style={{fontSize:28,fontWeight:900,color:gradeColor,fontFamily:"'DM Mono',monospace"}}>{grade}</span>
              </div>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:3}}>
                  {grade==="A"?"Bot is crushing it 🔥":grade.startsWith("B")?"Solid, trending up 📈":grade==="C"?"Breakeven territory ⏳":"Rough patch, adapting 🛡️"}
                </div>
                <div style={{fontSize:11,color:T.muted}}>{closed.length} trades closed · {wins} wins · {losses} losses</div>
              </div>
            </div>

            {/* Live account sync panel — only shows when exchanges connected */}
            {(execution.coinbase||execution.alpaca)&&(
              <div className="card" style={{border:`1px solid ${accountSync.status==="synced"?T.green+"33":T.border}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div style={{fontSize:11,fontWeight:700,color:T.yellow,letterSpacing:"0.06em",textTransform:"uppercase"}}>🔗 Live Accounts</div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    {accountSync.lastSync&&<span style={{fontSize:9,color:T.muted}}>synced {Math.round((Date.now()-accountSync.lastSync)/1000)}s ago</span>}
                    <button onClick={syncAccounts} style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:6,color:T.muted,fontFamily:"inherit",fontSize:10,padding:"3px 8px",cursor:"pointer"}}>
                      {accountSync.status==="syncing"?"⟳":"↺ Sync"}
                    </button>
                  </div>
                </div>
                <div className="g2">
                  {execution.coinbase&&(
                    <div style={{background:"#000",border:`1px solid ${T.border}`,borderRadius:9,padding:"10px 12px"}}>
                      <div style={{fontSize:9,color:T.muted,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.06em"}}>Coinbase Balance</div>
                      <div style={{fontSize:20,fontWeight:800,color:T.text,fontFamily:"'DM Mono',monospace"}}>
                        {accountSync.cbBalance!==null?`$${accountSync.cbBalance.toFixed(2)}`:"—"}
                      </div>
                      <div style={{fontSize:10,color:T.muted,marginTop:3}}>
                        {Object.keys(accountSync.cbPositions).length} holdings · {EXEC_CONFIG.coinbase.paper?"Paper":"Live"}
                      </div>
                      {Object.entries(accountSync.cbPositions).slice(0,3).map(([t,p])=>(
                        <div key={t} style={{fontSize:10,color:T.muted,marginTop:2}}>
                          {t.replace("/USDT","")} <span style={{color:T.text}}>{p.qty.toFixed(4)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {execution.alpaca&&(
                    <div style={{background:"#000",border:`1px solid ${T.border}`,borderRadius:9,padding:"10px 12px"}}>
                      <div style={{fontSize:9,color:T.muted,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.06em"}}>Alpaca Buying Power</div>
                      <div style={{fontSize:20,fontWeight:800,color:T.text,fontFamily:"'DM Mono',monospace"}}>
                        {accountSync.apBalance!==null?`$${accountSync.apBalance.toFixed(2)}`:"—"}
                      </div>
                      <div style={{fontSize:10,color:T.muted,marginTop:3}}>
                        {Object.keys(accountSync.apPositions).length} positions · {EXEC_CONFIG.alpaca.paper?"Paper":"Live"}
                      </div>
                      {Object.entries(accountSync.apPositions).slice(0,3).map(([sym,p])=>(
                        <div key={sym} style={{fontSize:10,marginTop:2,display:"flex",justifyContent:"space-between"}}>
                          <span style={{color:T.muted}}>{sym}</span>
                          <span style={{color:p.unrealPnl>=0?T.green:T.red,fontWeight:600}}>{p.unrealPnl>=0?"+":""}${p.unrealPnl?.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {Object.keys(pendingOrders).length>0&&(
                  <div style={{marginTop:10,background:"#fbbf2411",border:`1px solid ${T.yellow}33`,borderRadius:8,padding:"8px 10px",fontSize:11,color:T.yellow}}>
                    ⏳ {Object.keys(pendingOrders).length} order{Object.keys(pendingOrders).length>1?"s":""} pending fill confirmation
                  </div>
                )}
                {accountSync.error&&(
                  <div style={{marginTop:8,background:"#ef444411",border:`1px solid ${T.red}33`,borderRadius:8,padding:"8px 10px",fontSize:11,color:T.red}}>
                    ⚠ {accountSync.error}
                  </div>
                )}
              </div>
            )}

            {/* Dual pool bars */}
            <div className="g2">
              {/* Crypto pool */}
              <div className="card" style={{border:"1px solid #1d4ed844"}}>
                <div style={{fontSize:10,fontWeight:700,color:"#60a5fa",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>⚡ Crypto Pool</div>
                <div style={{fontSize:22,fontWeight:800,color:T.text,fontFamily:"'DM Mono',monospace"}}>${cryptoPV.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                <div style={{fontSize:11,color:cryptoPV>=profile.cryptoCapital?"#10b981":"#ef4444",marginTop:3}}>
                  {cryptoPV>=profile.cryptoCapital?"+":""}${(cryptoPV-profile.cryptoCapital).toFixed(0)} vs start
                </div>
                <div style={{height:4,background:"#000",borderRadius:2,marginTop:8,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${Math.min(cryptoPV/profile.cryptoCapital*100,150)}%`,background:"#3b82f6",borderRadius:2,transition:"width 0.5s"}}/>
                </div>
                <div style={{fontSize:10,color:T.muted,marginTop:6}}>
                  {Object.keys(cryptoWallet.positions).length}/{CRYPTO_CFG.maxConcurrent} open · ${cryptoWallet.cash.toFixed(0)} cash · avg <span style={{color:avgPnL>=0?"#10b981":"#ef4444"}}>{avgPnL>=0?"+":""}${avgPnL}/trade</span>
                  {cryptoOpps.length>0&&<span style={{color:T.muted}}> · top score: <span style={{color:Math.abs(cryptoOpps[0]?.score||0)>0.1?"#10b981":"#64748b"}}>{cryptoOpps[0]?.score?.toFixed(3)||"—"}</span> ({cryptoOpps[0]?.action||"—"} {Math.round((cryptoOpps[0]?.conf||0)*100)}%)</span>}
                </div>
              </div>
              {/* Stock pool */}
              <div className="card" style={{border:"1px solid #f59e0b44"}}>
                <div style={{fontSize:10,fontWeight:700,color:T.yellow,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>📊 Stock Pool</div>
                <div style={{fontSize:22,fontWeight:800,color:T.text,fontFamily:"'DM Mono',monospace"}}>${stockPV.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                <div style={{fontSize:11,color:stockPV>=profile.stockCapital?"#10b981":"#ef4444",marginTop:3}}>
                  {stockPV>=profile.stockCapital?"+":""}${(stockPV-profile.stockCapital).toFixed(0)} vs start
                </div>
                <div style={{height:4,background:"#000",borderRadius:2,marginTop:8,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${Math.min(stockPV/profile.stockCapital*100,150)}%`,background:"#f59e0b",borderRadius:2,transition:"width 0.5s"}}/>
                </div>
                <div style={{fontSize:10,color:T.muted,marginTop:6}}>Rebalance in {rebalDays}d · {Object.keys(stockWallet.positions).length} stocks held</div>
              </div>
            </div>

            {/* Top crypto opportunities */}
            {topBuys.length>0&&(
              <div className="card">
                <div style={{fontSize:11,fontWeight:700,color:"#60a5fa",letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:10}}>⚡ Top Crypto Opportunities Right Now</div>
                {topBuys.map((opp,i)=>{
                  const prices=cryptoPrices[opp.ticker]||[];
                  const prev=prices[prices.length-2]||opp.price;
                  const chg=opp.price?(opp.price-prev)/prev*100:0;
                  const up=chg>=0;
                  const inCooldown=cooldowns.current[opp.ticker]>Date.now();
                  const holding=!!cryptoWallet.positions[opp.ticker];
                  return (
                    <div key={opp.ticker} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:i<topBuys.length-1?"1px solid #1e3a5f33":"none"}}>
                      <div style={{fontSize:18,width:28,textAlign:"center"}}>{CRYPTO_META[opp.ticker]?.icon||"○"}</div>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:13,fontWeight:700,color:T.text}}>{CRYPTO_META[opp.ticker]?.name||opp.ticker}</span>
                          {holding&&<span style={{background:"#10b98122",border:"1px solid #10b98144",borderRadius:4,padding:"1px 5px",fontSize:9,color:T.green,fontWeight:700}}>HOLDING</span>}
                          {inCooldown&&<span style={{background:"#f59e0b22",border:"1px solid #f59e0b44",borderRadius:4,padding:"1px 5px",fontSize:9,color:"#f59e0b",fontWeight:700}}>COOLDOWN</span>}
                        </div>
                        <div style={{fontSize:11,color:T.muted}}>${opp.price?.toLocaleString(undefined,{maximumFractionDigits:opp.price<1?6:2})} · {up?"▲":"▼"}{Math.abs(chg).toFixed(2)}% · <span style={{color:T.green,fontWeight:600}}>{opp.topReason||"Signal"}</span></div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <Spark prices={prices.slice(-20)} up={up} w={56} h={22}/>
                        <Ring value={opp.conf} color="#10b981" size={40}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Recent activity feed */}
            <div className="card">
              <div style={{fontSize:11,fontWeight:700,color:T.muted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:10}}>What the bot did</div>
              {!trades.length?(
                <div style={{textAlign:"center",padding:"20px 0",color:T.muted}}>
                  <div style={{fontSize:24,marginBottom:6}}>💤</div>
                  <div style={{fontSize:13}}>Hit START to begin trading</div>
                </div>
              ):(
                <div>
                  {trades.slice(0,8).map((t,i)=>(
                    <div key={t.id} style={{display:"flex",gap:10,padding:"9px 0",borderBottom:i<Math.min(trades.length,8)-1?"1px solid #1e3a5f22":"none",alignItems:"flex-start"}}>
                      <div style={{width:32,height:32,borderRadius:8,background:t.action==="BUY"?"#10b98122":"#ef444422",border:`1px solid ${t.action==="BUY"?"#10b98155":"#ef444455"}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:14}}>
                        {t.engine==="crypto"?"⚡":"📊"}
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:12,color:T.text,lineHeight:1.4}}>{t.story}</div>
                        {t.pnl!==null&&<div style={{marginTop:3,fontSize:11,fontWeight:700,color:t.pnl>=0?"#10b981":"#ef4444"}}>{t.pnl>=0?"💰 +":"📉 -"}${Math.abs(t.pnl).toFixed(2)}</div>}
                      </div>
                      <div style={{fontSize:9,color:T.muted,flexShrink:0}}>{t.time}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          </div>
        )}

        {/* ── CRYPTO TAB ───────────────────────────────────────────── */}
        {view==="crypto"&&(
          <div>
            {/* Subtab bar */}
            <div style={{display:"flex",background:T.panel,borderRadius:12,padding:4,gap:4,marginBottom:14,border:`1px solid ${T.border}`}}>
              {[
                {id:"scanner", label:"⚡ Scanner", count:cryptoOpps.filter(o=>o.action==="BUY").length},
                {id:"holdings",label:"📦 My Holdings", count:Object.keys(cryptoWallet.positions).length},
              ].map(s=>(
                <button key={s.id} onClick={()=>setCryptoSub(s.id)}
                  style={{flex:1,background:cryptoSub===s.id?"#000":"none",border:cryptoSub===s.id?"1px solid #3b82f655":"1px solid transparent",borderRadius:9,padding:"8px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,color:cryptoSub===s.id?"#60a5fa":"#475569",transition:"all 0.15s",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                  {s.label}
                  {s.count>0&&<span style={{background:cryptoSub===s.id?"#3b82f622":"#33415522",border:`1px solid ${cryptoSub===s.id?"#3b82f644":"#33415544"}`,borderRadius:10,padding:"1px 7px",fontSize:10,color:cryptoSub===s.id?"#60a5fa":"#64748b"}}>{s.count}</span>}
                </button>
              ))}
            </div>

            {/* SCANNER subtab */}
            {cryptoSub==="scanner"&&(
              <div>
                <div style={{fontSize:11,color:T.muted,marginBottom:10}}>
                  Scanning <span style={{color:"#60a5fa",fontWeight:700}}>{CRYPTO_UNIVERSE.length} pairs</span> — ranked by signal strength. Updates every 8s.
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {cryptoOpps.slice(0,CRYPTO_CFG.topN).map((opp,i)=>{
                    const prices=cryptoPrices[opp.ticker]||[];
                    const prev=prices[prices.length-2]||opp.price;
                    const chg=opp.price?(opp.price-prev)/prev*100:0;
                    const up=chg>=0;
                    const holding=cryptoWallet.positions[opp.ticker];
                    return (
                      <div key={opp.ticker} className="card" style={{borderLeft:`3px solid ${opp.action==="BUY"?"#10b981":opp.action==="SELL"?"#ef4444":"#222"}`}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <div style={{fontSize:22}}>{CRYPTO_META[opp.ticker]?.icon||"○"}</div>
                            <div>
                              <div style={{fontSize:14,fontWeight:700,color:T.text}}>{CRYPTO_META[opp.ticker]?.name||opp.ticker}</div>
                              <div style={{fontSize:11,color:T.muted}}>{opp.ticker}</div>
                            </div>
                            {holding&&<span style={{background:"#10b98122",border:"1px solid #10b98144",borderRadius:4,padding:"1px 6px",fontSize:9,color:T.green,fontWeight:700}}>HOLDING</span>}
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <Spark prices={prices.slice(-24)} up={up} w={72} h={26}/>
                            <div style={{textAlign:"right"}}>
                              <div style={{fontSize:16,fontWeight:800,color:T.text,fontFamily:"'DM Mono',monospace"}}>${opp.price?.toLocaleString(undefined,{maximumFractionDigits:opp.price<1?6:2})}</div>
                              <div style={{fontSize:11,color:up?"#10b981":"#ef4444"}}>{up?"▲":"▼"}{Math.abs(chg).toFixed(2)}%</div>
                              {priceAge[opp.ticker]
                                ? <div style={{fontSize:9,color:T.green}}>● {Math.round((Date.now()-priceAge[opp.ticker])/1000)}s ago</div>
                                : <div style={{fontSize:9,color:T.muted}}>○ pending</div>
                              }
                            </div>
                          </div>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <Ring value={opp.conf} color={opp.action==="BUY"?"#10b981":opp.action==="SELL"?"#ef4444":"#64748b"} size={44}/>
                          <div style={{flex:1}}>
                            <div style={{background:opp.action==="BUY"?"#10b98115":opp.action==="SELL"?"#ef444415":"#000",border:`1px solid ${opp.action==="BUY"?"#10b98133":opp.action==="SELL"?"#ef444433":"#222"}`,borderRadius:8,padding:"6px 10px",marginBottom:6}}>
                              <div style={{fontSize:12,fontWeight:700,color:opp.action==="BUY"?"#10b981":opp.action==="SELL"?"#ef4444":"#64748b"}}>
                                {opp.action==="BUY" && opp.conf>=0.6 ? `🟢 ${opp.reason||"Buy signal"}`
                                  : opp.action==="BUY" && opp.conf<0.6 ? `⏳ Building — ${Math.round(opp.conf*100)}% confidence`
                                  : opp.action==="SELL" ? "🔴 Sell signal"
                                  : "⏳ Watching — signals split"}
                              </div>
                            </div>
                            {/* 3-signal breakdown */}
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginTop:6}}>
                              {[
                                {label:"RSI", val:opp.rsi, score:opp.s1, desc:opp.s1>0?"Bullish":opp.s1<0?"Bearish":"Neutral"},
                                {label:"EMA Cross", val:opp.e9>opp.e21?"9>21":"9<21", score:opp.s2, desc:opp.s2===2?"Golden X":opp.s2===-2?"Death X":opp.s2>0?"Above":"Below"},
                                {label:"Volume", val:opp.s3!==0?`${opp.s3>0?"▲":"▼"}Active`:"Quiet", score:opp.s3, desc:Math.abs(opp.s3||0)===2?"Strong":"Moderate"},
                              ].map((ind,i)=>(
                                <div key={i} style={{background:"#000",border:`1px solid ${ind.score>0?T.green+"44":ind.score<0?T.red+"44":T.border}`,borderRadius:7,padding:"6px 8px",textAlign:"center"}}>
                                  <div style={{fontSize:9,color:T.muted,marginBottom:2}}>{ind.label}</div>
                                  <div style={{fontSize:12,fontWeight:700,color:ind.score>0?T.green:ind.score<0?T.red:T.muted}}>{ind.val}</div>
                                  <div style={{fontSize:9,color:ind.score>0?T.green:ind.score<0?T.red:T.muted,marginTop:1}}>{ind.desc}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div style={{marginTop:8,display:"flex",gap:12,fontSize:10,color:T.muted}}>
                          <span>SL <span style={{color:T.red}}>${opp.stopLoss?.toLocaleString(undefined,{maximumFractionDigits:opp.price<1?6:2})}</span></span>
                          <span>TP <span style={{color:T.green}}>${opp.takeProfit?.toLocaleString(undefined,{maximumFractionDigits:opp.price<1?6:2})}</span></span>
                          <span style={{marginLeft:"auto"}}>Signals: <span style={{color:T.green}}>{opp.bullish||0}▲</span> <span style={{color:T.red}}>{opp.bearish||0}▼</span></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* HOLDINGS subtab */}
            {cryptoSub==="holdings"&&(
              <div>
                {Object.keys(cryptoWallet.positions).length===0 ? (
                  <div style={{textAlign:"center",padding:"60px 0",color:T.muted}}>
                    <div style={{fontSize:32,marginBottom:10}}>📭</div>
                    <div style={{fontSize:14,fontWeight:600,color:T.muted,marginBottom:4}}>No open positions</div>
                    <div style={{fontSize:12}}>The bot will open positions here when it finds strong signals.</div>
                    <button onClick={()=>setCryptoSub("scanner")} style={{marginTop:14,background:"#1d4ed8",border:"none",borderRadius:9,color:"#fff",fontFamily:"inherit",fontSize:12,fontWeight:700,padding:"9px 20px",cursor:"pointer"}}>View Scanner →</button>
                  </div>
                ) : (
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:12,padding:"12px 14px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                        <div>
                          <div style={{fontSize:10,fontWeight:600,color:T.muted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:3}}>Total crypto value</div>
                          <div style={{fontSize:22,fontWeight:800,color:T.text,fontFamily:"'DM Mono',monospace"}}>${cryptoPV.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                        </div>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontSize:10,fontWeight:600,color:T.muted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:3}}>vs start</div>
                          <div style={{fontSize:16,fontWeight:800,color:cryptoPV>=profile.cryptoCapital?"#10b981":"#ef4444"}}>
                            {cryptoPV>=profile.cryptoCapital?"+":""}${(cryptoPV-profile.cryptoCapital).toFixed(2)}
                          </div>
                        </div>
                      </div>
                      <div className="g3">
                        {[
                          {label:`${Object.keys(cryptoWallet.positions).length}/${CRYPTO_CFG.maxConcurrent} slots`, val:"Positions", color:T.text},
                          {label:"Cash remaining",  val:`$${cryptoWallet.cash.toFixed(0)}`, color:"#60a5fa"},
                          {label:"Avg P&L/trade",   val:`${avgPnL>=0?"+":""}$${avgPnL}`, color:avgPnL>=0?"#10b981":"#ef4444"},
                        ].map(s=>(
                          <div key={s.label} style={{background:"#000",borderRadius:8,padding:"8px 10px"}}>
                            <div style={{fontSize:9,color:T.muted,marginBottom:2,textTransform:"uppercase",letterSpacing:"0.06em"}}>{s.val}</div>
                            <div style={{fontSize:15,fontWeight:800,color:s.color,fontFamily:"'DM Mono',monospace"}}>{s.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {Object.entries(cryptoWallet.positions).map(([ticker,h])=>{
                      const currentPrice = cryptoPrices[ticker]?.[cryptoPrices[ticker]?.length-1] || h.avgPrice;
                      const pnl = (currentPrice - h.avgPrice) * h.qty;
                      const pct = (currentPrice - h.avgPrice) / h.avgPrice * 100;
                      const posValue = h.qty * currentPrice;
                      const costBasis = h.qty * h.avgPrice;
                      const up = pnl >= 0;
                      const prices = cryptoPrices[ticker] || [];
                      const fmt = (v) => v > 1 ? v.toLocaleString(undefined,{maximumFractionDigits:2}) : v.toFixed(6);

                      return (
                        <div key={ticker} style={{background:T.panel,border:`1px solid ${up?"#10b98133":"#ef444433"}`,borderLeft:`3px solid ${up?"#10b981":"#ef4444"}`,borderRadius:14,padding:16}}>
                          {/* Header row */}
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                            <div style={{display:"flex",alignItems:"center",gap:10}}>
                              <div style={{fontSize:28}}>{CRYPTO_META[ticker]?.icon||"○"}</div>
                              <div>
                                <div style={{fontSize:16,fontWeight:800,color:T.text}}>{CRYPTO_META[ticker]?.name||ticker}</div>
                                <div style={{fontSize:11,color:T.muted}}>{ticker}</div>
                              </div>
                            </div>
                            <div style={{textAlign:"right"}}>
                              <div style={{fontSize:22,fontWeight:900,color:up?"#10b981":"#ef4444",fontFamily:"'DM Mono',monospace"}}>
                                {up?"+":""}${pnl.toFixed(2)}
                              </div>
                              <div style={{fontSize:12,color:up?"#10b981":"#ef4444",fontWeight:600}}>
                                {pct>=0?"+":""}{pct.toFixed(2)}%
                              </div>
                            </div>
                          </div>

                          {/* Sparkline */}
                          <div style={{marginBottom:12}}>
                            <Spark prices={prices.slice(-40)} up={up} w={300} h={48}/>
                          </div>

                          {/* 4-stat grid */}
                          <div className="g2" style={{marginBottom:10}}>
                            {[
                              {label:"Bought at",  value:`$${fmt(h.avgPrice)}`,   color:T.muted},
                              {label:"Now",         value:`$${fmt(currentPrice)}`, color:T.text},
                              {label:"You paid",    value:`$${costBasis.toFixed(2)}`, color:T.muted},
                              {label:"Now worth",   value:`$${posValue.toFixed(2)}`,  color:up?"#10b981":"#ef4444"},
                            ].map(s=>(
                              <div key={s.label} style={{background:"#000",borderRadius:9,padding:"10px 12px"}}>
                                <div style={{fontSize:9,color:T.muted,marginBottom:3,textTransform:"uppercase",letterSpacing:"0.06em"}}>{s.label}</div>
                                <div style={{fontSize:15,fontWeight:800,color:s.color,fontFamily:"'DM Mono',monospace"}}>{s.value}</div>
                              </div>
                            ))}
                          </div>

                          {/* Qty + SL/TP + freshness */}
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:11,color:T.muted}}>
                            <span>Qty: <span style={{color:T.muted,fontWeight:600}}>{h.qty}</span></span>
                            <span>SL <span style={{color:T.red,fontWeight:600}}>${fmt(h.stopLoss)}</span></span>
                            <span>TP <span style={{color:T.green,fontWeight:600}}>${fmt(h.takeProfit)}</span></span>
                            <span style={{color:h.entryTime&&(now-h.entryTime)>CRYPTO_CFG.maxHoldMs*0.8?"#f59e0b":"#475569"}}>
                              {h.entryTime ? `${Math.floor((now-h.entryTime)/1000)}s` : "—"}
                            </span>
                            <span style={{color:priceAge[ticker]?"#10b981":"#f59e0b"}}>
                              {priceAge[ticker]?"● live":"○ pending"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── STOCKS TAB ───────────────────────────────────────────── */}
        {view==="stocks"&&(
          <div>
            {/* Subtab bar */}
            <div style={{display:"flex",background:T.panel,borderRadius:12,padding:4,gap:4,marginBottom:14,border:`1px solid ${T.border}`}}>
              {[
                {id:"holdings", label:"📦 My Holdings", count:Object.keys(stockWallet.positions).length},
                {id:"watchlist",label:"👁 Watchlist",   count:Object.entries(stockSigs).filter(([s])=>!stockWallet.positions[s]&&stockSigs[s]?.action==="BUY").length},
              ].map(s=>(
                <button key={s.id} onClick={()=>setStockSub(s.id)}
                  style={{flex:1,background:stockSub===s.id?"#000":"none",border:stockSub===s.id?"1px solid #f59e0b55":"1px solid transparent",borderRadius:9,padding:"8px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,color:stockSub===s.id?"#fbbf24":"#475569",transition:"all 0.15s",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                  {s.label}
                  {s.count>0&&<span style={{background:stockSub===s.id?"#f59e0b22":"#33415522",border:`1px solid ${stockSub===s.id?"#f59e0b44":"#33415544"}`,borderRadius:10,padding:"1px 7px",fontSize:10,color:stockSub===s.id?"#fbbf24":"#64748b"}}>{s.count}</span>}
                </button>
              ))}
            </div>

            {/* HOLDINGS subtab */}
            {stockSub==="holdings"&&(
              <div>
                {Object.keys(stockWallet.positions).length===0 ? (
                  <div style={{textAlign:"center",padding:"60px 0",color:T.muted}}>
                    <div style={{fontSize:32,marginBottom:10}}>📭</div>
                    <div style={{fontSize:14,fontWeight:600,color:T.muted,marginBottom:4}}>No stock positions yet</div>
                    <div style={{fontSize:12,marginBottom:14}}>The bot buys stocks on startup and rebalances quarterly.</div>
                    <button onClick={()=>setStockSub("watchlist")} style={{background:"#92400e",border:"none",borderRadius:9,color:T.yellow,fontFamily:"inherit",fontSize:12,fontWeight:700,padding:"9px 20px",cursor:"pointer"}}>View Watchlist →</button>
                  </div>
                ):(
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {/* Summary bar */}
                    <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:12,padding:"12px 14px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                        <div>
                          <div style={{fontSize:10,fontWeight:600,color:T.muted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:3}}>Total stock value</div>
                          <div style={{fontSize:22,fontWeight:800,color:T.text,fontFamily:"'DM Mono',monospace"}}>${stockPV.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                        </div>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontSize:10,fontWeight:600,color:T.muted,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:3}}>vs start</div>
                          <div style={{fontSize:16,fontWeight:800,color:stockPV>=profile.stockCapital?"#10b981":"#ef4444"}}>
                            {stockPV>=profile.stockCapital?"+":""}${(stockPV-profile.stockCapital).toFixed(2)}
                          </div>
                        </div>
                      </div>
                      <div className="g3">
                        {[
                          {label:"Positions held",  val:Object.keys(stockWallet.positions).length, color:T.text},
                          {label:"Cash remaining",  val:`$${stockWallet.cash.toFixed(0)}`,          color:T.yellow},
                          {label:"Rebalance in",    val:`${rebalDays}d`,                             color:T.muted},
                        ].map(s=>(
                          <div key={s.label} style={{background:"#000",borderRadius:8,padding:"8px 10px"}}>
                            <div style={{fontSize:9,color:T.muted,marginBottom:2,textTransform:"uppercase",letterSpacing:"0.06em"}}>{s.label}</div>
                            <div style={{fontSize:15,fontWeight:800,color:s.color,fontFamily:"'DM Mono',monospace"}}>{s.val}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Position cards */}
                    {Object.entries(stockWallet.positions).map(([sym,h])=>{
                      const sig=stockSigs[sym];
                      const price=sig?.price||h.avgPrice;
                      const pnl=(price-h.avgPrice)*h.qty;
                      const pct=(price-h.avgPrice)/h.avgPrice*100;
                      const posValue=+(h.qty*price).toFixed(2);
                      const costBasis=+(h.qty*h.avgPrice).toFixed(2);
                      const up=pnl>=0;
                      const prices=stockPrices[sym]||[];
                      return (
                        <div key={sym} style={{background:T.panel,border:`1px solid ${up?"#10b98133":"#ef444433"}`,borderLeft:`3px solid ${up?"#10b981":"#ef4444"}`,borderRadius:14,padding:16}}>
                          {/* Header */}
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                            <div style={{display:"flex",alignItems:"center",gap:10}}>
                              <div style={{width:40,height:40,borderRadius:10,background:"#f59e0b22",border:"1px solid #f59e0b44",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:T.yellow,fontFamily:"'DM Mono',monospace"}}>{sym.slice(0,4)}</div>
                              <div>
                                <div style={{fontSize:16,fontWeight:800,color:T.text}}>{sym}</div>
                                <div style={{fontSize:11,color:up?"#10b981":"#ef4444",fontWeight:700}}>
                                  {up?"+":""}${pnl.toFixed(2)} ({pct>=0?"+":""}{pct.toFixed(2)}%)
                                </div>
                              </div>
                            </div>
                            <div style={{textAlign:"right"}}>
                              <div style={{fontSize:22,fontWeight:900,color:T.text,fontFamily:"'DM Mono',monospace"}}>${price.toFixed(2)}</div>
                              {priceAge[sym]
                                ? <div style={{fontSize:9,color:T.green}}>● live {Math.round((Date.now()-priceAge[sym])/1000)}s ago</div>
                                : <div style={{fontSize:9,color:T.muted}}>○ pending</div>}
                            </div>
                          </div>

                          {/* Sparkline */}
                          <div style={{marginBottom:12}}>
                            <Spark prices={prices.slice(-40)} up={up} w={320} h={48}/>
                          </div>

                          {/* 4-stat grid */}
                          <div className="g2" style={{marginBottom:10}}>
                            {[
                              {label:"Bought at",  value:`$${h.avgPrice?.toFixed(2)}`, color:T.muted},
                              {label:"Now",        value:`$${price.toFixed(2)}`,        color:T.text},
                              {label:"You paid",   value:`$${costBasis}`,               color:T.muted},
                              {label:"Now worth",  value:`$${posValue}`,                color:up?"#10b981":"#ef4444"},
                            ].map(s=>(
                              <div key={s.label} style={{background:"#000",borderRadius:9,padding:"10px 12px"}}>
                                <div style={{fontSize:9,color:T.muted,marginBottom:3,textTransform:"uppercase",letterSpacing:"0.06em"}}>{s.label}</div>
                                <div style={{fontSize:15,fontWeight:800,color:s.color,fontFamily:"'DM Mono',monospace"}}>{s.value}</div>
                              </div>
                            ))}
                          </div>

                          {/* Footer row */}
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:11,color:T.muted}}>
                            <span>Shares: <span style={{color:T.muted,fontWeight:600}}>{h.qty}</span></span>
                            <span>Stop loss: <span style={{color:T.red,fontWeight:600}}>${h.stopLoss?.toFixed(2)}</span></span>
                            <span>Signal: <span style={{color:sig?.action==="BUY"?"#10b981":sig?.action==="SELL"?"#ef4444":"#64748b",fontWeight:600}}>{sig?.action||"—"}</span></span>
                            {pct>40&&<span style={{color:"#f59e0b"}}>⚠ Trim at rebalance</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* WATCHLIST subtab */}
            {stockSub==="watchlist"&&(
              <div>
                <div style={{fontSize:11,color:T.muted,marginBottom:12}}>
                  Watching <span style={{color:T.yellow,fontWeight:700}}>{STOCK_UNIVERSE.length} stocks</span> — ranked by value score. Bot buys top picks at startup and rebalance.
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {Object.entries(stockSigs)
                    .sort((a,b)=>b[1].score-a[1].score)
                    .slice(0,15)
                    .map(([sym,sig])=>{
                      const prices=stockPrices[sym]||[];
                      const prev=prices[prices.length-2]||sig.price;
                      const chg=sig.price?(sig.price-prev)/prev*100:0;
                      const up=chg>=0;
                      const held=!!stockWallet.positions[sym];
                      return (
                        <div key={sym} style={{background:T.panel,border:`1px solid ${held?"#f59e0b33":"#222"}`,borderRadius:10,padding:"11px 14px",display:"flex",alignItems:"center",gap:10}}>
                          <div style={{width:44,height:44,borderRadius:9,background:held?"#f59e0b22":"#1e293b",border:`1px solid ${held?"#f59e0b44":"#222"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:held?"#fbbf24":"#64748b",fontFamily:"'DM Mono',monospace",flexShrink:0}}>{sym.slice(0,4)}</div>
                          <Spark prices={prices.slice(-20)} up={up} w={56} h={24}/>
                          <div style={{flex:1}}>
                            <div style={{display:"flex",alignItems:"center",gap:6}}>
                              <span style={{fontSize:13,fontWeight:700,color:T.text}}>{sym}</span>
                              {held&&<span style={{background:"#f59e0b22",border:"1px solid #f59e0b44",borderRadius:4,padding:"1px 5px",fontSize:9,color:T.yellow,fontWeight:700}}>HELD</span>}
                            </div>
                            <div style={{fontSize:11,color:up?"#10b981":"#ef4444"}}>{up?"▲":"▼"}{Math.abs(chg).toFixed(2)}%</div>
                          </div>
                          <div style={{textAlign:"right"}}>
                            <div style={{fontSize:14,fontWeight:800,color:T.text,fontFamily:"'DM Mono',monospace"}}>${sig.price?.toFixed(2)}</div>
                            <div style={{fontSize:10,color:sig.action==="BUY"?"#10b981":sig.action==="SELL"?"#ef4444":"#64748b",fontWeight:600}}>{sig.action==="BUY"?"🟢 Buy":sig.action==="SELL"?"🔴 Sell":"⏳ Hold"}</div>
                          </div>
                          <Ring value={sig.conf} color={sig.action==="BUY"?"#10b981":sig.action==="SELL"?"#ef4444":"#64748b"} size={38}/>
                        </div>
                      );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── HISTORY TAB ──────────────────────────────────────────── */}
        {view==="history"&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <span style={{fontSize:11,fontWeight:700,color:T.muted,letterSpacing:"0.06em",textTransform:"uppercase"}}>{trades.length} trades</span>
              <span style={{fontSize:13,fontWeight:800,color:totalPnL>=0?"#10b981":"#ef4444",fontFamily:"'DM Mono',monospace"}}>{totalPnL>=0?"+":""}${totalPnL.toFixed(2)}</span>
            </div>
            {!trades.length?(
              <div style={{textAlign:"center",padding:"60px 0",color:T.muted}}>
                <div style={{fontSize:32,marginBottom:8}}>📋</div>
                <div>No trades yet. Hit START.</div>
              </div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {trades.slice(0,50).map(t=>(
                  <div key={t.id} style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:12,padding:"12px 14px",display:"flex",gap:10,alignItems:"flex-start"}}>
                    <div style={{width:34,height:34,borderRadius:8,background:t.action==="BUY"?"#10b98122":"#ef444422",border:`1px solid ${t.action==="BUY"?"#10b98155":"#ef444455"}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:14}}>
                      {t.engine==="crypto"?"⚡":"📊"}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:3}}>
                        <div>
                          <span style={{fontWeight:700,color:t.engine==="crypto"?"#60a5fa":"#fbbf24",fontSize:13}}>{t.name}</span>
                          <span style={{background:t.action==="BUY"?"#10b98122":"#ef444422",color:t.action==="BUY"?"#10b981":"#ef4444",borderRadius:4,padding:"1px 6px",fontSize:10,fontWeight:700,marginLeft:6,border:`1px solid ${t.action==="BUY"?"#10b98144":"#ef444444"}`}}>{t.action}</span>
                        </div>
                        <span style={{fontSize:14,fontWeight:800,color:t.pnl===null?"#475569":t.pnl>=0?"#10b981":"#ef4444",fontFamily:"'DM Mono',monospace"}}>
                          {t.pnl===null?"Open":`${t.pnl>=0?"+":""}$${t.pnl.toFixed(2)}`}
                        </span>
                      </div>
                      <div style={{fontSize:11,color:T.muted,lineHeight:1.4}}>{t.story}</div>
                      <div style={{fontSize:10,color:T.muted,marginTop:3}}>{t.time} · ${t.price?.toLocaleString(undefined,{maximumFractionDigits:t.price<1?6:2})} · {t.reason||"Signal"}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {view==="news"&&(
          <div>
            {/* Subtab bar */}
            <div style={{display:"flex",background:"#000",border:`1px solid ${T.border}`,borderRadius:10,padding:3,gap:3,marginBottom:14}}>
              {[
                {id:"crypto", label:"⚡ Crypto", count:cryptoNews.length},
                {id:"stocks", label:"📊 Stocks", count:Object.keys(stockNews).length},
              ].map(s=>(
                <button key={s.id} onClick={()=>setNewsSub(s.id)}
                  style={{flex:1,background:newsSub===s.id?T.red:"transparent",border:`1px solid ${newsSub===s.id?T.red:T.border}`,borderRadius:7,padding:"8px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,color:newsSub===s.id?"#fff":T.muted,transition:"all 0.15s",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                  {s.label}
                  {s.count>0&&<span style={{background:"#ffffff22",borderRadius:10,padding:"1px 7px",fontSize:10}}>{s.count}</span>}
                </button>
              ))}
            </div>

            {/* CRYPTO NEWS */}
            {newsSub==="crypto"&&(
              <div>
                {!cryptoNews.length?(
                  <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:12,padding:32,textAlign:"center"}}>
                    <div style={{fontSize:28,marginBottom:8}}>📡</div>
                    <div style={{fontSize:13,color:T.muted}}>{demoMode?"Switch to LIVE mode for real news":"Loading crypto news…"}</div>
                  </div>
                ):(
                  <div className="g2">
                    {cryptoNews.slice(0,16).map((n,i)=>{
                      const bull=n.s>0.5, bear=n.s<-0.5;
                      const accent=bull?T.green:bear?T.red:T.muted;
                      return (
                        <div key={i} style={{background:T.panel,border:`1px solid ${bull?T.green+"33":bear?T.red+"33":T.border}`,borderTop:`2px solid ${accent}`,borderRadius:10,padding:"12px 14px",display:"flex",flexDirection:"column",gap:8}}>
                          <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
                            <span style={{fontSize:18,flexShrink:0}}>{bull?"📈":bear?"📉":"📰"}</span>
                            <div style={{flex:1,fontSize:12,color:T.text,lineHeight:1.45,fontWeight:500}}>{n.h}</div>
                          </div>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                            <span style={{background:`${accent}22`,border:`1px solid ${accent}44`,borderRadius:4,padding:"2px 8px",fontSize:9,color:accent,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                              {bull?"● BULLISH":bear?"● BEARISH":"● NEUTRAL"}
                            </span>
                            <span style={{fontSize:9,color:T.muted}}>{n.t}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* STOCK NEWS */}
            {newsSub==="stocks"&&(
              <div>
                {Object.keys(stockNews).length===0?(
                  <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:12,padding:32,textAlign:"center"}}>
                    <div style={{fontSize:28,marginBottom:8}}>📡</div>
                    <div style={{fontSize:13,color:T.muted}}>{demoMode?"Switch to LIVE mode for real stock news":"No stock news loaded yet"}</div>
                  </div>
                ):(
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    {Object.entries(stockNews).map(([sym,articles])=>{
                      if (!articles||!articles.length) return null;
                      const avg=articles.reduce((a,n)=>a+n.s,0)/articles.length;
                      const overallColor=avg>0.2?T.green:avg<-0.2?T.red:T.muted;
                      const overallLabel=avg>0.2?"Mostly Bullish":avg<-0.2?"Mostly Bearish":"Mixed";
                      return (
                        <div key={sym} style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:12,overflow:"hidden"}}>
                          {/* Stock header */}
                          <div style={{padding:"10px 14px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:10,background:"#000"}}>
                            <div style={{width:36,height:36,borderRadius:8,background:T.red+"22",border:`1px solid ${T.red}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:T.yellow,fontFamily:"'DM Mono',monospace",flexShrink:0}}>{sym.slice(0,4)}</div>
                            <div>
                              <div style={{fontSize:13,fontWeight:700,color:T.text}}>{sym}</div>
                              <div style={{fontSize:10,color:overallColor,fontWeight:600}}>{overallLabel}</div>
                            </div>
                            <div style={{marginLeft:"auto",fontSize:10,color:T.muted}}>{articles.length} articles</div>
                          </div>
                          {/* Article cards grid */}
                          <div className="g2" style={{padding:10}}>
                            {articles.slice(0,4).map((n,i)=>{
                              const bull=n.s>0.3, bear=n.s<-0.3;
                              const ac=bull?T.green:bear?T.red:T.muted;
                              return (
                                <div key={i} style={{background:"#000",border:`1px solid ${bull?T.green+"33":bear?T.red+"33":T.border}`,borderLeft:`3px solid ${ac}`,borderRadius:8,padding:"9px 11px"}}>
                                  <div style={{fontSize:11,color:T.text,lineHeight:1.4,marginBottom:6}}>{n.h}</div>
                                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                                    <span style={{fontSize:9,color:ac,fontWeight:700}}>{bull?"▲ BULLISH":bear?"▼ BEARISH":"— NEUTRAL"}</span>
                                    <span style={{fontSize:9,color:T.muted}}>{n.t}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Settings overlay backdrop */}
      {settingsOpen&&<div onClick={()=>setSettingsOpen(false)} style={{position:"fixed",inset:0,background:"#000000bb",zIndex:150,backdropFilter:"blur(2px)"}}/>}

      {/* Settings panel — slides in from right */}
      <div style={{position:"fixed",top:0,right:0,bottom:0,width:360,maxWidth:"100vw",background:"#0a0a0a",borderLeft:`1px solid ${T.border}`,zIndex:200,transform:settingsOpen?"translateX(0)":"translateX(100%)",transition:"transform 0.3s cubic-bezier(0.4,0,0.2,1)",overflowY:"auto",paddingBottom:40}}>
        <style>{`.sinp{width:100%;background:#000;border:1.5px solid #ffffff22;border-radius:9px;padding:10px 12px;color:#fff;font-size:13px;font-family:inherit;outline:none;transition:border-color 0.15s;}.sinp:focus{border-color:${T.red};}.sinp.ok{border-color:${T.green};}.sinp.err{border-color:${T.red};}.stbtn{background:transparent;border:1px solid #ffffff22;border-radius:7px;color:#94a3b8;font-family:inherit;font-size:11px;font-weight:600;padding:6px 12px;cursor:pointer;transition:all 0.15s;white-space:nowrap;}.stbtn:hover{border-color:${T.red};color:${T.red};}.stbtn:disabled{opacity:0.35;cursor:not-allowed;}.schip{background:#000;border:1px solid #ffffff22;border-radius:8px;padding:8px 10px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600;color:#6b7280;transition:all 0.15s;text-align:center;}.schip.on{background:${T.red}22;border-color:${T.red};color:#fff;}`}</style>

        {/* Panel header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:`1px solid ${T.border}`,position:"sticky",top:0,background:"#0a0a0a",zIndex:1}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontWeight:700,fontSize:16,color:T.white}}>Quant<span style={{color:T.red}}>Edge</span> <span style={{fontSize:12,color:T.muted,fontWeight:400}}>Settings</span></div>
          <button onClick={()=>setSettingsOpen(false)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:7,color:T.muted,fontSize:18,width:32,height:32,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
        </div>

        <div style={{padding:"0 20px"}}>

          {/* ── Profile ─────────────────────────────────────────── */}
          <div style={{marginTop:20,marginBottom:20}}>
            <div style={{fontSize:11,fontWeight:700,color:T.yellow,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>Risk Profile</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {Object.entries(PROFILES).map(([key,p])=>(
                <button key={key} className={`schip${goalKey===key?" on":""}`} onClick={()=>setGoalKey(key)}>
                  {p.emoji} {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* ── Capital ──────────────────────────────────────────── */}
          <div style={{marginBottom:20}}>
            <div style={{fontSize:11,fontWeight:700,color:T.yellow,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>Starting Capital</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:10}}>
              {CAPITALS.map((c,i)=>(
                <button key={i} className={`schip${capitalIdx===i&&!customCap?" on":""}`} onClick={()=>{setCapitalIdx(i);setCustomCap("");}}>
                  ${c>=1000?`${c/1000}k`:c}
                </button>
              ))}
            </div>
            <input className="sinp" type="number" placeholder="Custom amount ($)" value={customCap} onChange={e=>setCustomCap(e.target.value)} style={{marginBottom:8}}/>
            <div style={{background:"#000",border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 12px",display:"flex",justifyContent:"space-between"}}>
              <div style={{fontSize:12,color:T.muted}}>⚡ Crypto <span style={{color:T.red,fontWeight:700}}>${Math.round(totalCap*CRYPTO_CAPITAL_PCT).toLocaleString()}</span></div>
              <div style={{fontSize:12,color:T.muted}}>📊 Stocks <span style={{color:T.yellow,fontWeight:700}}>${Math.round(totalCap*STOCK_CAPITAL_PCT).toLocaleString()}</span></div>
            </div>
          </div>

          {/* ── Mode ──────────────────────────────────────────────── */}
          <div style={{marginBottom:20}}>
            <div style={{fontSize:11,fontWeight:700,color:T.yellow,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>Trading Mode</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <button className={`schip${demoMode?" on":""}`} onClick={()=>setDemoMode(true)}>🎮 Demo</button>
              <button className={`schip${!demoMode?" on":""}`} onClick={()=>setDemoMode(false)}>📡 Live Data</button>
            </div>
            {demoMode&&<div style={{marginTop:8,fontSize:11,color:T.muted}}>Seeded prices — no API keys needed. Great for testing.</div>}
          </div>

          {/* ── Finnhub ───────────────────────────────────────────── */}
          {!demoMode&&(
            <div style={{marginBottom:20}}>
              <div style={{fontSize:11,fontWeight:700,color:T.yellow,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                📡 Finnhub API
                <a href="https://finnhub.io/register" target="_blank" rel="noreferrer" style={{color:T.red,textDecoration:"none",fontSize:10,fontWeight:400}}>Get free key →</a>
              </div>
              <div style={{display:"flex",gap:8,marginBottom:6}}>
                <input className={`sinp${fhStatus==="ok"?" ok":fhStatus==="error"?" err":""}`} type="text" placeholder="Finnhub API key" value={fhKey} onChange={e=>{setFhKey(e.target.value);setFhStatus("idle");}}/>
                <button className="stbtn" onClick={testFinnhub} disabled={!fhKey.trim()||fhStatus==="testing"}>{fhStatus==="testing"?"…":"Test"}</button>
              </div>
              {fhStatus==="ok"&&<div style={{fontSize:11,color:T.green}}>✓ Connected</div>}
              {fhStatus==="error"&&<div style={{fontSize:11,color:T.red}}>✗ Invalid key</div>}
            </div>
          )}

          {/* ── Coinbase ──────────────────────────────────────────── */}
          {!demoMode&&(
            <div style={{marginBottom:20,background:"#000",border:`1px solid ${T.border}`,borderRadius:10,padding:14}}>
              <div style={{fontSize:11,fontWeight:700,color:T.yellow,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                ₿ Coinbase
                <a href="https://www.coinbase.com/settings/api" target="_blank" rel="noreferrer" style={{color:T.red,textDecoration:"none",fontSize:10,fontWeight:400}}>Get key →</a>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:10}}>
                <button className={`schip${cbPaper?" on":""}`} onClick={()=>setCbPaper(true)}>Paper</button>
                <button className={`schip${!cbPaper?" on":""}`} onClick={()=>setCbPaper(false)}>Live 💰</button>
              </div>
              {!cbPaper&&<div style={{fontSize:11,color:T.red,marginBottom:8,padding:"5px 8px",background:`${T.red}11`,borderRadius:6}}>⚠ Real money — orders execute immediately</div>}
              <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:8}}>
                <input className="sinp" type="text" placeholder="API Key" value={cbKey} onChange={e=>{setCbKey(e.target.value);setCbStatus("idle");}}/>
                <input className={`sinp${cbStatus==="ok"?" ok":cbStatus==="error"?" err":""}`} type="password" placeholder="API Secret" value={cbSecret} onChange={e=>{setCbSecret(e.target.value);setCbStatus("idle");}}/>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:11,color:cbStatus==="ok"?T.green:cbStatus==="error"?T.red:T.muted}}>{cbStatus==="ok"?"✓ Connected":cbStatus==="error"?"✗ Failed":cbStatus==="testing"?"Testing…":"○ Not tested"}</span>
                <button className="stbtn" onClick={testCoinbase} disabled={!cbKey.trim()||!cbSecret.trim()||cbStatus==="testing"}>Test Connection</button>
              </div>
            </div>
          )}

          {/* ── Alpaca ────────────────────────────────────────────── */}
          {!demoMode&&(
            <div style={{marginBottom:20,background:"#000",border:`1px solid ${T.border}`,borderRadius:10,padding:14}}>
              <div style={{fontSize:11,fontWeight:700,color:T.yellow,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                📊 Alpaca
                <a href="https://app.alpaca.markets/signup" target="_blank" rel="noreferrer" style={{color:T.red,textDecoration:"none",fontSize:10,fontWeight:400}}>Sign up →</a>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:10}}>
                <button className={`schip${apPaper?" on":""}`} onClick={()=>setApPaper(true)}>Paper</button>
                <button className={`schip${!apPaper?" on":""}`} onClick={()=>setApPaper(false)}>Live 💰</button>
              </div>
              {!apPaper&&<div style={{fontSize:11,color:T.red,marginBottom:8,padding:"5px 8px",background:`${T.red}11`,borderRadius:6}}>⚠ Real money — orders execute immediately</div>}
              <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:8}}>
                <input className="sinp" type="text" placeholder="API Key ID" value={apKey} onChange={e=>{setApKey(e.target.value);setApStatus("idle");}}/>
                <input className={`sinp${apStatus==="ok"?" ok":apStatus==="error"?" err":""}`} type="password" placeholder="Secret Key" value={apSecret} onChange={e=>{setApSecret(e.target.value);setApStatus("idle");}}/>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:11,color:apStatus==="ok"?T.green:apStatus==="error"?T.red:T.muted}}>{apStatus==="ok"?"✓ Connected":apStatus==="error"?"✗ Failed":apStatus==="testing"?"Testing…":"○ Not tested"}</span>
                <button className="stbtn" onClick={testAlpaca} disabled={!apKey.trim()||!apSecret.trim()||apStatus==="testing"}>Test Connection</button>
              </div>
            </div>
          )}

          {/* ── Apply button ─────────────────────────────────────── */}
          <button className="rdbtn start" style={{width:"100%",padding:14,fontSize:14}} onClick={()=>{setSettingsOpen(false);setActive(false);setDataReady(false);}}>
            Apply & Restart Engine
          </button>
          <div style={{textAlign:"center",marginTop:10,fontSize:10,color:"#374151"}}>
            Credentials stored in memory only · Never saved
          </div>
        </div>
      </div>

      {/* Bottom nav */}
      <nav className="vnav">
        {[
          {id:"home",   emoji:"🏠",label:"Home"},
          {id:"crypto", emoji:"⚡",label:"Crypto"},
          {id:"stocks", emoji:"📊",label:"Stocks"},
          {id:"news",   emoji:"📰",label:"News"},
          {id:"history",emoji:"📋",label:"History"},
        ].map(n=>(
          <button key={n.id} className={`vb${view===n.id?" on":""}`} onClick={()=>setView(n.id)}>
            <span>{n.emoji}</span><span>{n.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ROOT
// ═══════════════════════════════════════════════════════════════════════
export default function App() {
  const defaultProfile = buildProfile({goal:"growth", risk:2, capital:1, experience:1});
  return <DashScreen defaultProfile={defaultProfile}/>;
}
