// HOMO_eew 推算紀錄網站：讀 data/ 的 JSON（HOMO_eew 程式上傳），列出事件、和中央氣象署對照、每一報。不用任何外部函式庫。
// 資料：data/years.json = ["2026", …]；data/{年}/index.json = 事件摘要陣列；data/{年}/{事件代號}.json = 事件記錄（homo-sidecar records.rs）

const TZ_OFFSET_MS = 8 * 3600 * 1000;
const pad = (n) => String(n).padStart(2, '0');
// 台灣時間 YYYY/MM/DD HH:MM:SS
function fmtTime(ms) {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms + TZ_OFFSET_MS);
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
function km(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180;
  const x = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lng2 - lng1) * r / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}
const fix = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
async function getJson(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path}：HTTP ${r.status}`);
  return r.json();
}
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}
const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

// 單一序列折線圖：points = [{x, y, low, label}]；truth = 真值（水平虛線）或 null
function lineChart(host, { points, truth, truthLabel, refClass = 'truth-line', yUnit, yMin, yFloorSpan = 1, xUnit = 's' }) {
  host.replaceChildren();
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!pts.length) {
    host.append(el('div', { class: 'empty', text: '沒有資料' }));
    return;
  }
  const W = 520; const H = 230; const m = { l: 40, r: 56, t: 12, b: 30 };
  const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y).concat(Number.isFinite(truth) ? [truth] : []);
  const x0 = Math.min(0, ...xs); const x1 = Math.max(...xs, x0 + 1);
  let y0 = Math.min(...ys); let y1 = Math.max(...ys);
  if (Number.isFinite(yMin)) y0 = Math.min(yMin, y0);
  if (y1 - y0 < yFloorSpan) { const c = (y0 + y1) / 2; y0 = Number.isFinite(yMin) ? Math.max(yMin, c - yFloorSpan / 2) : c - yFloorSpan / 2; y1 = y0 + yFloorSpan; }
  const padY = (y1 - y0) * 0.08; y1 += padY; if (!Number.isFinite(yMin) || y0 - padY >= yMin) y0 -= padY;
  const X = (v) => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r);
  const Y = (v) => H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const grid = svg('g', { class: 'grid' }); const axis = svg('g', { class: 'axis' });
  for (const t of niceTicks(y0, y1)) {
    grid.append(svg('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t) }));
    const tx = svg('text', { x: m.l - 6, y: Y(t) + 4, 'text-anchor': 'end' }); tx.textContent = `${+t.toFixed(2)}`; axis.append(tx);
  }
  for (const t of niceTicks(x0, x1, 6)) {
    const tx = svg('text', { x: X(t), y: H - m.b + 16, 'text-anchor': 'middle' }); tx.textContent = `${+t.toFixed(1)}`; axis.append(tx);
  }
  const xl = svg('text', { x: W - m.r, y: H - 2, 'text-anchor': 'end' }); xl.textContent = `第一個觸發後（${xUnit}）`; axis.append(xl);
  const yl = svg('text', { x: m.l - 6, y: m.t - 2, 'text-anchor': 'end' }); yl.textContent = yUnit; axis.append(yl);
  root.append(grid, axis);
  if (Number.isFinite(truth)) {
    root.append(svg('line', { class: refClass, x1: m.l, x2: W - m.r, y1: Y(truth), y2: Y(truth) }));
    const t = svg('text', { class: 'truth-label', x: W - m.r + 4, y: Y(truth) + 4 }); t.textContent = truthLabel; root.append(t);
  }
  root.append(svg('path', { class: 'series-line', d: pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('') }));
  for (const p of pts) root.append(svg('circle', { class: `series-dot${p.low ? ' low' : ''}`, cx: X(p.x), cy: Y(p.y), r: 4 }));
  // 最後一點直接標數值
  const last = pts[pts.length - 1];
  const end = svg('text', { class: 'end-label', x: X(last.x) + 7, y: Y(last.y) - 7 }); end.textContent = `${+last.y.toFixed(1)}`;
  if (!Number.isFinite(truth) || Math.abs(Y(last.y) - Y(truth)) > 12) root.append(end);
  // 懸停：十字線＋提示，命中範圍是整個繪圖區（找最近的報）
  const cross = svg('line', { class: 'crosshair', y1: m.t, y2: H - m.b, visibility: 'hidden' });
  const hit = svg('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' });
  root.append(cross, hit);
  const tip = document.getElementById('tooltip');
  hit.addEventListener('pointermove', (e) => {
    const box = root.getBoundingClientRect();
    const sx = (e.clientX - box.left) / box.width * W;
    const p = pts.reduce((a, b) => (Math.abs(X(b.x) - sx) < Math.abs(X(a.x) - sx) ? b : a));
    cross.setAttribute('x1', X(p.x)); cross.setAttribute('x2', X(p.x)); cross.setAttribute('visibility', 'visible');
    tip.textContent = p.label;
    tip.style.display = 'block';
    tip.style.left = `${Math.min(e.clientX + 12, window.innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${e.clientY + 12}px`;
  });
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; });
  host.append(root);
}

// ── 驗證 ──
// 人工標籤（網站管理設定，index 的 label：real／fake）優先；沒標籤時，有中央氣象署報告的算真地震
function verdictOf(e) {
  if (e.label === 'real' || e.label === 'fake') return { v: e.label, manual: true };
  if (e.truth) return { v: 'real', manual: false };
  return { v: 'none', manual: false };
}
function verdictTag(e) {
  const { v, manual } = verdictOf(e);
  if (v === 'real') return el('span', { class: 'tag real', title: manual ? '人工確認是真的地震' : '中央氣象署有這個地震的報告', text: manual ? '真地震' : '真地震（中央氣象署）' });
  if (v === 'fake') return el('span', { class: 'tag fake', title: '人工確認不是地震（雜訊、遠方大地震誤判等）', text: '假事件' });
  return el('span', { class: 'tag', title: '沒有中央氣象署報告，也還沒人工確認', text: '未驗證' });
}

// ── 首頁 ──
async function renderIndex() {
  const tabs = document.getElementById('years');
  const body = document.getElementById('rows');
  const status = document.getElementById('status');
  let years;
  try { years = await getJson('data/years.json'); } catch (e) { status.textContent = '還沒有資料'; return; }
  years.sort().reverse();
  const show = async (year) => {
    for (const b of tabs.children) b.setAttribute('aria-pressed', String(b.dataset.year === year));
    status.textContent = '載入中…';
    let list = [];
    try { list = await getJson(`data/${year}/index.json`); } catch (e) { status.textContent = String(e.message); return; }
    // 管理介面隱藏的事件（hidden: true）不列出；檔案還在，網址直接開仍看得到
    list = list.filter((e) => !e.hidden);
    const want = document.getElementById('f-verdict').value;
    if (want) list = list.filter((e) => verdictOf(e).v === want);
    list.sort((a, b) => (b.firstTriggerMs ?? 0) - (a.firstTriggerMs ?? 0));
    body.replaceChildren(...list.map((ev) => {
      const f = ev.final || {}; const t = ev.truth;
      const err = t && Number.isFinite(f.lat) ? km(f.lat, f.lng, t.lat, t.lng) : null;
      const link = el('a', { href: `event.html?y=${encodeURIComponent(year)}&id=${encodeURIComponent(ev.eventId)}`, text: fmtTime(f.originMs ?? ev.firstTriggerMs) });
      return el('tr', {},
        el('td', {}, link),
        // 沒有中央氣象署報告：經緯度後面加地名（程式記錄時用地圖同一套規則算好的 place；舊事件由網站管理補）
        el('td', { text: t ? t.location || '' : `${fix(f.lat, 2)}, ${fix(f.lng, 2)}${ev.place ? `（${ev.place}）` : ''}` }),
        el('td', { class: 'r', text: Number.isFinite(f.magnitude) ? `M ${fix(f.magnitude)}` : '—' }),
        el('td', { class: 'r', text: Number.isFinite(f.depth) ? `${Math.round(f.depth)} km` : '—' }),
        el('td', { class: 'r', text: String(ev.reports ?? '—') }),
        el('td', { class: 'r', text: t ? `M ${fix(t.magnitude)}・${fix(t.depth)} km` : '' }, t ? null : el('span', { class: 'tag', text: '無中央氣象署報告' })),
        el('td', { class: 'r', text: err === null ? '—' : `${fix(err)} km` }),
        el('td', {}, verdictTag(ev)),
        el('td', {}, ev.cancelled ? el('span', { class: 'tag', text: '已取消' }) : null,
          ev.rebuilt ? el('span', { class: 'tag', title: '用目前版本的程式，拿當時存下的測站資料事後重算；不是當時即時發出的結果', text: '事後重算' }) : null)
      );
    }));
    status.textContent = list.length ? `${year} 年共 ${list.length} 場` : (want ? `${year} 年沒有符合的事件` : `${year} 年還沒有事件`);
  };
  let current = null;
  document.getElementById('f-verdict').addEventListener('change', () => current && show(current));
  tabs.replaceChildren(...years.map((y) => {
    const b = el('button', { type: 'button', text: y, 'aria-pressed': 'false' });
    b.dataset.year = y;
    b.addEventListener('click', () => { current = y; show(y); });
    return b;
  }));
  if (years.length) { current = years[0]; show(years[0]); }
}

// ── 事件頁 ──
// PGA → 震度（與程式 intensityLabelForPga 相同）
function intensityOf(pga) {
  const v = Number(pga) || 0;
  const steps = [[0.8, '0'], [2.5, '1'], [8, '2'], [25, '3'], [80, '4'], [140, '5弱'], [250, '5強'], [400, '6弱'], [800, '6強']];
  for (const [lim, label] of steps) if (v < lim) return label;
  return '7';
}


// ── 震度對比（2026-11-28）：預估／P-Alert 實測／中央氣象署 三張本島鄉鎮色塊圖 ──
// 做法參考 ExpTech 報告頁的「色塊對比」：用附近測站的實測值推估各鄉鎮震度（越近的測站影響越大），離最近測站太遠的鄉鎮不上色。
// - 預估：Core 上傳時用最終報的震源與規模、GMM 算好各鄉鎮代表點的 PGA／PGV（estimate）；中央氣象署新制：4 級以下看 PGA、5 弱以上看 PGV
// - P-Alert 實測：這個事件各站的最大 PGA（peaks，只有屬於這個事件的站），log PGA 依距離平方反比內插到鄉鎮代表點
// - 中央氣象署：報告列出的測站震度（truth.stations），震度級依距離平方反比內插
// 「太遠」的距離從各自的站推：這批站彼此最近距離（站距）的第 95 百分位。P-Alert 站密、半徑小；中央氣象署報告站稀、半徑大
const INTENSITY_ORDER = ['0', '1', '2', '3', '4', '5弱', '5強', '6弱', '6強', '7'];
// 震度顏色：跟程式的震度圖示同一組（static/震度圖案新）
const INTENSITY_COLORS = { 1: '#0047AB', 2: '#00ACEB', 3: '#00FF00', 4: '#FFFF00', '5弱': '#D66B00', '5強': '#C23000', '6弱': '#990000', '6強': '#AD006E', 7: '#6500A8' };
// 中央氣象署 2020 新制 5 弱以上的 PGV 下限（cm/s）
const CWA_PGV_THRESHOLDS = [[140, '7'], [80, '6強'], [50, '6弱'], [30, '5強'], [15, '5弱']];
const SHAKE_COVER_QUANTILE = 0.95;
// 地圖投影：同統計頁（1° ≈ 100 單位、經度乘 cos 23.7°）
const SHAKE_KX = Math.cos(23.7 * Math.PI / 180);
const shakeProj = (lng, lat) => [(lng - 120) * SHAKE_KX * 100, (25.6 - lat) * 100];
let townTable = null;
async function towns() {
  if (!townTable) { try { townTable = await getJson('towns.json'); } catch { townTable = []; } }
  return townTable;
}

function predictedLabel(pga, pgv) {
  const byPga = intensityOf(pga);
  if (INTENSITY_ORDER.indexOf(byPga) < INTENSITY_ORDER.indexOf('5弱')) return byPga;
  const hit = CWA_PGV_THRESHOLDS.find(([v]) => pgv >= v);
  return hit ? hit[1] : '4';
}

function coverRadius(points) {
  const nn = points.map((p, i) => points.reduce((m, q, j) => (i === j ? m : Math.min(m, km(p.lat, p.lng, q.lat, q.lng))), Infinity))
    .filter(Number.isFinite).sort((a, b) => a - b);
  return nn.length ? nn[Math.min(nn.length - 1, Math.floor(SHAKE_COVER_QUANTILE * nn.length))] : 0;
}

// 距離平方反比內插：points = [{lat, lng, v}]；超過 radius 的點不用；全部都太遠回 null
function idw(lat, lng, points, radius) {
  let sw = 0; let sv = 0;
  for (const p of points) {
    const d = km(lat, lng, p.lat, p.lng);
    if (d > radius) continue;
    const w = 1 / Math.max(d, 1) ** 2;
    sw += w; sv += w * p.v;
  }
  return sw > 0 ? sv / sw : null;
}

async function renderShakeCompare(ev, fin, st) {
  const host = document.getElementById('shake');
  if (!host) return;
  const tw = await towns();
  const est = ev.estimate;
  const peaks = (ev.peaks || []).map(([id, pga]) => ({ s: st.get(id), pga })).filter((x) => x.s && x.pga > 0);
  const cwa = (ev.truth?.stations || []).filter((x) => INTENSITY_ORDER.includes(String(x[2])));
  if (!tw.length || (!est && !peaks.length && !cwa.length)) { host.hidden = true; return; }
  // 本島範圍：海岸線外加一點（跟程式右上角預估圖同一塊）
  const main = tw.filter((t) => t.c && t.c[0] > 21.85 && t.c[0] < 25.4 && t.c[1] > 119.98 && t.c[1] < 122.1);
  const radii = [];
  const labels = [];
  if (est) {
    const m = new Map(est.towns.map((ti, i) => [ti, predictedLabel(est.pga[i], est.pgv[i])]));
    labels.push({ title: '預估（GMM）', sub: `最終報 M${fix(fin.magnitude)}・${fix(fin.depth, 0)} km`, of: (i) => m.get(i) });
  }
  if (peaks.length) {
    const pts = peaks.map((x) => ({ lat: x.s.lat, lng: x.s.lon, v: Math.log10(x.pga) }));
    const radius = coverRadius(pts);
    radii.push(`P-Alert ${fix(radius)} km`);
    labels.push({ title: 'P-Alert 實測', sub: `${peaks.length} 站`, of: (i) => { const v = idw(tw[i].c[0], tw[i].c[1], pts, radius); return v == null ? null : intensityOf(10 ** v); } });
  }
  if (cwa.length) {
    const pts = cwa.map(([lat, lng, l]) => ({ lat, lng, v: INTENSITY_ORDER.indexOf(String(l)) }));
    const radius = coverRadius(pts);
    radii.push(`中央氣象署 ${fix(radius)} km`);
    labels.push({ title: '中央氣象署報告', sub: `${cwa.length} 站`, of: (i) => { const v = idw(tw[i].c[0], tw[i].c[1], pts, radius); return v == null ? null : INTENSITY_ORDER[Math.round(v)]; } });
  }
  const paths = tw.map((t) => t.p.map((ring) => ring.map(([lng, lat], k) => { const [x, y] = shakeProj(lng, lat); return `${k ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join('') + 'Z').join(''));
  const [x0, y0] = shakeProj(119.95, 25.4); const [x1, y1] = shakeProj(122.1, 21.85);
  const cross = (lat, lng, cls) => {
    const [x, y] = shakeProj(lng, lat); const r = 4;
    return svg('path', { class: cls, d: `M${x - r},${y - r}L${x + r},${y + r}M${x + r},${y - r}L${x - r},${y + r}` });
  };
  const star = (lat, lng) => {
    const [x, y] = shakeProj(lng, lat);
    const p = Array.from({ length: 10 }, (_, k) => { const a = -Math.PI / 2 + k * Math.PI / 5; const rr = k % 2 ? 2.4 : 6; return `${(x + rr * Math.cos(a)).toFixed(1)},${(y + rr * Math.sin(a)).toFixed(1)}`; });
    return svg('polygon', { class: 'shake-star', points: p.join(' ') });
  };
  const grid = el('div', { class: 'shake-grid' });
  for (const L of labels) {
    const root = svg('svg', { viewBox: `${x0.toFixed(0)} ${y0.toFixed(0)} ${(x1 - x0).toFixed(0)} ${(y1 - y0).toFixed(0)}`, role: 'img' });
    tw.forEach((t, i) => {
      if (!main.includes(t) && !(t.c && t.c[0] > 21.8 && t.c[0] < 25.5 && t.c[1] > 119.9 && t.c[1] < 122.2)) return;
      const l = L.of(i);
      const node = svg('path', { class: 'shake-town', d: paths[i], fill: l && l !== '0' ? INTENSITY_COLORS[l] : 'var(--shake-empty)' });
      if (l && l !== '0') node.append(Object.assign(svg('title'), { textContent: `震度 ${l}` }));
      root.append(node);
    });
    if (Number.isFinite(fin.lat)) root.append(cross(fin.lat, fin.lng, 'shake-cross'));
    if (ev.truth) root.append(star(ev.truth.lat, ev.truth.lng));
    grid.append(el('section', { class: 'card shake-card' }, el('h2', { text: L.title }), el('p', { class: 'desc', text: L.sub }), root));
  }
  const legend = el('div', { class: 'legend-inline shake-legend' }, el('span', { class: 'muted', text: '震度' }),
    ...INTENSITY_ORDER.slice(1).map((l) => el('span', { class: 'key' }, el('span', { class: 'shake-swatch', style: `background:${INTENSITY_COLORS[l]}` }), l)),
    el('span', { class: 'key' }, el('span', { class: 'shake-swatch', style: 'background:var(--shake-empty)' }), '0／附近沒有測站'),
    el('span', { class: 'key', text: '× 推算震央' }), ev.truth ? el('span', { class: 'key', text: '★ 中央氣象署震央' }) : null);
  host.replaceChildren(
    el('h2', { style: 'font-size:16px;margin:0 0 6px', text: '震度對比' }),
    el('p', { class: 'note', text: `實測與報告：用附近測站的值推估各鄉鎮震度（越近的測站影響越大），離最近測站太遠的鄉鎮不上色（${radii.join('、')}：各自站距的第 95 百分位）。預估：用最終報的震源與規模，由 ExpTech YuYu1015 的地動模型（GMM）算出，只是推算。` }),
    legend, grid);
  host.hidden = false;
}

