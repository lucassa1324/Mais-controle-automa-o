/*
 * Teste do extrator do AppSheet.
 *
 * Monta o DOM de detalhe/lancamento do AppSheet:
 *
 *  - campos de cabecalho (field-header / field-value)
 *  - tabela de itens relacionados (ID_Material_Exibicao / Quantidade)
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { el, makeSandbox } from './mock-dom.mjs';

const BASE = 'C:/Users/Lucas sa/Documents/Programação/mais_controle';
const TMP = 'C:/Users/LUCASS~1/AppData/Local/Temp/kilo';

/* ================= entrada ================= */
const ENTRY = path.join(TMP, 'appsheet-entry.js');
fs.writeFileSync(ENTRY, `
import { isAppSheetPage } from '${BASE}/src/pages.js';
import { extractAppSheetItems, extractAppSheetMetadata, collectFieldValues, pickField, copyAppSheetInsumos, setupCopiarAppSheet } from '${BASE}/src/appsheet.js';
import { handlePanelPlay } from '${BASE}/src/panel.js';
import { appState } from '${BASE}/src/state.js';
import { getCodesFromStorage, getItemsFromStorage, getMetadataFromStorage, parseClipboardPayload, saveClipboardPayload } from '${BASE}/src/storage.js';
import { buildClipboardPayload, saveExtractedItems } from '${BASE}/src/copiar.js';
export { isAppSheetPage, extractAppSheetItems, extractAppSheetMetadata, collectFieldValues, pickField, copyAppSheetInsumos, setupCopiarAppSheet, handlePanelPlay, appState, getCodesFromStorage, getItemsFromStorage, getMetadataFromStorage, parseClipboardPayload, saveClipboardPayload, buildClipboardPayload, saveExtractedItems };
`, 'utf8');

const OUT = path.join(TMP, 'b-appsheet.js');
await esbuild.build({
    bundle: true, format: 'iife', globalName: '__EXPORTS',
    target: ['chrome100'], charset: 'utf8', legalComments: 'none', logLevel: 'error',
    entryPoints: [ENTRY], outfile: OUT
});

/* ================= DOM do AppSheet ================= */
function field(parent, label, value) {
    const wrap = el('fieldset', undefined, 'field-container');
    const header = el('div', label, 'field-header');
    const valueEl = el('div', value, 'field-value');
    wrap.appendChild(header);
    wrap.appendChild(valueEl);
    parent.appendChild(wrap);
    return wrap;
}

