/*
 * Teste de lote completo: Transferencia -> modal -> ADICIONAR ->
 * reabrir a modal e comecar o 2o lote automaticamente.
 *
 * Reproduz o ERP real:
 *  - modal MUI com titulo "Adicionar Insumo" e label "Busca";
 *  - confirmacao "Adicionar" (sem contagem);
 *  - apos confirmar, a modal antiga fica montada e escondida
 *    dentro de um wrapper com classe "modal-open";
 *  - a tela de Transferencia tem seu proprio #keyword
 *    ("Buscar insumo"), que NUNCA pode ser usado.
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { el, makeSandbox } from './mock-dom.mjs';

const BASE = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
    .replace(/\\/g, '/');
const TMP = path.join(os.tmpdir(), 'mais-controle-batch');

fs.mkdirSync(TMP, { recursive: true });

/* ================= entrada ================= */
const ENTRY = path.join(TMP, 'batch-entry.js');
fs.writeFileSync(ENTRY, `
import { playAutomation } from ${JSON.stringify(`${BASE}/src/automation.js`)};
import { appState } from ${JSON.stringify(`${BASE}/src/state.js`)};
import { getCodesFromStorage } from ${JSON.stringify(`${BASE}/src/storage.js`)};
export { playAutomation, appState, getCodesFromStorage };
`, 'utf8');

const OUT = path.join(TMP, 'b-batch.js');
await esbuild.build({
    bundle: true, format: 'iife', globalName: '__EXPORTS',
    target: ['chrome100'], charset: 'utf8', legalComments: 'none', logLevel: 'error',
    entryPoints: [ENTRY], outfile: OUT
});

/* ================= DOM do ERP ================= */
const CODES = [];
for (let i = 1; i <= 11; i++)
    CODES.push('MAT' + String(i).padStart(3, '0'));

const body = el('body');

const page = el('div', undefined, 'page Transferencia');
page.appendChild(el('h1', 'Transferencia'));

/* wrapper com modal-open, como no ERP depois de fechar a modal */
const card = el('div', undefined, 'card modal-open');

let pageSearchFocused = 0;

const pageSearch = el('input');
pageSearch.id = 'keyword';
pageSearch.setAttribute('name', 'keyword');
pageSearch.setAttribute('placeholder', 'Buscar insumo');
pageSearch.focus = () => { pageSearchFocused++; };
card.appendChild(pageSearch);

const pageBtn = el('button', 'Adicionar Insumo', 'btn btn-success');
card.appendChild(pageBtn);

page.appendChild(card);
body.appendChild(page);
body.innerText = 'Transferencia qtde a transferir Adicionar Insumo';

let modalOpens = 0;
let commits = 0;
let modalFocused = 0;

function buildModal() {

    modalOpens++;

    const overlay = el('div', undefined, 'MuiModal-root MuiDialog-root');
    overlay.style.display = 'block';

    const dialog = el('div', undefined, 'MuiPaper-root MuiDialog-paper');
    dialog.setAttribute('role', 'dialog');

    const header = el('div');
    const title = el('h2', undefined, 'MuiDialogTitle-root');
    title.id = 'supplies-dialog';
    title.appendChild(el('span', 'Adicionar Insumo'));
    header.appendChild(title);
    dialog.appendChild(header);

    const content = el('div', undefined, 'MuiDialogContent-root');

    const control = el('div', undefined, 'MuiFormControl-root');
    const label = el('label', 'Busca', 'MuiFormLabel-root');
    label.setAttribute('for', 'keyword');
    control.appendChild(label);

    const inputWrap = el('div', undefined, 'MuiInputBase-root');
    const search = el('input');
    search.id = 'keyword';
    search.setAttribute('name', 'keyword');
    search.className = 'MuiInputBase-input MuiOutlinedInput-input';
    search.focus = () => { modalFocused++; };
    inputWrap.appendChild(search);
    control.appendChild(inputWrap);
    content.appendChild(control);

    const table = el('table');
    const tbody = el('tbody');

    for (const code of CODES) {

        const tr = el('tr');
        const tdCheck = el('td');
        const checkbox = el('input');
        checkbox.type = 'checkbox';
        checkbox.setAttribute('type', 'checkbox');
        checkbox.onClick = () => { checkbox.checked = !checkbox.checked; };
        tdCheck.appendChild(checkbox);
        tr.appendChild(tdCheck);
        tr.appendChild(el('td', `${code} item`));
        tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    content.appendChild(table);
    dialog.appendChild(content);

    const footer = el('div');
    const confirm = el('button', 'Adicionar', 'MuiButton-root');
    confirm.onClick = () => {

        commits++;

        /*
         * MUI mantem a modal antiga montada, apenas escondida.
         * A proxima modal e anexada depois dela no mesmo wrapper.
         */
        overlay.style.display = 'none';
    };
    footer.appendChild(confirm);
    dialog.appendChild(footer);

    overlay.appendChild(dialog);
    card.appendChild(overlay);

    return { overlay, dialog, search, confirm };
}

pageBtn.onClick = buildModal;

/* ================= execucao ================= */
const dom = { body, btn: pageBtn, search: pageSearch, card };
const sb = makeSandbox(dom);

const items = {};
for (const code of CODES)
    items[code] = 1;

sb.localStorage.setItem('insumos_transferencia_copiados', JSON.stringify(items));

/* timers instantaneos para o teste nao esperar os sleeps reais */
sb.setTimeout = fn => { fn(); return 0; };
sb.clearTimeout = () => {};

vm.runInContext(fs.readFileSync(OUT, 'utf8'), sb, { filename: 'b-batch.js' });

const T = sb.__EXPORTS;
T.appState.extensionEnabled = true;

await T.playAutomation();

/* ================= verificacoes ================= */
const checks = [];

function check(name, actual, expected) {
    checks.push({
        name,
        same: JSON.stringify(actual) === JSON.stringify(expected),
        actual,
        expected
    });
}

check('Lotes: codigos carregados', T.getCodesFromStorage().length, CODES.length);
check('Lotes: modal reaberta para o 2o lote', modalOpens, 2);
check('Lotes: dois ADICIONAR confirmados', commits, 2);
check('Lotes: automacao concluida', T.appState.automationState, 'completed');
check('Lotes: buscou na modal', modalFocused > 0, true);
check('Lotes: NUNCA buscou no #keyword da pagina', pageSearchFocused, 0);

let fail = 0;

for (const c of checks) {
    if (!c.same) fail++;
    console.log(`${c.same ? 'OK   ' : 'FALHA'} ${c.name}`);
    if (!c.same) {
        console.log('   esperado:', JSON.stringify(c.expected));
        console.log('   obtido  :', JSON.stringify(c.actual));
    }
}

console.log(`\n${checks.length - fail}/${checks.length} verificacoes de lote OK`);
process.exit(fail ? 1 : 0);
