// 統計頁：對得到中央氣象署的事件，推算 vs 中央氣象署。參考 kotoho7〈揺れ検知から震央を検出してみる〉的「震央検出の精度について」：
// 固定時間點取樣（擴成 5/10/20/30 秒與最終報）、誤差分布、偏移地圖、外海被拉向陸地（量化成「往測站網偏」），再加上規模、深度、速度。
// 用 site.js 的 fmtTime、km、fix、getJson、el、svg、niceTicks、stations。

const q = (arr, p) => { const s = arr.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const pct = (n, d) => (d ? `${Math.round(n / d * 100)}%` : '—');
const SLICES = [5, 10, 20, 30];
const eventCache = new Map();
let years = [];
let coast = null;

async function loadEvents(year) {
  const ys = year ? [year] : years;
  const out = [];
  for (const y of ys) {
    const list = ((await getJson(`data/${y}/index.json`)) || []).filter((e) => e.truth && !e.hidden && e.label !== 'fake');
    const missing = list.filter((e) => !eventCache.has(e.eventId));
    let done = 0;
    // 一次抓 8 個
    for (let i = 0; i < missing.length; i += 8) {
      await Promise.all(missing.slice(i, i + 8).map(async (e) => {
        try { eventCache.set(e.eventId, await getJson(`data/${y}/${e.eventId}.json`)); } catch { eventCache.set(e.eventId, null); }
        done += 1;
      }));
      document.getElementById('status').textContent = `讀取 ${y} 年事件 ${done}/${missing.length}…`;
    }
    for (const e of list) { const ev = eventCache.get(e.eventId); if (ev) out.push({ ...ev, year: y }); }
  }
  return out;
}

function filtered(all) {
  const src = document.getElementById('f-src').value;
  // 「全部」是空字串：不篩（空字串轉數字會變 0，不能直接 Number）
  const range = (id) => { const v = document.getElementById(id).value; return v ? v.split('-').map(Number) : [NaN, NaN]; };
  const [m0, m1] = range('f-mag');
  const [d0, d1] = range('f-depth');
  return all.filter((ev) => {
    const t = ev.truth;
    if (src === 'live' && ev.rebuilt) return false;
    if (src === 'rebuilt' && !ev.rebuilt) return false;
    if (Number.isFinite(m0) && !(t.magnitude >= m0 && t.magnitude < m1)) return false;
    if (Number.isFinite(d0) && !(t.depth >= d0 && t.depth < d1)) return false;
    return (ev.reports || []).length > 0;
  });
}
const finalOf = (ev) => [...ev.reports].reverse().find((r) => r.kind !== 'report') || ev.reports[ev.reports.length - 1];
// 第一個觸發後 sec 秒時，畫面上的那一報（還沒出報 = null）
const reportAt = (ev, sec) => [...ev.reports].reverse().find((r) => Number.isFinite(r.sinceFirstS) && r.sinceFirstS <= sec) || null;

// ── 小圖 ──
function frame(W, H, m, xs, ys, { xTicks, yTicks, xLabel, yLabel, xFmt = (v) => `${+v.toFixed(1)}`, yFmt = (v) => `${+v.toFixed(2)}` }) {
  const [x0, x1] = xs; const [y0, y1] = ys;
  const X = (v) => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r);
  const Y = (v) => H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const grid = svg('g', { class: 'grid' }); const axis = svg('g', { class: 'axis' });
  for (const t of yTicks ?? niceTicks(y0, y1)) {
    grid.append(svg('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t) }));
    const tx = svg('text', { x: m.l - 6, y: Y(t) + 4, 'text-anchor': 'end' }); tx.textContent = yFmt(t); axis.append(tx);
  }
  for (const t of xTicks ?? niceTicks(x0, x1, 6)) {
    const tx = svg('text', { x: X(t), y: H - m.b + 16, 'text-anchor': 'middle' }); tx.textContent = xFmt(t); axis.append(tx);
  }
  if (xLabel) { const t = svg('text', { x: W - m.r, y: H - 2, 'text-anchor': 'end' }); t.textContent = xLabel; axis.append(t); }
  if (yLabel) { const t = svg('text', { x: m.l - 6, y: m.t - 2, 'text-anchor': 'end' }); t.textContent = yLabel; axis.append(t); }
  root.append(grid, axis);
  return { root, X, Y };
}
const tip = () => document.getElementById('tooltip');
function hover(node, text) {
  node.addEventListener('pointermove', (e) => { const t = tip(); t.textContent = text; t.style.display = 'block'; t.style.left = `${Math.min(e.clientX + 12, innerWidth - t.offsetWidth - 8)}px`; t.style.top = `${e.clientY + 12}px`; });
  node.addEventListener('pointerleave', () => { tip().style.display = 'none'; });
}

// ── A. 隨時間的精度 ──
function renderTime(evs) {
  const rows = [...SLICES.map((s) => ({ label: `${s} 秒`, x: s, get: (ev) => reportAt(ev, s) })), { label: '最終報', x: null, get: finalOf }];
  const stats = rows.map((r) => {
    const errs = evs.map((ev) => { const rep = r.get(ev); return rep ? km(rep.lat, rep.lng, ev.truth.lat, ev.truth.lng) : NaN; }).filter(Number.isFinite);
    return { ...r, n: errs.length, med: q(errs, 0.5), p90: q(errs, 0.9), in10: errs.filter((e) => e <= 10).length, in20: errs.filter((e) => e <= 20).length };
  });
  document.getElementById('t-time').replaceChildren(...stats.map((s) => el('tr', {},
    el('td', { text: s.x === null ? '最終報' : `第一個觸發後 ${s.label}` }), el('td', { class: 'r', text: `${s.n}/${evs.length}` }),
    el('td', { class: 'r', text: fix(s.med) }), el('td', { class: 'r', text: fix(s.p90) }),
    el('td', { class: 'r', text: pct(s.in10, s.n) }), el('td', { class: 'r', text: pct(s.in20, s.n) }))));
  // 圖：x = 時間點（最終報放在最後一格）
  const host = document.getElementById('c-time'); host.replaceChildren();
  const xs = stats.map((_, i) => i);
  const yMax = Math.max(10, ...stats.map((s) => s.p90).filter(Number.isFinite)) * 1.1;
  const { root, X, Y } = frame(640, 220, { l: 40, r: 20, t: 14, b: 30 }, [-0.4, xs.length - 0.6], [0, yMax], { xTicks: [], yLabel: 'km', yFmt: (v) => `${v}` });
  stats.forEach((s, i) => { const t = svg('text', { x: X(i), y: 220 - 14, 'text-anchor': 'middle', class: 'bar-label' }); t.textContent = s.x === null ? '最終報' : s.label; root.append(t); });
  for (const [key, cls, dot] of [['med', 'series-line', 'series-dot'], ['p90', 'line-2', 'dot-2']]) {
    const pts = stats.map((s, i) => [X(i), Y(s[key])]).filter(([, y]) => Number.isFinite(y));
    root.append(svg('path', { class: cls, d: pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('') }));
    stats.forEach((s, i) => {
      if (!Number.isFinite(s[key])) return;
      const c = svg('circle', { class: dot, cx: X(i), cy: Y(s[key]), r: 5 }); root.append(c);
      hover(c, `${s.x === null ? '最終報' : `第一個觸發後 ${s.label}`}\n${key === 'med' ? '中位數' : 'p90'} ${fix(s[key])} km（${s.n} 場已有報）`);
    });
  }
  // 直接標最終報的兩個數
  const last = stats[stats.length - 1];
  for (const [key, dy] of [['med', 14], ['p90', -8]]) if (Number.isFinite(last[key])) { const t = svg('text', { class: 'end-label', x: X(xs.length - 1) + 8, y: Y(last[key]) + dy / 3 }); t.textContent = fix(last[key]); root.append(t); }
  host.append(root);
}

// ── B. 誤差分布 ──
function renderHist(evs) {
  const errs = evs.map((ev) => { const f = finalOf(ev); return km(f.lat, f.lng, ev.truth.lat, ev.truth.lng); });
  const edges = [0, 5, 10, 15, 20, 30, 50, Infinity];
  const counts = edges.slice(0, -1).map((lo, i) => errs.filter((e) => e >= lo && e < edges[i + 1]).length);
  const host = document.getElementById('c-hist'); host.replaceChildren();
  const W = 520; const H = 220; const m = { l: 40, r: 10, t: 14, b: 30 };
  const yMax = Math.max(1, ...counts) * 1.15;
  const { root, Y } = frame(W, H, m, [0, counts.length], [0, yMax], { xTicks: [], yLabel: '場', yFmt: (v) => `${Math.round(v)}` });
  const bw = (W - m.l - m.r) / counts.length;
  let cum = 0;
  counts.forEach((c, i) => {
    cum += c;
    const x = m.l + i * bw + 2; const y = Y(c);
    const r = svg('rect', { class: 'bar', x, y, width: bw - 4, height: Math.max(0, H - m.b - y), rx: 3 }); root.append(r);
    const label = edges[i + 1] === Infinity ? `≥ ${edges[i]}` : `${edges[i]}–${edges[i + 1]}`;
    hover(r, `${label} km：${c} 場\n累積 ${pct(cum, errs.length)}`);
    const t = svg('text', { class: 'bar-label', x: x + (bw - 4) / 2, y: H - m.b + 16, 'text-anchor': 'middle' }); t.textContent = label; root.append(t);
    if (c) { const v = svg('text', { class: 'bar-label', x: x + (bw - 4) / 2, y: y - 4, 'text-anchor': 'middle' }); v.textContent = String(c); root.append(v); }
  });
  host.append(root);
  const within = (k) => pct(errs.filter((e) => e <= k).length, errs.length);
  // 原作用「度」：0.3° ≈ 33 km
  document.getElementById('d-hist').textContent = `${errs.length} 場：5 km 內 ${within(5)}、10 km 內 ${within(10)}、20 km 內 ${within(20)}；0.3°（約 33 km）內 ${within(33.3)}`;
}

// ── G. 速度 ──
function renderSpeed(evs) {
  const secs = evs.map((ev) => (ev.reports[0].dataMs - ev.truth.originMs) / 1000).filter(Number.isFinite);
  const edges = [0, 5, 10, 15, 20, 30, 60, Infinity];
  const counts = edges.slice(0, -1).map((lo, i) => secs.filter((s) => s >= lo && s < edges[i + 1]).length);
  const host = document.getElementById('c-speed'); host.replaceChildren();
  const W = 520; const H = 220; const m = { l: 40, r: 10, t: 14, b: 30 };
  const { root, Y } = frame(W, H, m, [0, counts.length], [0, Math.max(1, ...counts) * 1.15], { xTicks: [], yLabel: '場', yFmt: (v) => `${Math.round(v)}` });
  const bw = (W - m.l - m.r) / counts.length;
  counts.forEach((c, i) => {
    const x = m.l + i * bw + 2; const y = Y(c);
    const r = svg('rect', { class: 'bar', x, y, width: bw - 4, height: Math.max(0, H - m.b - y), rx: 3 }); root.append(r);
    const label = edges[i + 1] === Infinity ? `≥ ${edges[i]}` : `${edges[i]}–${edges[i + 1]}`;
    hover(r, `發震後 ${label} 秒：${c} 場`);
    const t = svg('text', { class: 'bar-label', x: x + (bw - 4) / 2, y: H - m.b + 16, 'text-anchor': 'middle' }); t.textContent = `${label}s`; root.append(t);
    if (c) { const v = svg('text', { class: 'bar-label', x: x + (bw - 4) / 2, y: y - 4, 'text-anchor': 'middle' }); v.textContent = String(c); root.append(v); }
  });
  host.append(root);
  const fin = evs.map((ev) => (finalOf(ev).dataMs - ev.truth.originMs) / 1000);
  document.getElementById('d-speed').textContent = `第一報：中位數發震後 ${fix(q(secs, 0.5), 0)} 秒（p10 ${fix(q(secs, 0.1), 0)}、p90 ${fix(q(secs, 0.9), 0)}）；最終報：中位數發震後 ${fix(q(fin, 0.5), 0)} 秒`;
}

// ── D. 偏移地圖（可拖曳、縮放） ──
const DEPTH_BINS = [[0, 40, 'var(--depth-1)', '淺（< 40 km）'], [40, 80, 'var(--depth-2)', '中（40–80 km）'], [80, 999, 'var(--depth-3)', '深（≥ 80 km）']];
const depthColor = (d) => (DEPTH_BINS.find(([a, b]) => d >= a && d < b) || DEPTH_BINS[0])[2];
const LAT0 = 23.7; const KX = Math.cos(LAT0 * Math.PI / 180);
const proj = ([lng, lat]) => [(lng - 120) * KX * 100, (25.6 - lat) * 100]; // 1° ≈ 100 單位
const HOME = { x: -60, y: -40, w: 380, h: 560 }; // 全台
let view = { ...HOME };
let mapSvg = null;
// 點與 × 以螢幕大小為準（不跟著地圖等比放大）：放大時只稍微變大，縮小時不會擠成一團
let marks = [];

function setView(v) {
  view = v;
  mapSvg?.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  const px = document.getElementById('map')?.getBoundingClientRect().width || 1;
  const unitPerPx = v.w / px;
  const zoom = HOME.w / v.w; // 1 = 全台
  const sizePx = Math.min(7, Math.max(3, 3.2 + Math.log2(Math.max(zoom, 1)) * 0.9));
  for (const m of marks) m.node.setAttribute('transform', `translate(${m.x} ${m.y}) scale(${(sizePx * unitPerPx).toFixed(4)})`);
}
function fitHome() {
  const box = document.getElementById('map').getBoundingClientRect();
  const aspect = box.width / Math.max(box.height, 1);
  const w = Math.max(HOME.w, HOME.h * aspect); const h = w / aspect;
  setView({ x: HOME.x + (HOME.w - w) / 2, y: HOME.y + (HOME.h - h) / 2, w, h });
}

function renderMap(evs) {
  const host = document.getElementById('map');
  mapSvg = svg('svg', { preserveAspectRatio: 'xMidYMid meet' });
  const g = svg('g');
  marks = [];
  if (coast) for (const line of coast) g.append(svg('path', { class: 'coast', d: line.map((p, i) => { const [x, y] = proj(p); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join('') }));
  for (const ev of evs) {
    const f = finalOf(ev); const t = ev.truth;
    const [tx, ty] = proj([t.lng, t.lat]); const [fx, fy] = proj([f.lng, f.lat]);
    const color = depthColor(t.depth);
    g.append(svg('line', { class: 'off', x1: tx, y1: ty, x2: fx, y2: fy, stroke: color }));
    // ×、● 都畫在原點、單位大小，由 setView 依縮放設定 transform
    const x = svg('path', { class: 'truth-x', d: 'M-0.7,-0.7L0.7,0.7M-0.7,0.7L0.7,-0.7' });
    g.append(x);
    marks.push({ node: x, x: tx, y: ty });
    const dot = svg('circle', { class: 'ev-dot', cx: 0, cy: 0, r: 1, fill: color });
    marks.push({ node: dot, x: fx, y: fy });
    hover(dot, `${t.location || ''} ${fmtTime(t.originMs)}\n中央氣象署 M${fix(t.magnitude)}・${fix(t.depth)} km\n我們 M${fix(f.magnitude)}・${Math.round(f.depth)} km・震央差 ${fix(km(f.lat, f.lng, t.lat, t.lng))} km`);
    dot.addEventListener('click', () => { location.href = `event.html?y=${encodeURIComponent(ev.year)}&id=${encodeURIComponent(ev.eventId)}`; });
    g.append(dot);
  }
  mapSvg.append(g);
  host.replaceChildren(mapSvg);
  fitHome();
}

// 拖曳、滾輪、雙指縮放、雙擊放大
function setupMapInteraction() {
  const host = document.getElementById('map');
  const pointers = new Map();
  let pinch = null; let moved = false;
  const toWorld = (cx, cy) => { const b = host.getBoundingClientRect(); return [view.x + (cx - b.left) / b.width * view.w, view.y + (cy - b.top) / b.height * view.h]; };
  const zoomAt = (cx, cy, k) => {
    const [wx, wy] = toWorld(cx, cy);
    const w = Math.min(Math.max(view.w * k, 8), 3000); const kk = w / view.w; const h = view.h * kk;
    setView({ x: wx - (wx - view.x) * kk, y: wy - (wy - view.y) * kk, w, h });
  };
  host.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(e.deltaY * 0.0015)); }, { passive: false });
  host.addEventListener('dblclick', (e) => zoomAt(e.clientX, e.clientY, 0.5));
  host.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, [e.clientX, e.clientY]); moved = false;
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) }; }
    host.classList.add('dragging');
  });
  host.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, pinch.d / d); pinch.d = d; moved = true; return;
    }
    const dx = e.clientX - prev[0]; const dy = e.clientY - prev[1];
    if (Math.abs(dx) + Math.abs(dy) > 0) moved = true;
    if (moved && !host.hasPointerCapture(e.pointerId)) host.setPointerCapture(e.pointerId);
    const b = host.getBoundingClientRect();
    setView({ ...view, x: view.x - dx / b.width * view.w, y: view.y - dy / b.height * view.h });
  });
  const end = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; if (!pointers.size) host.classList.remove('dragging'); };
  host.addEventListener('pointerup', end); host.addEventListener('pointercancel', end);
  // 拖曳結束時不要觸發點事件
  host.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
  document.getElementById('map-reset').addEventListener('click', fitHome);
  addEventListener('resize', fitHome);
  document.getElementById('legend-depth').replaceChildren(
    el('span', { class: 'key' }, el('span', { class: 'truth-legend', text: '×' }), '中央氣象署震央'),
    ...DEPTH_BINS.map(([, , c, label]) => { const d = el('span', { class: 'dot' }); d.style.background = c; return el('span', { class: 'key' }, d, label); }));
}

