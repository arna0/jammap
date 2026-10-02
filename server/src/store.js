// In-memory state with JSON snapshot. Mirrors what the chain knows, plus the
// precise (off-chain) positions that never go on-chain.

import fs from 'node:fs';
import path from 'node:path';
import { QUORUM, cellBounds, cellCenter } from './shared.js';
import { estimateSource } from './localize.js';

const MAX_REPORTS = 5000;

export class Store {
  constructor(file) {
    this.file = file;
    this.devices = new Map();
    this.reports = [];
    this.incidents = new Map();
    this.seq = 0;
    this.load();
  }

  load() {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const s = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.seq = s.seq || 0;
      for (const d of s.devices || []) this.devices.set(d.deviceKey, d);
      this.reports = s.reports || [];
      for (const i of s.incidents || []) this.incidents.set(i.key, { ...i, reporters: new Set(i.reporters) });
    } catch (e) {
      console.warn('[store] could not read snapshot, starting empty:', e.message);
    }
  }

  save() {
    if (!this.file) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const incidents = [...this.incidents.values()].map((i) => ({ ...i, reporters: [...i.reporters] }));
      fs.writeFileSync(this.file, JSON.stringify({ seq: this.seq, devices: [...this.devices.values()], reports: this.reports, incidents }));
    }, 500);
  }

  reset() {
    this.devices.clear();
    this.reports = [];
    this.incidents.clear();
    this.save();
  }

  upsertDevice(d) {
    const prev = this.devices.get(d.deviceKey) || { reports: 0, registeredAt: Date.now() };
    const next = { ...prev, ...d };
    this.devices.set(d.deviceKey, next);
    this.save();
    return next;
  }

  hasVote(deviceKey, cell, window) {
    const inc = this.incidents.get(`${cell}:${window}`);
    return !!inc && inc.reporters.has(deviceKey);
  }

  addReport(r) {
    const report = { id: ++this.seq, receivedAt: Date.now(), chain: { status: 'off' }, ...r };
    this.reports.push(report);
    if (this.reports.length > MAX_REPORTS) this.reports.splice(0, this.reports.length - MAX_REPORTS);

    const key = `${r.cellId}:${r.window}`;
    let inc = this.incidents.get(key);
    if (!inc) {
      inc = {
        key,
        cellId: r.cellId,
        window: r.window,
        kinds: 0,
        reporters: new Set(),
        maxSeverity: 0,
        confirmed: false,
        firstTs: r.ts,
        lastTs: r.ts,
        confirmedAt: null,
        reportIds: [],
        txs: [],
        test: !!r.test,
      };
      this.incidents.set(key, inc);
    }
    inc.kinds |= r.kind;
    inc.reporters.add(r.deviceKey);
    inc.maxSeverity = Math.max(inc.maxSeverity, r.severity);
    inc.lastTs = Math.max(inc.lastTs, r.ts);
    inc.reportIds.push(report.id);
    let newlyConfirmed = false;
    if (!inc.confirmed && inc.reporters.size >= QUORUM) {
      inc.confirmed = true;
      inc.confirmedAt = Date.now();
      newlyConfirmed = true;
    }

    const dev = this.devices.get(r.deviceKey);
    if (dev) {
      dev.reports = (dev.reports || 0) + 1;
      dev.lastSeen = Date.now();
    }
    this.save();
    return { report, incident: inc, newlyConfirmed };
  }

  setChain(reportId, chain) {
    const rep = this.reports.find((x) => x.id === reportId);
    if (!rep) return;
    rep.chain = chain;
    if (chain.tx) {
      const inc = this.incidents.get(`${rep.cellId}:${rep.window}`);
      if (inc && !inc.txs.includes(chain.tx)) inc.txs.push(chain.tx);
    }
    this.save();
  }

  touchDevice(deviceKey, pos) {
    const d = this.devices.get(deviceKey);
    if (!d) return;
    d.lastSeen = Date.now();
    if (pos) d.lastPos = pos;
  }

  incidentView(inc, { precise }) {
    const reps = inc.reportIds.map((id) => this.reports.find((r) => r.id === id)).filter(Boolean);
    const view = {
      id: inc.key,
      cellId: String(inc.cellId),
      window: String(inc.window),
      kinds: inc.kinds,
      reporters: inc.reporters.size,
      quorum: QUORUM,
      maxSeverity: inc.maxSeverity,
      confirmed: inc.confirmed,
      firstSeen: inc.firstTs * 1000,
      lastSeen: inc.lastTs * 1000,
      confirmedAt: inc.confirmedAt,
      zone: cellBounds(inc.cellId),
      zoneCenter: cellCenter(inc.cellId),
      txs: inc.txs,
      test: inc.test,
    };
    if (precise) {
      view.source = estimateSource(reps);
      view.reports = reps.map((r) => ({
        lat: r.lat,
        lon: r.lon,
        ts: r.ts * 1000,
        kind: r.kind,
        severity: r.severity,
        dCn0: r.features?.dCn0 ?? null,
        dAgc: r.features?.dAgc ?? null,
        tx: r.chain?.tx || null,
      }));
    }
    return view;
  }
}
