/*
 * Teste de runtime: compara o comportamento do ORIGINAL vs dos MODULOS.
 *
 * Ambas as versoes sao bundlearadas pelo mesmo esbuild, com as
 * funções expostas via globalName, para comparacao direta.
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const BASE = 'C:/Users/Lucas sa/Documents/Programação/mais_controle';
const TMP = 'C:/Users/LUCASS~1/AppData/Local/Temp/kilo';

const EXPORTADAS = [
    'extractPedidoItems', 'getRelevantTables', 'ensureIndexColumn', 'reindexTable',
    'sortTable', 'getNameForRow', 'getHeaderIndex', 'parseQuantity', 'extractMatCode',
    'normalizeMatCode', 'getSearchNumber', 'cleanText', 'getBodyRows', 'getIndexCell',
    'hasIndexHeader', 'findTransferRow', 'getCodesFromStorage', 'getItemsFromStorage',
    'getProgress', 'isPedidoPage', 'isTransferenciaPage', 'isAdicionarInsumoPage',
    'getRelevantTables', 'setupSortingAndIndexes', 'addSortButton'
];

/* ================= entrada do ORIGINAL ================= */
const origSrc = fs.readFileSync(BASE + '/original.txt', 'utf8');
const origBody = origSrc.slice(origSrc.indexOf('(function ()'));
/* remove o wrapper IIFE e converte em modulo ES */
let origMod = origBody
    .replace(/^\(function \(\) \{/, '')
    .replace(/\}\)\(\);\s*$/, '')
    .replace(/^\s*'use strict';\s*$/m, '');
origMod += `\n\nexport { ${[...new Set(EXPORTADAS)].join(', ')} };\n`;
fs.writeFileSync(path.join(TMP, 'orig-mod.js'), origMod, 'utf8');

/* ================= entrada dos MODULOS ================= */
const modExports = {
    'pedido.js': ['getHeaderIndex', 'extractPedidoItems', 'setupCopiarPedido'],
    'tables.js': ['getRelevantTables', 'hasIndexHeader', 'ensureIndexColumn', 'getBodyRows',
        'getIndexCell', 'reindexTable', 'getNameForRow', 'sortTable', 'addSortButton', 'setupSortingAndIndexes'],
    'utils.js': ['cleanText', 'extractMatCode', 'normalizeMatCode', 'getSearchNumber', 'parseQuantity'],
    'preencher.js': ['findTransferRow'],
    'storage.js': ['getCodesFromStorage', 'getItemsFromStorage', 'getProgress'],
    'pages.js': ['isPedidoPage', 'isTransferenciaPage', 'isAdicionarInsumoPage']
};
let novoMod = '';
for (const [file, names] of Object.entries(modExports)) {
    novoMod += `import { ${names.join(', ')} } from '${BASE}/src/${file}';\n`;
}
novoMod += `\nexport { ${[...new Set(EXPORTADAS)].join(', ')} };\n`;
fs.writeFileSync(path.join(TMP, 'novo-mod.js'), novoMod, 'utf8');

const opts = {
    bundle: true, format: 'iife', globalName: '__EXPORTS',
    target: ['chrome100'], charset: 'utf8', legalComments: 'none', logLevel: 'error'
};
await esbuild.build({ ...opts, entryPoints: [path.join(TMP, 'orig-mod.js')], outfile: path.join(TMP, 'b-orig.js') });
await esbuild.build({ ...opts, entryPoints: [path.join(TMP, 'novo-mod.js')], outfile: path.join(TMP, 'b-novo.js') });