// ── E. 往測站網偏 ──
async function renderPull(evs) {
  const st = [...(await stations()).values()];
  const nearest = (lat, lng) => st.reduce((m, s) => Math.min(m, km(lat, lng, s.lat, s.lon)), Infinity);
  const off = evs.map((ev) => { const f = finalOf(ev); return { dt: nearest(ev.truth.lat, ev.truth.lng), df: nearest(f.lat, f.lng) }; }).filter((x) => x.dt > 20);
  const closer = off.filter((x) => x.df < x.dt - 2);
  const pull = off.map((x) => x.dt - x.df);
  document.getElementById('pull').textContent = off.length
    ? `外海事件（中央氣象署震央離最近測站 > 20 km）共 ${off.length} 場：我們的震央比真值更靠近測站網的有 ${closer.length} 場（${pct(closer.length, off.length)}）；離測站網的距離中位數${q(pull, 0.5) >= 0 ? `縮短 ${fix(q(pull, 0.5))}` : `反而增加 ${fix(-q(pull, 0.5))}`} km。原作觀察到「外海地震會偏向陸地」；這個數字越接近 50%、拉近量越接近 0，代表沒有這種系統偏差。`
    : '這個篩選條件下沒有外海事件。';
}

// ── F. 規模、深度對照 ──
function scatter(hostId, tableId, evs, { get, bins, unit, label, digits }) {
  const pts = evs.map((ev) => { const f = finalOf(ev); return { x: get(ev.truth), y: get(f), ev, f }; }).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const host = document.getElementById(hostId); host.replaceChildren();
  if (!pts.length) { host.append(el('div', { class: 'empty', text: '沒有資料' })); return; }
  const lo = Math.min(...pts.map((p) => Math.min(p.x, p.y))); const hi = Math.max(...pts.map((p) => Math.max(p.x, p.y)));
  const pad = (hi - lo) * 0.05 || 1;
  const { root, X, Y } = frame(440, 360, { l: 40, r: 12, t: 14, b: 30 }, [lo - pad, hi + pad], [lo - pad, hi + pad], { xLabel: `中央氣象署 ${unit}`, yLabel: `我們 ${unit}`, yFmt: (v) => `${+v.toFixed(1)}`, xFmt: (v) => `${+v.toFixed(1)}` });
  root.append(svg('line', { class: 'diag', x1: X(lo - pad), y1: Y(lo - pad), x2: X(hi + pad), y2: Y(hi + pad) }));
  for (const p of pts) {
    const c = svg('circle', { class: 'scatter-dot', cx: X(p.x), cy: Y(p.y), r: 4 });
    hover(c, `${p.ev.truth.location || ''} ${fmtTime(p.ev.truth.originMs)}\n中央氣象署 ${fix(p.x, digits)}、我們 ${fix(p.y, digits)}（差 ${fix(p.y - p.x, digits)}）`);
    c.addEventListener('click', () => { location.href = `event.html?y=${encodeURIComponent(p.ev.year)}&id=${encodeURIComponent(p.ev.eventId)}`; });
    root.append(c);
  }
  host.append(root);
  document.getElementById(tableId).replaceChildren(...bins.map(([a, b, name]) => {
    const g = pts.filter((p) => p.x >= a && p.x < b); const d = g.map((p) => p.y - p.x);
    return el('tr', {}, el('td', { text: name }), el('td', { class: 'r', text: String(g.length) }),
      el('td', { class: 'r', text: g.length ? `${d.length && q(d, 0.5) > 0 ? '+' : ''}${fix(q(d, 0.5), digits)}` : '—' }),
      el('td', { class: 'r', text: g.length ? fix(q(d.map(Math.abs), 0.9), digits) : '—' }));
  }));
}