function buildAppSheet(options = {}) {

    const body = el('body');

    const page = el('div', undefined, 'app-sheet-container detail-page');
    page.appendChild(el('h1', 'Pedido de Materiais'));

    field(page, 'Observacoes', options.observacoes ?? 'Pedido #184');
    field(page, 'Destino', options.destino ?? 'Aparecida');
    field(page, 'Responsavel', options.responsavel ?? 'Cezario');
    field(page, 'Data', '22/10/2026');

    const related = el('div', undefined, 'related-list');
    related.appendChild(el('h3', 'Itens_Saidas'));

    const table = el('table');
    const thead = el('thead');
    const htr = el('tr');
    htr.appendChild(el('th', 'ID_Material_Exibicao'));
    htr.appendChild(el('th', 'Quantidade'));
    htr.appendChild(el('th', 'Unidade'));
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = el('tbody');
    const rows = options.rows ?? [
        ['MAT051 Parafuso sextavado', '4', 'PC'],
        ['MAT140 Arruela 8mm', '4', 'PC'],
        ['MAT376 Manilha media', '2,5', 'UN']
    ];
    for (const r of rows) {
        const tr = el('tr');
        r.forEach(c => tr.appendChild(el('td', c)));
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    related.appendChild(table);

    page.appendChild(related);
    body.appendChild(page);

    body.innerText = 'Pedido de Materiais Observacoes Pedido #184 Aparecida Cezario';

    return { body, table };
}

function load(options = {}) {
    const dom = buildAppSheet(options);
    const sb = makeSandbox(dom, { hostname: 'www.appsheet.com' });
    vm.runInContext(fs.readFileSync(OUT, 'utf8'), sb, { filename: 'b-appsheet.js' });
    return { T: sb.__EXPORTS, dom, sb };
}

/* ================= verificacoes ================= */
const checks = [];
const show = v => {
    if (v && typeof v === 'object') return v?.innerText ?? '[objeto]';
    return JSON.stringify(v);
};
function check(name, actual, expected) {
    const same = JSON.stringify(actual) === JSON.stringify(expected);
    checks.push({ name, same, actual, expected });
}

/* ---------- 1) DETECCAO DE PAGINA ---------- */
{
    const { T } = load();
    check('AppSheet: isAppSheetPage() = true', T.isAppSheetPage(), true);
}

{
    /* fora do appsheet.com nao e pagina do AppSheet */
    const dom = buildAppSheet();
    const sb = makeSandbox(dom, { hostname: 'acessar.maiscontroleerp.com.br' });
    vm.runInContext(fs.readFileSync(OUT, 'utf8'), sb, { filename: 'b-appsheet.js' });
    check('Fora do appsheet.com: isAppSheetPage() = false', sb.__EXPORTS.isAppSheetPage(), false);
}

/* ---------- 2) METADADOS ---------- */
{
    const { T } = load();
    const meta = T.extractAppSheetMetadata();

    check('Metadados: orderNumber = #184', meta.orderNumber, '#184');
    check('Metadados: description = Aparecida - Cezario', meta.description, 'Aparecida - Cezario');
}

{
    /* sem campo Responsavel -> descricao com apenas o destino */
    const { T } = load({ responsavel: '' });
    const meta = T.extractAppSheetMetadata();

    check('Metadados sem responsável: description = Aparecida', meta.description, 'Aparecida');
}

{
    /* numero do pedido apenas no corpo da tela */
    const { T } = load({ observacoes: 'Sem numero' });
    const meta = T.extractAppSheetMetadata();

    check('Metadados sem # nas observações: orderNumber vem do corpo', meta.orderNumber, '#184');
}

/* ---------- 3) ITENS ---------- */
{
    const { T } = load();
    const items = T.extractAppSheetItems();

    check('Itens: 3 materiais extraidos', Object.keys(items).length, 3);
    check('Itens: MAT051 com quantidade 4', items.MAT051, { code: 'MAT051', quantity: '4' });
    check('Itens: MAT140 com quantidade 4', items.MAT140, { code: 'MAT140', quantity: '4' });
    check('Itens: MAT376 com quantidade 2.5', items.MAT376, { code: 'MAT376', quantity: '2.5' });
}

{
    /* coluna de quantidade com nome diferente */
    const { T } = load({
        rows: [['MAT051 Parafuso', 'PC', '4']]
    });
    const items = T.extractAppSheetItems();

    check('Itens: quantidade por numero na linha', items.MAT051, { code: 'MAT051', quantity: '4' });
}

/* ---------- 4) CAMPOS ---------- */
{
    const { T } = load();
    const fields = T.collectFieldValues();

    check('Campos: Observacoes capturada', fields.get('observacoes'), 'Pedido #184');
    check('Campos: Destino capturada', fields.get('destino'), 'Aparecida');
    check('Campos: Responsavel capturado', fields.get('responsavel'), 'Cezario');
    check('Campos: pickField encontra destino', T.pickField(fields, ['destino']), 'Aparecida');
    check('Campos: pickField ignora sinonimo ausente', T.pickField(fields, ['inexistente']), '');
}

/* ---------- 5) BOTAO NO PAINEL + GRAVACAO NO localStorage ---------- */
{
    const { T, dom, sb } = load();

    T.setupCopiarAppSheet();

    const panel = dom.body.querySelector('#mc-automation-panel');
    const button = panel?.querySelector('.mc-copy-panel');

    check('Painel: criado no AppSheet', !!panel, true);
    check('Painel: botao de copia criado', button?.textContent.trim(), '📋 COPIAR INSUMOS DO APPSHEET');
    check('Painel: botao de copia visivel', button?.hidden, false);

    button.click();

    const raw = sb.localStorage.getItem('insumos_transferencia_copiados');

    check('localStorage: chave insumos_transferencia_copiados gravada', !!raw, true);

    check('localStorage: conteudo no formato esperado', JSON.parse(raw), {
        metadata: {
            orderNumber: '#184',
            description: 'Aparecida - Cezario'
        },
        items: {
            MAT051: { code: 'MAT051', quantity: '4' },
            MAT140: { code: 'MAT140', quantity: '4' },
            MAT376: { code: 'MAT376', quantity: '2.5' }
        }
    });

    check('Painel: resumo da copia = 3', T.appState.copySummary?.count, 3);
}

{
    /* no AppSheet o PLAY tambem dispara a copia */
    const { T, sb } = load();

    T.setupCopiarAppSheet();
    T.handlePanelPlay();

    const raw = sb.localStorage.getItem('insumos_transferencia_copiados');

    check('Painel: PLAY no AppSheet dispara a copia', !!raw, true);
}

{
    /* mesmo sem tabela pronta, o painel e o botao aparecem no host AppSheet */
    const dom = { body: el('body') };
    const sb = makeSandbox(dom, { hostname: 'www.appsheet.com' });
    vm.runInContext(fs.readFileSync(OUT, 'utf8'), sb, { filename: 'b-appsheet.js' });

    sb.__EXPORTS.setupCopiarAppSheet();

    const panel = dom.body.querySelector('#mc-automation-panel');
    const button = panel?.querySelector('.mc-copy-panel');

    check('AppSheet sem tabela: painel criado', !!panel, true);
    check('AppSheet sem tabela: botao de copia visivel', button?.hidden, false);
    check('AppSheet sem tabela: sem botao solto', dom.body.querySelector('.mc-copy-button'), null);
}

{
    /* fora do AppSheet o painel/botao nao aparecem */
    const dom = buildAppSheet();
    const sb = makeSandbox(dom, { hostname: 'acessar.maiscontroleerp.com.br' });
    vm.runInContext(fs.readFileSync(OUT, 'utf8'), sb, { filename: 'b-appsheet.js' });

    sb.__EXPORTS.setupCopiarAppSheet();

    check('Fora do AppSheet: nenhum painel', dom.body.querySelector('#mc-automation-panel'), null);
    check('Fora do AppSheet: nenhum botao de copia', dom.body.querySelector('.mc-copy-panel'), null);
}

/* ---------- 6) LISTA INLINE (GRID role="row", SEM <table>) ---------- */
{
    const body = el('body');
    const page = el('div', undefined, 'app-sheet-container detail-page');

    field(page, 'Observacoes', 'Pedido #184');
    field(page, 'Destino', 'Aparecida');
    field(page, 'Responsavel', 'Cezario');

    const grid = el('div', undefined, 'inline-grid');

    const head = el('div', undefined, 'grid-row');
    head.setAttribute('role', 'row');
    ['ID_Material_Exibicao', 'Quantidade'].forEach(t => {
        const c = el('div', t, 'grid-cell');
        c.setAttribute('role', 'columnheader');
        head.appendChild(c);
    });
    grid.appendChild(head);

    [['MAT051 Parafuso', '6'], ['MAT140 Arruela', '3']].forEach(r => {
        const row = el('div', undefined, 'grid-row');
        row.setAttribute('role', 'row');
        r.forEach(t => {
            const c = el('div', t, 'grid-cell');
            c.setAttribute('role', 'gridcell');
            row.appendChild(c);
        });
        grid.appendChild(row);
    });

    page.appendChild(grid);
    body.appendChild(page);

    const sb = makeSandbox({ body }, { hostname: 'www.appsheet.com' });
    vm.runInContext(fs.readFileSync(OUT, 'utf8'), sb, { filename: 'b-appsheet.js' });

    const items = sb.__EXPORTS.extractAppSheetItems();

    check('Grid inline: 2 materiais extraidos', Object.keys(items).length, 2);
    check('Grid inline: MAT051 com quantidade 6', items.MAT051, { code: 'MAT051', quantity: '6' });
    check('Grid inline: MAT140 com quantidade 3', items.MAT140, { code: 'MAT140', quantity: '3' });
}

/* ---------- 7) LISTA EM DIVS COM CLASSES GENERICAS (SEM <table>/role) ---------- */
{
    const body = el('body');
    const page = el('div', undefined, 'app-sheet-container');

    field(page, 'Observacoes', 'Pedido #184');
    field(page, 'Destino', 'Aparecida');

    const listing = el('div', undefined, 'listing');
    listing.appendChild(el('div', 'ID_Material_Exibicao | Quantidade | Unidade'));

    [['MAT051 Parafuso sextavado', '4', 'PC'],
     ['MAT140 Arruela 8mm', '4', 'PC']].forEach(r => {
        const row = el('div', undefined, 'data-row');
        r.forEach(t => row.appendChild(el('div', t, 'cell')));
        listing.appendChild(row);
    });

    page.appendChild(listing);
    body.appendChild(page);

    const sb = makeSandbox({ body }, { hostname: 'www.appsheet.com' });
    vm.runInContext(fs.readFileSync(OUT, 'utf8'), sb, { filename: 'b-appsheet.js' });

    const items = sb.__EXPORTS.extractAppSheetItems();

    check('Divs genericas: 2 materiais extraidos', Object.keys(items).length, 2);
    check('Divs genericas: MAT051 com quantidade 4', items.MAT051, { code: 'MAT051', quantity: '4' });
    check('Divs genericas: MAT140 com quantidade 4', items.MAT140, { code: 'MAT140', quantity: '4' });
}

/* ---------- 8) FALLBACK PELO TEXTO VISIVEL (SEM ESTRUTURA DE LINHA) ---------- */
{
    const body = el('body');
    body.innerText =
        'Pedido #184\n' +
        'MAT051 Parafuso sextavado 4 PC\n' +
        'MAT140 Arruela 8mm 4 PC\n' +
        'MAT376 Manilha media 2,5 UN';

    const sb = makeSandbox({ body }, { hostname: 'www.appsheet.com' });
    vm.runInContext(fs.readFileSync(OUT, 'utf8'), sb, { filename: 'b-appsheet.js' });

    const items = sb.__EXPORTS.extractAppSheetItems();

    check('Fallback texto: 3 materiais extraidos', Object.keys(items).length, 3);
    check('Fallback texto: MAT051 com quantidade 4', items.MAT051, { code: 'MAT051', quantity: '4' });
    check('Fallback texto: MAT140 com quantidade 4', items.MAT140, { code: 'MAT140', quantity: '4' });
    check('Fallback texto: MAT376 com quantidade 2.5', items.MAT376, { code: 'MAT376', quantity: '2.5' });
}

/* ---------- 9) FALLBACK COM CELULAS EM LINHAS SEPARADAS ---------- */
{
    const body = el('body');
    body.innerText =
        'MAT051\nParafuso sextavado\n4\nPC\n' +
        'MAT140\nArruela 8mm\n3\nPC';

    const sb = makeSandbox({ body }, { hostname: 'www.appsheet.com' });
    vm.runInContext(fs.readFileSync(OUT, 'utf8'), sb, { filename: 'b-appsheet.js' });

    const items = sb.__EXPORTS.extractAppSheetItems();

    check('Fallback multilinha: 2 materiais extraidos', Object.keys(items).length, 2);
    check('Fallback multilinha: MAT051 com quantidade 4', items.MAT051, { code: 'MAT051', quantity: '4' });
    check('Fallback multilinha: MAT140 com quantidade 3', items.MAT140, { code: 'MAT140', quantity: '3' });
}

/* ---------- 10) STORAGE COMPARTILHADO ENTRE ORIGENS (GM_*) ---------- */
{
    const shared = new Map();

    const gm = {
        GM_setValue: (key, value) => shared.set(key, String(value)),
        GM_getValue: (key, fallback = null) => shared.has(key) ? shared.get(key) : fallback
    };

    const { body } = buildAppSheet();

    const appsheet = makeSandbox({ body }, { hostname: 'www.appsheet.com' });
    Object.assign(appsheet, gm);
    vm.runInContext(fs.readFileSync(OUT, 'utf8'), appsheet, { filename: 'b-appsheet.js' });

    appsheet.__EXPORTS.setupCopiarAppSheet();

    body.querySelector('.mc-copy-panel').click();

    check('GM: dados gravados na memoria compartilhada', shared.has('insumos_transferencia_copiados'), true);
    check('GM: localStorage tambem recebe backup na aba AppSheet', !!appsheet.localStorage.getItem('insumos_transferencia_copiados'), true);

    const erp = makeSandbox({ body: el('body') }, { hostname: 'acessar.maiscontroleerp.com.br' });
    Object.assign(erp, gm);
    vm.runInContext(fs.readFileSync(OUT, 'utf8'), erp, { filename: 'b-appsheet.js' });

    const codes = erp.__EXPORTS.getCodesFromStorage().sort();

    check('GM: outra origem le os insumos copiados', codes, ['MAT051', 'MAT140', 'MAT376']);
}

/* ---------- 11) COPIA PARA A AREA DE TRANSFERENCIA ---------- */
{
    const dom = buildAppSheet();
    const sb = makeSandbox(dom, { hostname: 'www.appsheet.com' });

    let clipboardText = '';

    sb.navigator = {
        clipboard: {
            writeText: async text => { clipboardText = text; }
        }
    };

    vm.runInContext(fs.readFileSync(OUT, 'utf8'), sb, { filename: 'b-appsheet.js' });

    sb.__EXPORTS.setupCopiarAppSheet();
    dom.body.querySelector('.mc-copy-panel').click();

    await new Promise(resolve => setTimeout(resolve, 0));

    const payload = JSON.parse(clipboardText || 'null');

    check('Clipboard: payload escrito', !!payload, true);
    check('Clipboard: source = APPSHEET_MAIS_CONTROLE', payload?.source, 'APPSHEET_MAIS_CONTROLE');
    check('Clipboard: timestamp numerico', typeof payload?.timestamp, 'number');
    check('Clipboard: metadados', payload?.metadata, { orderNumber: '#184', description: 'Aparecida - Cezario' });
    check('Clipboard: MAT051 com quantidade 4', payload?.items?.MAT051, { code: 'MAT051', quantity: '4' });
    check('Clipboard: MAT376 com quantidade 2.5', payload?.items?.MAT376, { code: 'MAT376', quantity: '2.5' });

    const sorted = sb.__EXPORTS.buildClipboardPayload({
        MAT999: { code: 'MAT999', quantity: '1' },
        MAT001: { code: 'MAT001', quantity: '2' },
        MAT100: { code: 'MAT100', quantity: '3' }
    }, {});

    check('Clipboard: itens ordenados por codigo', Object.keys(sorted.items), ['MAT001', 'MAT100', 'MAT999']);
}

/* ---------- 12) INTERPRETADOR DO CLIPBOARD ---------- */
{
    const body = el('body');
    const sb = makeSandbox({ body }, { hostname: 'acessar.maiscontroleerp.com.br' });
    vm.runInContext(fs.readFileSync(OUT, 'utf8'), sb, { filename: 'b-appsheet.js' });

    const text = JSON.stringify({
        source: 'APPSHEET_MAIS_CONTROLE',
        timestamp: 1729618000000,
        metadata: { orderNumber: '#900', description: 'Obra X - Fulano' },
        items: {
            MAT507: { code: 'MAT507', quantity: '8' },
            MAT364: { code: 'MAT364', quantity: '34' }
        }
    });

    const parsed = sb.__EXPORTS.parseClipboardPayload(text);

    check('Clipboard parse: aceita JSON valido', !!parsed, true);
    check('Clipboard parse: metadados normalizados', parsed?.metadata, { orderNumber: '#900', description: 'Obra X - Fulano' });

    const count = sb.__EXPORTS.saveClipboardPayload(parsed);
    const items = sb.__EXPORTS.getItemsFromStorage();

    check('Clipboard parse: 2 insumos salvos', count, 2);
    check('Clipboard parse: MAT364 com quantidade 34', items.MAT364, { code: 'MAT364', quantity: '34' });
    check('Clipboard parse: MAT507 com quantidade 8', items.MAT507, { code: 'MAT507', quantity: '8' });
    check('Clipboard parse: itens ordenados por codigo', Object.keys(items), ['MAT364', 'MAT507']);

    check('Clipboard parse: rejeita JSON sem source', sb.__EXPORTS.parseClipboardPayload(JSON.stringify({ items: {} })), null);
    check('Clipboard parse: rejeita JSON invalido', sb.__EXPORTS.parseClipboardPayload('{nao e json'), null);
    check('Clipboard parse: rejeita outra origem', sb.__EXPORTS.parseClipboardPayload(JSON.stringify({ source: 'OUTRO', items: {} })), null);
}

/* ---------- 13) SUBSTITUICAO TOTAL NO STORAGE ---------- */
{
    const body = el('body');
    const sb = makeSandbox({ body }, { hostname: 'acessar.maiscontroleerp.com.br' });
    vm.runInContext(fs.readFileSync(OUT, 'utf8'), sb, { filename: 'b-appsheet.js' });

    sb.__EXPORTS.saveClipboardPayload({
        source: 'APPSHEET_MAIS_CONTROLE',
        timestamp: 1,
        metadata: { orderNumber: '#111', description: 'Pedido antigo' },
        items: {
            MAT100: { code: 'MAT100', quantity: '1' },
            MAT200: { code: 'MAT200', quantity: '2' },
            MAT300: { code: 'MAT300', quantity: '3' }
        }
    });

    const count = sb.__EXPORTS.saveExtractedItems({
        MAT400: { code: 'MAT400', quantity: '4' },
        MAT500: { code: 'MAT500', quantity: '5' }
    }, { orderNumber: '#222', description: 'Pedido novo' });

    let items = sb.__EXPORTS.getItemsFromStorage();

    check('Storage: nova copia substitui itens antigos', count, 2);
    check('Storage: apenas itens do pedido novo', Object.keys(items), ['MAT400', 'MAT500']);
    check('Storage: metadados do pedido novo', sb.__EXPORTS.getMetadataFromStorage(), { orderNumber: '#222', description: 'Pedido novo' });
    check('Storage: codigos do pedido novo', sb.__EXPORTS.getCodesFromStorage(), ['MAT400', 'MAT500']);

    sb.__EXPORTS.saveClipboardPayload({
        source: 'APPSHEET_MAIS_CONTROLE',
        timestamp: 2,
        metadata: { orderNumber: '#333', description: 'Pedido mais novo' },
        items: {
            MAT999: { code: 'MAT999', quantity: '9' }
        }
    });

    items = sb.__EXPORTS.getItemsFromStorage();

    check('Storage: novo clipboard substitui pedido anterior', Object.keys(items), ['MAT999']);
    check('Storage: codigos apos novo clipboard', sb.__EXPORTS.getCodesFromStorage(), ['MAT999']);
}

/* ---------- 14) ESCOPO DA TELA ATUAL (IGNORA OFFSCREEN/OCULTOS) ---------- */
{
    const { body, table } = buildAppSheet({
        rows: [
            ['MAT051 Parafuso', '4', 'PC'],
            ['MAT140 Arruela', '3', 'PC']
        ]
    });

    const tbody = table.querySelector('tbody');

    ['MAT800 Antigo 1', 'MAT801 Antigo 2', 'MAT802 Antigo 3'].forEach(text => {
        const tr = el('tr');
        tr.appendChild(el('td', text));
        tr.appendChild(el('td', '1'));
        tr.getBoundingClientRect = () => ({
            left: 0,
            top: 1200,
            width: 100,
            height: 20,
            right: 100,
            bottom: 1220
        });
        tbody.appendChild(tr);
    });

    body.innerText =
        'MAT051 Parafuso 4 PC\nMAT140 Arruela 3 PC\n' +
        'MAT800 Antigo 1 1 MAT801 Antigo 2 1 MAT802 Antigo 3 1';

    const sb = makeSandbox({ body }, { hostname: 'www.appsheet.com' });
    vm.runInContext(fs.readFileSync(OUT, 'utf8'), sb, { filename: 'b-appsheet.js' });

    const items = sb.__EXPORTS.extractAppSheetItems();

    check('Escopo: ignora linhas fora do viewport', Object.keys(items), ['MAT051', 'MAT140']);
}

{
    const { body, table } = buildAppSheet({
        rows: [
            ['MAT051 Parafuso', '4', 'PC'],
            ['MAT140 Arruela', '3', 'PC']
        ]
    });

    const cached = el('div', undefined, 'cached-list');
    cached.style.display = 'none';

    const cachedTable = el('table');
    const cachedBody = el('tbody');

    ['MAT900 Cache 1', 'MAT901 Cache 2', 'MAT902 Cache 3'].forEach(text => {
        const tr = el('tr');
        tr.appendChild(el('td', text));
        tr.appendChild(el('td', '2'));
        cachedBody.appendChild(tr);
    });

    cachedTable.appendChild(cachedBody);
    cached.appendChild(cachedTable);
    body.appendChild(cached);

    table.parentElement.appendChild(cached);

    body.innerText =
        'MAT051 Parafuso 4 PC\nMAT140 Arruela 3 PC\n' +
        'MAT900 Cache 1 2 MAT901 Cache 2 2 MAT902 Cache 3 2';

    const sb = makeSandbox({ body }, { hostname: 'www.appsheet.com' });
    vm.runInContext(fs.readFileSync(OUT, 'utf8'), sb, { filename: 'b-appsheet.js' });

    const items = sb.__EXPORTS.extractAppSheetItems();

    check('Escopo: ignora tabela cache oculta', Object.keys(items), ['MAT051', 'MAT140']);
}

/* ================= resultado ================= */
let fail = 0;
for (const c of checks) {
    if (!c.same) fail++;
    console.log(`${c.same ? 'OK   ' : 'FALHA'} ${c.name}`);
    if (!c.same) {
        console.log('   esperado:', show(c.expected));
        console.log('   obtido  :', show(c.actual));
    }
}
console.log(`\n${checks.length - fail}/${checks.length} verificacoes do AppSheet OK`);
process.exit(fail ? 1 : 0);
