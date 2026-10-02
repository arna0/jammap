// JamMap dashboard: polls the relayer's free /v1/map endpoint and draws zones,
// phones, (in demo) source estimates, and a live report feed.

const API = location.origin;
const KIND = { 1: ['JAMMING', 'jam'], 2: ['SPOOFING', 'spoof'], 3: ['JAM + SPOOF', 'jam'] };
const COLOR = { jam: '#ff4d5e', spoof: '#b06bff', pend: '#ffb547', dev: '#2ee6c5' };

const map = L.map('map', { zoomControl: true, attributionControl: true, worldCopyJump: true }).setView([42.33, 69.59], 11);
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
L.tileLayer(`${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
  maxZoom: 16,
  attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
}).addTo(map);
L.tileLayer(`${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16, pane: 'shadowPane' }).addTo(map);

const layers = {
  zones: L.layerGroup().addTo(map),
  devices: L.layerGroup().addTo(map),
  sources: L.layerGroup().addTo(map),
};

const $ = (id) => document.getElementById(id);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const ago = (ms) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

let state = null;
let fitted = false;
let seenFeed = new Set();
let cluster = 'devnet';
const explorer = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=${cluster}`;

function kindOf(i) {
  if (!i.confirmed) return 'pend';
  return i.kinds & 1 ? 'jam' : 'spoof';
}

function drawMap(s) {
  layers.zones.clearLayers();
  layers.devices.clearLayers();
  layers.sources.clearLayers();
  const showSrc = s.preview && $('previewChk').checked;

  for (const i of s.incidents) {
    const k = kindOf(i);
    const z = i.zone;
    const rect = L.rectangle(
      [[z.south, z.west], [z.north, z.east]],
      {
        color: COLOR[k],
        weight: 2,
        dashArray: i.confirmed ? null : '6 6',
        fillColor: COLOR[k],
        fillOpacity: i.confirmed ? 0.18 : 0.06,
      }
    ).bindPopup(
      `<b>${KIND[i.kinds][0]}</b> · ${i.confirmed ? 'confirmed' : 'unconfirmed'}<br>` +
        `${i.reporters}/${i.quorum} phones · severity ${i.maxSeverity}/3<br>zone ${i.cellId}`
    );
    layers.zones.addLayer(rect);

    if (showSrc && i.source) {
      const cls = i.kinds & 1 ? '' : 'spoof';
      L.circle([i.source.lat, i.source.lon], {
        radius: i.source.radiusKm * 1000,
        color: COLOR[i.kinds & 1 ? 'jam' : 'spoof'],
        weight: 1,
        fillOpacity: 0.08,
      }).addTo(layers.sources);
      L.marker([i.source.lat, i.source.lon], {
        icon: L.divIcon({ className: '', html: `<div class="src-marker ${cls}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] }),
      })
        .bindPopup(`<b>Estimated source</b><br>±${i.source.radiusKm} km from ${i.source.basedOn} phones`)
        .addTo(layers.sources);
      for (const r of i.reports || []) {
        L.circleMarker([r.lat, r.lon], { radius: 5, color: '#fff', weight: 1, fillColor: COLOR[r.kind === 1 ? 'jam' : 'spoof'], fillOpacity: 0.9 })
          .bindPopup(`ΔC/N0 ${r.dCn0} dB · ΔAGC ${r.dAgc} dB`)
          .addTo(layers.sources);
      }
    }
  }
  for (const d of s.devices) {
    L.circleMarker([d.lat, d.lon], { radius: 4, color: COLOR.dev, weight: 1, fillColor: COLOR.dev, fillOpacity: 0.7 }).addTo(layers.devices);
  }
  if (!fitted && (s.devices.length || s.incidents.length)) {
    fit();
    fitted = true;
  }
}

function fit() {
  const pts = [];
  for (const d of state?.devices || []) pts.push([d.lat, d.lon]);
  for (const i of state?.incidents || []) pts.push([i.zone.south, i.zone.west], [i.zone.north, i.zone.east]);
  if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 13 });
}

function drawStats(s) {
  for (const b of document.querySelectorAll('#stats b')) {
    const v = s.stats[b.dataset.k];
    if (b.textContent !== String(v)) {
      b.textContent = v;
      b.classList.add('bump');
      setTimeout(() => b.classList.remove('bump'), 700);
    }
  }
}