async function renderVersions() {
  let list = [];
  try { list = (await getJson('data/versions.json')) || []; } catch { /* 還沒有 */ }
  list.sort((a, b) => String(b.version).localeCompare(String(a.version), undefined, { numeric: true }));
  const km1 = (v) => (Number.isFinite(v) ? `${v.toFixed(1)} km` : '—');
  document.getElementById('t-ver').replaceChildren(...(list.length ? list.map((v) => el('tr', {},
    el('td', { text: v.version }), el('td', { text: v.date || '—' }), el('td', { class: 'r', text: String(v.events ?? '—') }),
    el('td', { class: 'r', text: km1(v.epi5Med) }), el('td', { class: 'r', text: km1(v.epi10Med) }), el('td', { class: 'r', text: km1(v.epi20Med) }),
    el('td', { class: 'r', text: km1(v.epiMed) }), el('td', { class: 'r', text: km1(v.epiP90) }),
    el('td', { class: 'r', text: Number.isFinite(v.within10) ? `${Math.round(v.within10 * 100)}%` : '—' }),
    el('td', { class: 'r', text: km1(v.depthAbsMed) }),
    el('td', { class: 'r', text: Number.isFinite(v.magBiasMed) ? `${v.magBiasMed > 0 ? '+' : ''}${v.magBiasMed.toFixed(2)}` : '—' }),
    el('td', { class: 'r', text: Number.isFinite(v.firstReportMed) ? `${v.firstReportMed.toFixed(0)} 秒` : '—' })))
    : [el('tr', {}, el('td', { colspan: '12', class: 'muted', text: '還沒有版本成績' }))]));
}