/* ================= DOM mock ================= */
class El {
    constructor(tag) {
        this.tagName = (tag || 'div').toUpperCase();
        this.childNodes = [];
        this.style = {};
        this.dataset = {};
        this._classList = new Set();
        this.classList = {
            add: (...c) => c.forEach(x => this._classList.add(x)),
            remove: (...c) => c.forEach(x => this._classList.delete(x)),
            contains: c => this._classList.has(c),
            toggle: (c, on) => on ? this._classList.add(c) : this._classList.delete(c)
        };
        this.textContent = '';
        this.innerText = '';
        this.value = '';
        this.checked = false;
        this.type = '';
        this.id = '';
        this.className = '';
        this.parentElement = null;
    }
    get children() { return this.childNodes.filter(c => c instanceof El); }
    get firstElementChild() { return this.children[0] || null; }
    appendChild(c) { c.parentElement = this; this.childNodes.push(c); return c; }
    insertBefore(n, r) {
        const i = this.childNodes.indexOf(r);
        n.parentElement = this;
        this.childNodes.splice(i < 0 ? 0 : i, 0, n);
        return n;
    }
    removeChild(c) { this.childNodes = this.childNodes.filter(x => x !== c); return c; }
    remove() { this.parentElement?.removeChild(this); }
    set innerHTML(v) { this._html = v; this.childNodes = []; }
    get innerHTML() { return this._html || ''; }
    get innerText() {
        if (this._text !== undefined) return this._text;
        return this.children.map(c => c.innerText).filter(Boolean).join('\n');
    }
    set innerText(v) { this._text = v; }
    descendants() {
        const out = [];
        const walk = el => el.children.forEach(c => { out.push(c); walk(c); });
        walk(this);
        return out;
    }
    matchesSimple(sel) {
        let m;
        const tag = sel.match(/^([a-zA-Z][\w-]*)/);
        if (tag && this.tagName !== tag[1].toUpperCase()) return false;
        for (const c of sel.match(/\.([\w-]+)/g) || []) if (!this._classList.has(c.slice(1))) return false;
        const idm = sel.match(/#([\w-]+)/);
        if (idm && this.id !== idm[1]) return false;
        const attr = sel.match(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/);
        if (attr) {
            const v = this[attr[1]];
            if (attr[2] !== undefined && String(v) !== attr[2]) return false;
            if (attr[2] === undefined && v === undefined) return false;
        }
        return true;
    }
    querySelectorAll(sel) {
        const parts = sel.split(',').map(s => s.trim()).filter(Boolean);
        return this.descendants().filter(d => parts.some(p => d.matchesSimple(p)));
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() { return true; }
    getBoundingClientRect() { return { left: 10, top: 20, width: 300, height: 200 }; }
    get offsetWidth() { return 300; }
    get offsetHeight() { return 200; }
    focus() {}
    select() {}
    click() { this.checked = !this.checked; }
    setPointerCapture() {}
    closest() { return null; }
}

const el = (tag, text, cls) => {
    const e = new El(tag);
    if (text !== undefined) e.innerText = text;
    if (cls) cls.split(' ').forEach(c => e.classList.add(c));
    return e;
};

function buildTable(headers, rows) {
    const table = el('table');
    const thead = el('thead');
    const htr = el('tr');
    headers.forEach(h => htr.appendChild(el('th', h)));
    thead.appendChild(htr);
    table.appendChild(thead);
    const tbody = el('tbody');
    rows.forEach(r => {
        const tr = el('tr');
        r.forEach(c => tr.appendChild(el('td', c)));
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
}

function buildDom() {
    const body = el('body');
    const table = buildTable(
        ['Item', 'Qtde Solicitada', 'Unid'],
        [
            ['MAT376 Manilha Media', '12', 'UN'],
            ['MAT010 Parafuso 10mm', '3,5', 'PC'],
            ['MAT301 Arruela', '7', 'PC'],
            ['MAT051 Porca sextavada', '2', 'PC']
        ]
    );
    body.appendChild(table);
    body.innerText = 'solicitação qtde solicitada itens MAT010';
    return { body, table };
}

function makeSandbox(dom) {
    const store = new Map();
    const sb = {
        document: {
            body: dom.body, head: el('head'), documentElement: el('html'), readyState: 'complete',
            createElement: t => el(t),
            getElementById: () => null,
            querySelector: s => dom.body.querySelector(s),
            querySelectorAll: s => dom.body.querySelectorAll(s),
            addEventListener: () => {}, removeEventListener: () => {}, execCommand: () => true
        },
        window: { innerWidth: 1440, innerHeight: 900 },
        localStorage: {
            getItem: k => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: k => store.delete(k)
        },
        MutationObserver: class { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} },
        KeyboardEvent: class { constructor() {} },
        Event: class { constructor(t, o) { this.type = t; Object.assign(this, o); } },
        HTMLInputElement: class {},
        setTimeout: () => 0, clearTimeout: () => {},
        console: { log: () => {}, error: () => {}, warn: () => {} },
        alert: () => {},
        Math, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Error, Promise, Set, Map,
        isNaN, parseInt, parseFloat, Infinity, undefined
    };
    sb.globalThis = sb; sb.self = sb; sb.__store = store;
    vm.createContext(sb);
    return sb;
}

function run(file) {
    const dom = buildDom();
    const sb = makeSandbox(dom);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sb, { filename: path.basename(file) });
    return { T: sb.__EXPORTS, dom, sb };
}

const R1 = run(path.join(TMP, 'b-orig.js'));
const R2 = run(path.join(TMP, 'b-novo.js'));

const checks = [];
function cmp(name, fn) {
    let a, b;
    try { a = fn(R1.T, R1.dom); } catch (e) { a = 'ERR:' + e.message; }
    try { b = fn(R2.T, R2.dom); } catch (e) { b = 'ERR:' + e.message; }
    checks.push({ name, same: JSON.stringify(a) === JSON.stringify(b), a, b });
}

const tableState = d => d.table.querySelectorAll('tbody tr')
    .map(tr => Array.from(tr.children).map(c => c.innerText + (c.classList.contains('mc-index-cell') ? '#idx' : '')));

cmp('extractPedidoItems', T => T.extractPedidoItems());
cmp('getRelevantTables (count)', (T, d) => T.getRelevantTables().length);
cmp('getHeaderIndex', (T, d) => T.getHeaderIndex(d.table));
cmp('getNameForRow (1a linha)', (T, d) => T.getNameForRow(d.table.querySelectorAll('tbody tr')[0]));
cmp('getNameForRow (todas)', (T, d) => d.table.querySelectorAll('tbody tr').map(r => T.getNameForRow(r)));
cmp('getBodyRows (count)', (T, d) => T.getBodyRows(d.table).length);
cmp('getIndexCell', (T, d) => !!T.getIndexCell(d.table.querySelectorAll('tbody tr')[0]));
cmp('hasIndexHeader', (T, d) => T.hasIndexHeader(d.table));
cmp('parseQuantity', T => ['10', '2,5', '-1.5', 'abc'].map(T.parseQuantity));
cmp('extractMatCode', T => ['MAT010', 'mat 051', 'x MAT-206 y'].map(T.extractMatCode));
cmp('normalizeMatCode', T => ['MAT010', 'mat-051', 'zzz'].map(T.normalizeMatCode));
cmp('getSearchNumber', T => ['MAT010', 'mat-051', 'ABC'].map(T.getSearchNumber));
cmp('cleanText', T => ['  a  b  ', '', null].map(T.cleanText));
cmp('findTransferRow', (T, d) => !!T.findTransferRow('MAT010'));
cmp('findTransferRow (inexistente)', (T, d) => T.findTransferRow('MAT999'));
cmp('isPedidoPage', (T, d) => T.isPedidoPage());
cmp('isTransferenciaPage', (T, d) => T.isTransferenciaPage());
cmp('isAdicionarInsumoPage', (T, d) => T.isAdicionarInsumoPage());
cmp('ensureIndexColumn', (T, d) => { T.ensureIndexColumn(d.table); return tableState(d); });
cmp('ensureIndexColumn idempotente', (T, d) => { T.ensureIndexColumn(d.table); T.ensureIndexColumn(d.table); return tableState(d); });
cmp('reindexTable', (T, d) => { T.reindexTable(d.table); return tableState(d); });
cmp('sortTable A-Z', (T, d) => { T.sortTable(d.table, true); return tableState(d); });
cmp('sortTable Z-A', (T, d) => { T.sortTable(d.table, false); return tableState(d); });
cmp('getCodesFromStorage (vazio)', T => T.getCodesFromStorage());
cmp('getItemsFromStorage (vazio)', T => T.getItemsFromStorage());
cmp('getProgress (sem dados)', T => T.getProgress(10));

/* com storage populado */
cmp('getCodesFromStorage (preenchido)', (T, d, sb) => {
    sb.__store.set('insumos_transferencia_copiados', JSON.stringify({
        MAT010: { code: 'MAT010', quantity: '2' }, MAT051: { code: 'MAT051', quantity: '3' }
    }));
    return T.getCodesFromStorage();
});

let fail = 0;
for (const c of checks) {
    if (!c.same) fail++;
    console.log(`${c.same ? 'OK   ' : 'FALHA'} ${c.name}`);
    if (!c.same) {
        console.log('   orig:', JSON.stringify(c.a).slice(0, 400));
        console.log('   novo:', JSON.stringify(c.b).slice(0, 400));
    }
}
console.log(`\n${checks.length - fail}/${checks.length} verificacoes de runtime OK`);
process.exit(fail ? 1 : 0);
