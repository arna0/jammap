// Static demo for GitHub Pages, where there is no relayer.
// CI runs the real relayer (--demo) with the phone simulator and records the
// /v1/map responses into demo/frames.json. This file replays that recording and
// answers the paid /v1/risk and /v1/route calls in the browser with the same
// formulas the server uses (payment is simulated, as in the server's demo mode).
// It only switches on when the page is served from github.io or opened with ?replay.
(() => {
  const params = new URLSearchParams(location.search);
  if (!location.hostname.endsWith('github.io') && !params.has('replay')) return;

  const realFetch = window.fetch.bind(window);
  const framesUrl = new URL('demo/frames.json', document.baseURI).href;
  let frames = null;
  let polls = 0;
  const HOLD_AT_END = 20; // polls (~40 s) on the final state before replaying

  async function loadFrames() {
    if (!frames) frames = await realFetch(framesUrl).then((r) => r.json());
    return frames;
  }

  // Make a recorded frame look current: move every timestamp forward by the same amount.
  function shift(value, offsetMs, key = '') {
    if (Array.isArray(value)) return value.map((v) => shift(v, offsetMs));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = shift(v, offsetMs, k);
      return out;
    }
    if (typeof value === 'number' && /(At|Seen|^ts|Ts)$/.test(key)) {
      if (value > 1e12) return value + offsetMs;
      if (value > 1e9) return Math.round(value + offsetMs / 1000);
    }
    return value;
  }

  async function currentFrame(advance) {
    const all = await loadFrames();
    if (advance) polls = (polls + 1) % (all.length + HOLD_AT_END);
    const f = all[Math.min(polls, all.length - 1)];
    return shift(f, Date.now() - f.generatedAt);
  }

  // ---- same maths as server/src/index.js ----
  function haversineKm(a, b) {
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  }
  function riskScore(incidents, weightOf = () => 1) {
    const now = Date.now() / 1000;
    let score = 0;
    for (const i of incidents) {
      const ageH = (now - i.lastSeen / 1000) / 3600;
      score += (i.confirmed ? 1 : 0.3) * i.maxSeverity * Math.exp(-ageH / 6) * (i.kinds & 2 ? 1.2 : 1) * 20 * weightOf(i);
    }
    score = Math.min(100, Math.round(score));
    return { score, level: score >= 60 ? 'high' : score >= 25 ? 'elevated' : 'low' };
  }
  function pointToSegment(p, a, b) {
    const kx = 111.32 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
    const ky = 110.57;
    const bx = (b.lon - a.lon) * kx, by = (b.lat - a.lat) * ky;
    const px = (p.lon - a.lon) * kx, py = (p.lat - a.lat) * ky;
    const routeKm = Math.hypot(bx, by);
    const along = routeKm ? (px * bx + py * by) / routeKm : 0;
    const lineDistKm = routeKm ? Math.abs(px * by - py * bx) / routeKm : Math.hypot(px, py);
    const t = routeKm ? Math.max(0, Math.min(1, along / routeKm)) : 0;
    return { distKm: Math.hypot(px - t * bx, py - t * by), lineDistKm, along, routeKm };
  }
  function exposedLength(g, radiusKm) {
    if (g.lineDistKm >= radiusKm) return 0;
    const half = Math.sqrt(radiusKm * radiusKm - g.lineDistKm * g.lineDistKm);
    return Math.max(0, Math.min(g.routeKm, g.along + half) - Math.max(0, g.along - half));
  }
  const parsePoint = (s) => {
    const [lat, lon] = String(s || '').split(',').map(Number);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  };
  const paid = { demo: true, note: 'simulated payment (static demo)' };

  function risk(url, incidents) {
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    const radiusKm = Math.min(200, Number(url.searchParams.get('radius_km') || 25));
    const near = incidents
      .filter((i) => haversineKm({ lat, lon }, i.source || i.zoneCenter) <= radiusKm)
      .sort((a, b) => b.lastSeen - a.lastSeen);
    return { query: { lat, lon, radiusKm }, risk: riskScore(near), incidents: near, paid, generatedAt: Date.now() };
  }

  function route(url, incidents) {
    const from = parsePoint(url.searchParams.get('from'));
    const to = parsePoint(url.searchParams.get('to'));
    const corridorKm = Math.min(20, Math.max(0, Number(url.searchParams.get('corridor_km') || 1)));
    if (!from || !to) return [400, { error: 'from and to are required as "lat,lon"' }];
    if (haversineKm(from, to) > 500) return [400, { error: 'route longer than 500 km' }];
    const exposures = [];
    for (const inc of incidents) {
      const center = inc.source || inc.zoneCenter;
      const impactKm = (inc.source?.radiusKm ?? 2) + 2;
      const g = pointToSegment(center, from, to);
      const reach = impactKm + corridorKm;
      if (g.distKm > reach) continue;
      exposures.push({
        incident: inc.id,
        kinds: inc.kinds,
        confirmed: inc.confirmed,
        sensors: inc.reporters,
        maxSeverity: inc.maxSeverity,
        lastSeen: inc.lastSeen,
        center,
        impactKm,
        distanceFromRouteKm: Math.round(g.distKm * 100) / 100,
        atRouteKm: Math.round(Math.max(0, Math.min(g.routeKm, g.along)) * 10) / 10,
        exposedKm: Math.round(exposedLength(g, reach) * 10) / 10,
        lastSeenAgoMin: Math.round((Date.now() - inc.lastSeen) / 60000),
      });
    }
    exposures.sort((a, b) => a.atRouteKm - b.atRouteKm);
    const byId = new Map(exposures.map((e) => [e.incident, e]));
    const hit = incidents.filter((i) => byId.has(i.id));
    const r = riskScore(hit, (i) => Math.min(1, byId.get(i.id).exposedKm / 2));
    return [200, { query: { from, to, corridorKm }, routeKm: Math.round(haversineKm(from, to) * 10) / 10, risk: r, exposures, paid, generatedAt: Date.now() }];
  }

  const reply = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url || String(input), location.href);
    const m = url.origin === location.origin && url.pathname.match(/\/v1\/(map|risk|route|status)$/);
    if (!m) return realFetch(input, init);
    try {
      if (m[1] === 'map') return reply(200, await currentFrame(true));
      const frame = await currentFrame(false);
      if (m[1] === 'risk') return reply(200, risk(url, frame.incidents));
      if (m[1] === 'route') return reply(...route(url, frame.incidents));
      return reply(200, { ok: true, demo: true, staticReplay: true, chain: 'off' });
    } catch (e) {
      return reply(500, { error: String(e) });
    }
  };

  // A small banner so nobody mistakes the replay for live sensors.
  window.addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('div');
    bar.textContent = 'Static demo: replaying a recorded run of the phone simulator (Shymkent). Paid API calls use a simulated payment.';
    bar.style.cssText =
      'position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:9999;max-width:calc(100% - 32px);' +
      'background:#1f2937;color:#f9fafb;font:500 12px/1.4 "IBM Plex Sans",system-ui,sans-serif;padding:8px 12px;' +
      'border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);text-align:center;pointer-events:none';
    document.body.append(bar);
  });
})();