function drawIncidents(s) {
  const ul = $('incidents');
  const list = [...s.incidents].sort((a, b) => b.confirmed - a.confirmed || b.lastSeen - a.lastSeen);
  ul.replaceChildren(
    ...(list.length
      ? list.map((i) => {
          const k = kindOf(i);
          const pct = Math.min(100, (i.reporters / i.quorum) * 100);
          return h(
            'li',
            { class: `inc ${k === 'pend' ? '' : k}`, onclick: () => map.fitBounds([[i.zone.south, i.zone.west], [i.zone.north, i.zone.east]], { padding: [60, 60] }) },
            h('div', { class: 'row' },
              h('span', { class: 'kind' }, KIND[i.kinds][0]),
              h('span', { class: `state ${i.confirmed ? 'ok' : 'pend'}` }, i.confirmed ? '✓ CONFIRMED' : 'AWAITING QUORUM')
            ),
            h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })),
            h('div', { class: 'meta' },
              h('span', {}, `${i.reporters}/${i.quorum} phones`),
              h('span', {}, `sev ${'●'.repeat(i.maxSeverity)}${'○'.repeat(3 - i.maxSeverity)}`),
              h('span', {}, `first ${ago(i.firstSeen)}`),
              i.txs.length ? h('a', { href: explorer(i.txs.at(-1)), target: '_blank', rel: 'noopener' }, `${i.txs.length} tx ↗`) : null,
              i.test ? h('span', { class: 'tag' }, 'TEST') : null
            )
          );
        })
      : [h('li', { class: 'empty' }, 'Listening… no interference yet.')])
  );
}

function drawFeed(s) {
  const ol = $('feed');
  const fresh = new Set();
  ol.replaceChildren(
    ...s.feed.map((r) => {
      fresh.add(r.id);
      const chainCell =
        r.chain?.tx ? h('a', { class: 'tx', href: explorer(r.chain.tx), target: '_blank', rel: 'noopener' }, `${r.chain.tx.slice(0, 6)}… ↗`)
        : r.chain?.status === 'pending' ? h('span', { class: 'tx' }, 'sending…')
        : r.chain?.status === 'failed' ? h('span', { class: 'tx', title: r.chain.error }, 'failed')
        : h('span', { class: 'tx' }, 'off-chain');
      return h('li', { class: seenFeed.size && !seenFeed.has(r.id) ? 'new' : '' },
        h('time', {}, clock(r.ts)),
        h('span', {}, h('b', { class: `k${r.kind}` }, r.kind === 1 ? 'jamming' : 'spoofing'), ` sev ${r.severity} `, h('span', { class: 'dev' }, r.device)),
        chainCell
      );
    })
  );
  seenFeed = fresh;
}

async function poll() {
  try {
    const preview = new URLSearchParams(location.search).get('preview') !== '0';
    const s = await fetch(`${API}/v1/map${preview ? '?preview=1' : ''}`).then((r) => r.json());
    state = s;
    if (s.chain) {
      cluster = s.chain.cluster;
      const a = $('chainBadge');
      a.textContent = `solana ${s.chain.cluster} · ${s.chain.programId.slice(0, 4)}…${s.chain.programId.slice(-4)}`;
      a.href = `https://explorer.solana.com/address/${s.chain.programId}?cluster=${s.chain.cluster}`;
      a.className = 'badge ok';
    } else {
      $('chainBadge').textContent = 'chain: off (local mode)';
      $('chainBadge').removeAttribute('href');
    }
    $('previewBadge').hidden = !s.preview;
    $('previewToggle').hidden = !s.preview;
    drawStats(s);
    drawMap(s);
    drawIncidents(s);
    drawFeed(s);
  } catch (e) {
    console.warn('poll failed', e);
  }
}

// ---- x402 demo purchase from the browser (server must run in DEMO mode for the demo payment)
$('tryBtn').addEventListener('click', async () => {
  const out = $('apiOut');
  out.hidden = false;
  const c = map.getCenter();
  const url = `${API}/v1/risk?lat=${c.lat.toFixed(4)}&lon=${c.lng.toFixed(4)}&radius_km=25`;
  out.replaceChildren(h('div', {}, `GET ${url.replace(API, '')}`));
  const first = await fetch(url);
  const body402 = await first.json();
  const req = body402.accepts?.[0];
  out.append(h('div', {}, `← ${first.status} ${first.status === 402 ? `Payment Required: ${req.extra.priceUsd} USDC on ${req.network}` : ''}`));
  if (first.status !== 402) return;
  if (!req.extra.demoAccepted) {
    out.append(h('div', {}, 'Real payments: run `npm run buy` with a devnet USDC wallet.'));
    return;
  }
  const header = btoa(JSON.stringify({ x402Version: 1, scheme: 'exact', network: req.network, payload: { demo: true } }));
  out.append(h('div', {}, '→ X-PAYMENT (demo)'));
  const paid = await fetch(url, { headers: { 'X-PAYMENT': header } });
  const data = await paid.json();
  out.append(
    h('div', {}, `← ${paid.status} OK`),
    h('div', {}, 'risk: ', h('span', { class: `lvl ${data.risk.level}` }, `${data.risk.level.toUpperCase()} ${data.risk.score}/100`)),
    ...data.incidents.slice(0, 4).map((i) =>
      h('div', {}, `• ${KIND[i.kinds][0].toLowerCase()} ${i.confirmed ? '✓' : '…'} ${i.source ? `src ${i.source.lat.toFixed(3)},${i.source.lon.toFixed(3)} ±${i.source.radiusKm}km` : ''}`)
    )
  );
});

$('fitBtn').addEventListener('click', fit);
$('previewChk').addEventListener('change', () => state && drawMap(state));
poll();
setInterval(poll, 2000);
