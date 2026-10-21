// Tiruan layanan Google Apps Script (Spreadsheet, Properties, Cache, dst.) untuk menguji kode.gs di Node.
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

function kolomHuruf(s) { let n = 0; for (const c of s) n = n * 26 + (c.charCodeAt(0) - 64); return n; }

function buatSheet(nama) {
  const sh = {
    nama, data: [], tersembunyi: false, kolomTersembunyi: [], format: {},
    getName() { return this.nama; },
    getLastRow() {
      for (let i = this.data.length - 1; i >= 0; i--) {
        if ((this.data[i] || []).some(v => v !== '' && v !== null && v !== undefined)) return i + 1;
      }
      return 0;
    },
    getLastColumn() {
      let m = 0;
      this.data.forEach(r => { for (let j = (r || []).length - 1; j >= 0; j--) if (r[j] !== '' && r[j] !== null && r[j] !== undefined) { m = Math.max(m, j + 1); break; } });
      return m;
    },
    getMaxRows() { return Math.max(this.data.length, 1000); },
    getRange(a, b, c, d) {
      const self = this;
      if (typeof a === 'string') {
        const m = a.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
        const r1 = +m[2], c1 = kolomHuruf(m[1]), r2 = m[4] ? +m[4] : r1, c2 = m[3] ? kolomHuruf(m[3]) : c1;
        return self.getRange(r1, c1, r2 - r1 + 1, c2 - c1 + 1);
      }
      const row = a, col = b, nr = c || 1, nc = d || 1;
      if (row < 1 || col < 1 || nr < 1 || nc < 1) throw new Error('Rentang tidak sah: ' + [row, col, nr, nc]);
      const pastikan = (i) => { while (self.data.length < i) self.data.push([]); };
      const rg = {
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) { const r = self.data[row - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) { const v = r[col - 1 + j]; o.push(v === undefined || v === null ? '' : v); } out.push(o); }
          return out;
        },
        getValue() { return rg.getValues()[0][0]; },
        getDisplayValues() { return rg.getValues().map(r => r.map(v => String(v))); },
        setValues(vals) {
          if (vals.length !== nr || vals.some(r => r.length !== nc)) throw new Error('Ukuran setValues tidak cocok: ' + vals.length + 'x' + (vals[0] || []).length + ' vs ' + nr + 'x' + nc);
          vals.forEach((r, i) => { pastikan(row + i); const t = self.data[row - 1 + i]; r.forEach((v, j) => { t[col - 1 + j] = v; }); });
          return rg;
        },
        setValue(v) { pastikan(row); self.data[row - 1][col - 1] = v; return rg; },
        setNumberFormat(f) { for (let j = 0; j < nc; j++) self.format[col + j] = f; return rg; },
        setFontWeight() { return rg; }, setBackground() { return rg; }, setFontSize() { return rg; }
      };
      return rg;
    },
    getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); },
    deleteRow(r) { this.data.splice(r - 1, 1); },
    appendRow(r) { const n = this.getLastRow(); while (this.data.length < n) this.data.push([]); this.data.splice(n, 0, r.slice()); },
    clearContents() { this.data = []; },
    setFrozenRows() {}, hideSheet() { this.tersembunyi = true; },
    hideColumns(c) { this.kolomTersembunyi.push(c); }
  };
  return sh;
}

function buatSpreadsheet() {
  const sheets = [];
  const ss = {
    sheets,
    getId() { return 'SHEET-TES'; },
    getSheetByName(n) { return sheets.find(s => s.nama === n) || null; },
    insertSheet(n) { if (this.getSheetByName(n)) throw new Error('Tab sudah ada: ' + n); const s = buatSheet(n); sheets.push(s); return s; },
    getSheets() { return sheets.slice(); },
    deleteSheet(s) { sheets.splice(sheets.indexOf(s), 1); },
    setActiveSheet(s) { this.aktif = s; return s; },
    moveActiveSheet(i) { const k = sheets.indexOf(this.aktif); sheets.splice(k, 1); sheets.splice(Math.min(i - 1, sheets.length), 0, this.aktif); },
    toast() {}
  };
  ss.insertSheet('Sheet1');
  return ss;
}

function formatTanggal(d, f) {
  const w = new Date(d.getTime() + 7 * 3600e3).toISOString();    // WIB
  const Y = w.slice(0, 4), M = w.slice(5, 7), D = w.slice(8, 10), H = w.slice(11, 13), I = w.slice(14, 16);
  return f.replace('yyyy', Y).replace('MM', M).replace('dd', D).replace('HH', H).replace('mm', I);
}

function muatKode(opsi) {
  opsi = opsi || {};
  const ss = buatSpreadsheet();
  const cache = {}; const props = {}; const pemicu = [];
  const log = [];
  const ctx = {
    console,
    Logger: { log: (s) => log.push(s) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss, openById: () => ss, flush() {},
      getUi: () => { throw new Error('Tidak ada UI'); }
    },
    ContentService: { createTextOutput: s => ({ setMimeType: () => s }), MimeType: { JSON: 1 } },
    Utilities: {
      computeDigest: (alg, teks) => Array.from(crypto.createHash(alg === 'SHA_256' ? 'sha256' : 'md5').update(teks, 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
      base64Encode: b => Buffer.from(b.map(x => x & 255)).toString('base64'),
      DigestAlgorithm: { MD5: 'MD5', SHA_256: 'SHA_256' }, Charset: { UTF_8: 'utf8' },
      getUuid: () => crypto.randomUUID(),
      parseDate: (s, z, f) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('parseDate: ' + s); return new Date(s + 'T00:00:00+07:00'); },
      formatDate: (d, z, f) => formatTanggal(d, f)
    },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] === undefined ? null : cache[k], put: (k, v) => { cache[k] = v; } }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => props[k] === undefined ? null : props[k],
        setProperty: (k, v) => { if (String(v).length > 9 * 1024) throw new Error('Argument too large: ' + k); props[k] = String(v); },
        deleteProperty: k => { delete props[k]; },
        getKeys: () => Object.keys(props)
      })
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock() { return true; }, releaseLock() {} }) },
    ScriptApp: {
      getProjectTriggers: () => pemicu.map(p => ({ getHandlerFunction: () => p })),
      newTrigger: (f) => ({ timeBased: () => ({ everyHours: () => ({ create: () => { pemicu.push(f); } }) }) })
    }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + '/../apps-script/kode.gs', 'utf8'), ctx, { filename: 'kode.gs' });
  const panggil = (req) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(req) } }));
  return { ctx, ss, cache, props, pemicu, log, panggil };
}

module.exports = { muatKode, formatTanggal };