async function renderAll(all) {
  const evs = filtered(all);
  document.getElementById('n').textContent = `納入 ${evs.length} 場`;
  renderTime(evs); renderHist(evs); renderSpeed(evs); renderMap(evs);
  scatter('c-mag', 't-mag', evs, { get: (o) => o.magnitude, unit: 'M', digits: 1,
    bins: [[0, 3.5, 'M3.5 以下'], [3.5, 4.5, 'M3.5–4.5'], [4.5, 5.5, 'M4.5–5.5'], [5.5, 10, 'M5.5 以上']] });
  scatter('c-depth', 't-depth', evs, { get: (o) => o.depth, unit: 'km', digits: 0,
    bins: [[0, 20, '< 20 km'], [20, 40, '20–40 km'], [40, 80, '40–80 km'], [80, 999, '≥ 80 km']] });
  await renderPull(evs);
}

(async () => {
  try {
    years = ((await getJson('data/years.json')) || []).sort();
    coast = await getJson('coast.json').catch(() => null);
  } catch { document.getElementById('status').textContent = '還沒有資料'; return; }
  const ys = document.getElementById('f-year');
  ys.replaceChildren(el('option', { value: '', text: '全部' }), ...[...years].reverse().map((y) => el('option', { value: y, text: y })));
  setupMapInteraction();
  renderVersions();
  let all = [];
  const reload = async () => { all = await loadEvents(ys.value); document.getElementById('status').textContent = ''; await renderAll(all); };
  ys.addEventListener('change', reload);
  for (const id of ['f-src', 'f-mag', 'f-depth']) document.getElementById(id).addEventListener('change', () => renderAll(all));
  await reload();
})();