// 穩定度：從第幾報起，之後每一報都在最終報附近（震央 5 km、深度 10 km、規模 0.3 內）。回傳那一報（沒有就 null）
const STABLE = { km: 5, depth: 10, mag: 0.3 };
function stableFrom(reps, fin) {
  const near = (r) => km(r.lat, r.lng, fin.lat, fin.lng) <= STABLE.km && Math.abs(r.depth - fin.depth) <= STABLE.depth
    && (!Number.isFinite(fin.magnitude) || !Number.isFinite(r.magnitude) || Math.abs(r.magnitude - fin.magnitude) <= STABLE.mag);
  let k = reps.length;
  while (k > 0 && near(reps[k - 1])) k -= 1;
  return k < reps.length ? reps[k] : null;
}

// 測站表（stations.json：[[代號, 縣市, 站名, 緯度, 經度], …]）
let stationTable = null;
async function stations() {
  if (!stationTable) {
    try { stationTable = new Map((await getJson('stations.json')).map(([id, area, name, lat, lon]) => [id, { area, name, lat, lon }])); }
    catch { stationTable = new Map(); }
  }
  return stationTable;
}

async function renderEvent() {
  const q = new URLSearchParams(location.search);
  const year = q.get('y'); const id = q.get('id');
  const title = document.getElementById('title');
  if (!year || !id || !/^[\w-]+$/.test(id) || !/^\d{4}$/.test(year)) { title.textContent = '找不到事件'; return; }
  let ev;
  try { ev = await getJson(`data/${year}/${id}.json`); } catch (e) { title.textContent = `找不到事件 ${id}`; return; }
  const reps = ev.reports || [];
  const fin = [...reps].reverse().find((r) => r.kind !== 'report') || reps[reps.length - 1] || {};
  const t = ev.truth;
  document.title = `${t?.location || id} · HOMO_eew 推算紀錄`;
  title.textContent = t?.location || `事件 ${id}`;
  document.getElementById('meta').textContent = `事件代號 ${id}・第一個觸發 ${fmtTime(ev.firstTriggerMs)}・共 ${reps.length} 報${ev.cancelled ? '・已取消' : ''}`
    + (ev.algo?.version ? `・版本 ${ev.algo.version}` : '')
    + (ev.rebuilt ? '・事後重算（用這個版本的程式，拿當時存下的測站資料重算，不是當時即時發出的結果）' : '');

  // 驗證狀態：標籤在年份索引裡（網站管理設定）
  let entry = null;
  try { entry = ((await getJson(`data/${year}/index.json`)) || []).find((e) => e.eventId === id) || null; } catch { /* 沒索引就只看真值 */ }
  const vbox = document.getElementById('verify');
  const { v, manual } = verdictOf({ ...(entry || {}), truth: t });
  const why = v === 'fake' ? '人工確認：這不是地震（雜訊、遠方大地震誤判等），推算結果不用看。'
    : v === 'real' && manual ? '人工確認：這是真的地震。' + (t ? '' : '中央氣象署沒有發報告（通常是規模小）。')
    : v === 'real' ? '中央氣象署有這個地震的報告，下面拿它當真值比對。'
    : '沒有中央氣象署報告，也還沒人工確認是不是真的地震。';
  vbox.replaceChildren(el('strong', { text: '驗證' }), verdictTag({ ...(entry || {}), truth: t }), el('span', { class: 'why', text: why }));
  vbox.hidden = false;

  const st = await stations();
  const top = (ev.topStations || []).map(([id, pga]) => ({ id, pga, info: st.get(id) }));
  const dist = (x) => (x.info ? km(fin.lat, fin.lng, x.info.lat, x.info.lon) : NaN);
  const nearest = top.map(dist).filter(Number.isFinite).reduce((a, b) => Math.min(a, b), Infinity);
  const maxSt = top[0];
  // 沒有中央氣象署地名：用最近觸發站的縣市當標題（標明是推算）
  if (!t) {
    // 地名：記錄裡的 place（地圖同一套規則）或索引裡補上的；都沒有才用最近觸發站的縣市
    const named = fin.place || ev.place || entry?.place;
    const near = top.filter((x) => x.info).sort((a, b) => dist(a) - dist(b))[0];
    const place = named ? `${named}（推算）` : near ? `${near.info.area}附近（推算）` : '推算震央';
    title.textContent = place;
    document.title = `${place} · HOMO_eew 推算紀錄`;
  }
  const stable = stableFrom(reps, fin);
  const stableText = stable ? `第 ${stable.report} 報` : '—';
  const stableSub = stable ? `觸發後 ${fix(stable.sinceFirstS, 0)} 秒起，之後都在最終報附近` : '';

  // 摘要
  const stat = (label, value, sub) => el('div', { class: 'card stat' }, el('div', { class: 'label', text: label }), el('div', { class: 'value', text: value }), el('div', { class: 'sub', text: sub }));
  const first = reps[0] || {};
  const summary = document.getElementById('summary');
  if (t) {
    summary.replaceChildren(
      stat('震央誤差（最終報）', Number.isFinite(fin.lat) ? `${fix(km(fin.lat, fin.lng, t.lat, t.lng))} km` : '—', `${fix(fin.lat, 2)}, ${fix(fin.lng, 2)}｜CWA ${fix(t.lat, 2)}, ${fix(t.lng, 2)}`),
      stat('規模（最終報）', Number.isFinite(fin.magnitude) ? `M ${fix(fin.magnitude)}` : '—', `CWA M ${fix(t.magnitude)}（差 ${fix(fin.magnitude - t.magnitude)}）`),
      stat('深度（最終報）', Number.isFinite(fin.depth) ? `${Math.round(fin.depth)} km` : '—', `CWA ${fix(t.depth)} km（差 ${fix(fin.depth - t.depth, 0)} km）`),
      stat('第一報', Number.isFinite(first.dataMs) ? `發震後 ${fix((first.dataMs - t.originMs) / 1000, 0)} 秒` : '—', Number.isFinite(first.lat) ? `震央差 ${fix(km(first.lat, first.lng, t.lat, t.lng))} km` : ''),
      stat('穩定', stableText, stableSub)
    );
  } else {
    summary.replaceChildren(
      stat('最終推算', Number.isFinite(fin.magnitude) ? `M ${fix(fin.magnitude)}・${Math.round(fin.depth)} km` : `${Math.round(fin.depth)} km`, `${fix(fin.lat, 2)}, ${fix(fin.lng, 2)}・發震 ${fmtTime(fin.originMs)}`),
      stat('穩定', stableText, stableSub),
      stat('證據', `${fin.stations ?? '—'} 站`, `${Number.isFinite(nearest) ? `最近觸發站 ${fix(nearest)} km・` : ''}P ${fin.phaseP ?? '—'}・S ${fin.phaseS ?? '—'}`),
      stat('最大震度', maxSt ? intensityOf(maxSt.pga) : '—', maxSt ? `${maxSt.info ? `${maxSt.info.area} ${maxSt.info.name}` : maxSt.id} ${fix(maxSt.pga)} gal` : ''),
      stat('第一報', `觸發後 ${fix(first.sinceFirstS, 0)} 秒`, Number.isFinite(first.lat) ? `離最終報 ${fix(km(first.lat, first.lng, fin.lat, fin.lng))} km` : '')
    );
  }

  // 震度對比（有資料才畫；舊事件沒有就整段不顯示）
  renderShakeCompare(ev, fin, st);

  // 收斂圖：只有對得到中央氣象署的事件才畫（2026-11-22 使用者：小地震不用折線圖，每報列出就好）
  if (!t) {
    document.getElementById('conv').hidden = true;
    document.getElementById('th-epi').textContent = '離最終報 km';
  }
  // 有真值對真值（紅）；沒有真值時這段不顯示（保留對最終報的畫法，之後要再打開只改上面）
  const ref = t || { lat: fin.lat, lng: fin.lng, depth: fin.depth, magnitude: fin.magnitude };
  const refName = t ? 'CWA' : '最終';
  const refClass = t ? 'truth-line' : 'ref-line';
  if (!t) {
    document.getElementById('conv-title').textContent = '和最終報對照';
    const note = document.getElementById('conv-note');
    note.hidden = false;
    note.textContent = '這個事件沒有中央氣象署報告（通常是規模小、沒有發布），沒有真值可比；下面量的是推算多快穩定下來，不代表準確。';
    document.getElementById('legend-ref').textContent = '最終報';
    document.getElementById('legend-ref-swatch').className = 'swatch-ref';
    document.getElementById('t-epi').textContent = '離最終報的距離';
    document.getElementById('d-epi').textContent = '每一報的震央離最終報震央多遠';
    document.getElementById('d-mag').textContent = '每一報的規模，虛線是最終報';
    document.getElementById('d-depth').textContent = '每一報的深度，虛線是最終報';
  }
  const label = (r, extra) => `第 ${r.report} 報${r.kind === 'final' ? '（最終）' : r.kind === 'supplement' ? '（追加）' : ''}・觸發後 ${fix(r.sinceFirstS, 0)} 秒\n${extra}`;
  const pt = (r, y, extra, low = false) => ({ x: r.sinceFirstS, y, low, label: label(r, extra) });
  lineChart(document.getElementById('c-epi'), {
    points: reps.map((r) => { const d = km(r.lat, r.lng, ref.lat, ref.lng); return pt(r, d, `${t ? '震央誤差' : '離最終報'} ${fix(d)} km`); }), yUnit: 'km', yMin: 0, yFloorSpan: 5
  });
  lineChart(document.getElementById('c-mag'), {
    points: reps.map((r) => pt(r, r.magnitude, `M ${fix(r.magnitude)}${r.magLow ? '（低精度）' : ''}・${r.magStations ?? '—'} 站`, !!r.magLow)),
    truth: ref.magnitude, truthLabel: `${refName} ${fix(ref.magnitude)}`, refClass, yUnit: 'M', yFloorSpan: 1
  });
  lineChart(document.getElementById('c-depth'), {
    points: reps.map((r) => pt(r, r.depth, `深度 ${fix(r.depth, 0)} km`)),
    truth: ref.depth, truthLabel: `${refName} ${fix(ref.depth, t ? 1 : 0)}`, refClass, yUnit: 'km', yMin: 0, yFloorSpan: 10
  });
  lineChart(document.getElementById('c-st'), {
    points: reps.map((r) => pt(r, r.stations, `${r.stations} 站（P ${r.phaseP}・S ${r.phaseS}・O ${r.phaseO}）`)), yUnit: '站', yMin: 0, yFloorSpan: 5
  });

  // 測站觀測
  document.getElementById('st-rows').replaceChildren(...(top.length ? top.map((x) => el('tr', {},
    el('td', { text: x.info ? `${x.info.area} ${x.info.name}` : x.id }),
    el('td', { class: 'r', text: fix(dist(x)) }),
    el('td', { class: 'r', text: fix(x.pga, 2) }),
    el('td', { class: 'r', text: intensityOf(x.pga) })
  )) : [el('tr', {}, el('td', { colspan: '4', class: 'muted', text: '這筆記錄沒有測站資料（較早的版本）' }))]));

  // 每一報
  document.getElementById('rows').replaceChildren(...reps.map((r) => el('tr', {},
    el('td', { text: `${r.report}${r.kind === 'final' ? '（終）' : r.kind === 'supplement' ? `（追加 ${r.revision}）` : ''}` }),
    el('td', { class: 'r', text: fix(r.sinceFirstS, 0) }),
    // 發震後秒數：有中央氣象署用它的發震時間，沒有就用我們最終報的發震時間
    el('td', { class: 'r', text: fix((r.dataMs - (t ? t.originMs : fin.originMs)) / 1000, 0) }),
    el('td', { text: `${fix(r.lat, 2)}, ${fix(r.lng, 2)}` }),
    el('td', { class: 'r', text: t ? fix(km(r.lat, r.lng, t.lat, t.lng)) : fix(km(r.lat, r.lng, fin.lat, fin.lng)) }),
    el('td', { class: 'r', text: fix(r.depth, 0) }),
    el('td', { class: 'r', text: Number.isFinite(r.magnitude) ? `${fix(r.magnitude)}${r.magLow ? '（低）' : ''}` : '—' }),
    el('td', { class: 'r', text: String(r.stations) }),
    el('td', { class: 'r', text: `${r.phaseP}/${r.phaseS}/${r.phaseO}` }),
    el('td', { class: 'r', text: Number.isFinite(r.maxPga) ? fix(r.maxPga) : '—' })
  )));
}
