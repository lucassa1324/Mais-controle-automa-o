/*
 * Teste de fluxo: transicao de telas (Transferência <-> modal Adicionar Insumo).
 *
 * Reproduz o DOM do ERP com as DUAS telas:
 *
 *  - Tela de Transferência: 1x #keyword + botão verde "ADICIONAR INSUMO"
 *  - Modal de busca:         1x #keyword interno + tabela + "ADICIONAR (X)"
 *
 * O bug original era a automação digitar no #keyword da TELA PRINCIPAL
 * (porque o input era confundido com o da modal) e nunca abrir a modal.
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const BASE = 'C:/Users/Lucas sa/Documents/Programação/mais_controle';
const TMP = 'C:/Users/LUCASS~1/AppData/Local/Temp/kilo';

/* ================= entrada ================= */
const ENTRY = path.join(TMP, 'flow-entry.js');
fs.writeFileSync(ENTRY, `
import { isAdicionarInsumoPage, isTransferenciaPage, getAdicionarInsumoSearchInput, getAdicionarInsumoButton, getAdicionarButton, getAdicionarInsumoModal } from '${BASE}/src/pages.js';
import { openAdicionarInsumoModal, findMaterialRow } from '${BASE}/src/erp.js';
export { isAdicionarInsumoPage, isTransferenciaPage, getAdicionarInsumoSearchInput, getAdicionarInsumoButton, getAdicionarButton, getAdicionarInsumoModal, openAdicionarInsumoModal, findMaterialRow };
`, 'utf8');

const OUT = path.join(TMP, 'b-flow.js');
await esbuild.build({
    bundle: true, format: 'iife', globalName: '__EXPORTS',
    target: ['chrome100'], charset: 'utf8', legalComments: 'none', logLevel: 'error',
    entryPoints: [ENTRY], outfile: OUT
});

/* ================= DOM mock (compartilhado) ================= */
import { el, makeSandbox } from './mock-dom.mjs';

/* ================= construcao das telas ================= */
function buildTransferencia() {
    const body = el('body');

    const page = el('div', undefined, 'page Transferencia');
    page.appendChild(el('h1', 'Transferencia'));

    const card = el('div', undefined, 'card');
    card.appendChild(el('h2', 'Itens para transferir'));

    const search = el('input');
    search.id = 'keyword';
    search.setAttribute('placeholder', 'Buscar insumo');
    search.setAttribute('name', 'keyword');
    card.appendChild(search);

    const table = el('table');
    const tbody = el('tbody');
    const tr = el('tr');
    tr.appendChild(el('td', 'MAT010 Item antigo'));
    tr.appendChild(el('td', '2'));
    tbody.appendChild(tr);
    table.appendChild(tbody);
    card.appendChild(table);

    /* o botão verde fica no MESMO bloco do #keyword (bug original) */
    const btn = el('button', 'ADICIONAR INSUMO', 'btn btn-success');
    card.appendChild(btn);

    page.appendChild(card);
    body.appendChild(page);

    body.innerText = 'Transferencia qtde a transferir ADICIONAR INSUMO';

    return { body, search, btn, card };
}

function buildModal(parent, rowText = 'MAT010 Parafuso 10mm') {
    const overlay = el('div', undefined, 'modal-overlay');
    overlay.style.display = 'block';

    const content = el('div', undefined, 'modal-content');
    content.setAttribute('role', 'dialog');

    const header = el('div', undefined, 'modal-header');
    header.appendChild(el('h5', 'ADICIONAR INSUMO'));
    content.appendChild(header);

    const body = el('div', undefined, 'modal-body');

    const search = el('input');
    search.id = 'keyword';
    search.setAttribute('placeholder', 'Buscar');
    search.setAttribute('name', 'keyword');
    body.appendChild(search);

    const table = el('table');
    const tbody = el('tbody');
    const tr = el('tr');
    const tdCode = el('td', rowText);
    const tdCheck = el('td');
    const check = el('input');
    check.type = 'checkbox';
    tdCheck.appendChild(check);
    tr.appendChild(tdCode);
    tr.appendChild(tdCheck);
    tbody.appendChild(tr);
    table.appendChild(tbody);
    body.appendChild(table);

    content.appendChild(body);

    const footer = el('div', undefined, 'modal-footer');
    const confirm = el('button', 'ADICIONAR (20)', 'btn btn-success');
    footer.appendChild(confirm);
    content.appendChild(footer);

    overlay.appendChild(content);
    parent.appendChild(overlay);

    return { overlay, content, search, confirm };
}

/*
 * Modal igual a do ERP real (MUI):
 *  - titulo "Adicionar Insumo";
 *  - input #keyword com label "Busca";
 *  - botao de confirmacao apenas "Adicionar" (sem contagem)
 *    enquanto nada esta selecionado.
 */
function buildMuiModal(parent, rowText = 'MAT389 Parafuso') {
    const overlay = el('div', undefined, 'MuiModal-root MuiDialog-root css-1');
    overlay.style.display = 'block';

    const dialog = el('div', undefined,
        'MuiPaper-root MuiDialog-paper MuiDialog-paperScrollPaper ' +
        'MuiDialog-paperWidthSm MuiDialog-paperFullScreen css-4naer3');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-labelledby', ':r1m:');

    const header = el('div', undefined, 'MuiBox-root css-gg4vpm');
    const title = el('h2', undefined, 'MuiTypography-root MuiDialogTitle-root jss11 css-ypkij7');
    title.id = 'supplies-dialog';
    title.appendChild(el('span', 'Adicionar Insumo', 'MuiTypography-root MuiTypography-body1 css-1e58u9u'));
    header.appendChild(title);
    dialog.appendChild(header);

    const body = el('div', undefined, 'MuiDialogContent-root css-1ty026z');

    const control = el('div', undefined, 'MuiFormControl-root MuiFormControl-fullWidth MuiTextField-root');
    const label = el('label', 'Busca', 'MuiFormLabel-root MuiInputLabel-root');
    label.setAttribute('for', 'keyword');
    label.id = 'keyword-label';
    control.appendChild(label);

    const inputWrap = el('div', undefined, 'MuiInputBase-root MuiOutlinedInput-root');
    const search = el('input');
    search.id = 'keyword';
    search.setAttribute('name', 'keyword');
    search.setAttribute('type', 'text');
    search.className = 'MuiInputBase-input MuiOutlinedInput-input css-1fsvmtw';
    inputWrap.appendChild(search);
    control.appendChild(inputWrap);
    body.appendChild(control);

    const table = el('table');
    const tbody = el('tbody');
    const tr = el('tr');
    const tdCheck = el('td');
    const checkbox = el('input');
    checkbox.type = 'checkbox';
    tdCheck.appendChild(checkbox);
    tr.appendChild(tdCheck);
    tr.appendChild(el('td', rowText));
    tbody.appendChild(tr);
    table.appendChild(tbody);
    body.appendChild(table);

    dialog.appendChild(body);

    const footer = el('div', undefined, 'MuiBox-root css-1wavjlf');
    const confirm = el('button', 'Adicionar', 'MuiButton-root MuiButton-contained');
    confirm.setAttribute('disabled', '');
    footer.appendChild(confirm);
    dialog.appendChild(footer);

    overlay.appendChild(dialog);
    parent.appendChild(overlay);

    return { overlay, dialog, search, confirm };
}

function load() {
    const dom = buildTransferencia();
    const sb = makeSandbox(dom);
    vm.runInContext(fs.readFileSync(OUT, 'utf8'), sb, { filename: 'b-flow.js' });
    return { T: sb.__EXPORTS, dom, sb };
}

/* ================= verificacoes ================= */
const checks = [];

const show = v => {
    if (v && typeof v === 'object') return v?.innerText ?? v?.tagName ?? '[objeto]';
    return JSON.stringify(v);
};

function check(name, actual, expected) {
    const same = (actual && typeof actual === 'object')
        ? actual === expected
        : JSON.stringify(actual) === JSON.stringify(expected);
    checks.push({ name, same, actual, expected });
}

/* ---------- 1) TELA DE TRANSFERENCIA (modal fechada) ---------- */
{
    const { T, dom } = load();

    check('Tela Transferência: isAdicionarInsumoPage() = false', T.isAdicionarInsumoPage(), false);
    check('Tela Transferência: isTransferenciaPage() = true', T.isTransferenciaPage(), true);
    check('Tela Transferência: não há campo de busca da modal', T.getAdicionarInsumoSearchInput(), null);
    check('Tela Transferência: sem container de modal', T.getAdicionarInsumoModal(), null);
    check('Tela Transferência: botão ADICIONAR INSUMO encontrado',
        T.getAdicionarInsumoButton()?.innerText, 'ADICIONAR INSUMO');
    check('Tela Transferência: sem botão de confirmação ADICIONAR (X)',
        T.getAdicionarButton(), null);

    /* o clique em ADICIONAR INSUMO abre a modal (simula o ERP) */
    let modalCriada = null;
    dom.btn.onClick = () => { modalCriada = buildModal(dom.body); };
    dom.btn.click();

    check('Após clicar em ADICIONAR INSUMO: modal detectada', T.isAdicionarInsumoPage(), true);
    check('Após clicar em ADICIONAR INSUMO: campo de busca é o da modal',
        T.getAdicionarInsumoSearchInput() === modalCriada.search, true);
    check('Após clicar em ADICIONAR INSUMO: campo de busca NÃO é o da tela principal',
        T.getAdicionarInsumoSearchInput() === dom.search, false);
}

/* ---------- 2) MODAL ABERTA (com os DOIS #keyword) ---------- */
{
    const { T, dom } = load();
    const modal = buildModal(dom.body);

    check('Modal aberta: isAdicionarInsumoPage() = true', T.isAdicionarInsumoPage(), true);
    check('Modal aberta: isTransferenciaPage() = false', T.isTransferenciaPage(), false);
    check('Modal aberta: campo de busca é o da modal',
        T.getAdicionarInsumoSearchInput() === modal.search, true);
    check('Modal aberta: campo de busca NÃO é o da tela principal',
        T.getAdicionarInsumoSearchInput() === dom.search, false);
    check('Modal aberta: botão de confirmação ADICIONAR (20)',
        T.getAdicionarButton()?.innerText, 'ADICIONAR (20)');
    check('Modal aberta: botão ADICIONAR INSUMO continua sendo o da tela',
        T.getAdicionarInsumoButton()?.innerText, 'ADICIONAR INSUMO');
    check('Modal aberta: linha do material vem da tabela da modal',
        T.findMaterialRow('MAT010')?.innerText?.includes('Parafuso'), true);
}

/* ---------- 2a) MODAL REAL DO ERP (MUI, label "Busca", botao "Adicionar") ---------- */
{
    const { T, dom } = load();
    const modal = buildMuiModal(dom.body);

    check('Modal MUI real: isAdicionarInsumoPage() = true', T.isAdicionarInsumoPage(), true);
    check('Modal MUI real: isTransferenciaPage() = false', T.isTransferenciaPage(), false);
    check('Modal MUI real: campo de busca é o da modal',
        T.getAdicionarInsumoSearchInput() === modal.search, true);
    check('Modal MUI real: campo de busca NÃO é o da tela principal',
        T.getAdicionarInsumoSearchInput() === dom.search, false);
    check('Modal MUI real: botão de confirmação é "Adicionar"',
        T.getAdicionarButton()?.innerText, 'Adicionar');
    check('Modal MUI real: botão ADICIONAR INSUMO continua sendo o da tela',
        T.getAdicionarInsumoButton()?.innerText, 'ADICIONAR INSUMO');
}

/* ---------- 2b) MODAL REAL ABERTA PELO CLIQUE EM ADICIONAR INSUMO ---------- */
{
    const { T, dom } = load();

    let modal = null;
    dom.btn.onClick = () => { modal = buildMuiModal(dom.body); };

    const res = await T.openAdicionarInsumoModal();

    check('Modal MUI real: openAdicionarInsumoModal() retorna ok', res, 'ok');
    check('Modal MUI real: modal ficou aberta', T.isAdicionarInsumoPage(), true);
    check('Modal MUI real: busca aponta para o campo da modal',
        T.getAdicionarInsumoSearchInput() === modal.search, true);
    check('Modal MUI real: busca NÃO usa o #keyword da tela',
        T.getAdicionarInsumoSearchInput() === dom.search, false);
}

/* ---------- 3) MODAL QUE SUBSTITUI O CAMPO DA TELA ---------- */
{
    const { T, dom } = load();

    dom.search.style.display = 'none';

    const modal = buildModal(dom.body);

    check('Modal sem #keyword da tela: modal detectada pelo botão ADICIONAR (X)',
        T.isAdicionarInsumoPage(), true);
    check('Modal sem #keyword da tela: campo de busca é o da modal',
        T.getAdicionarInsumoSearchInput() === modal.search, true);
}

/* ---------- 4) MODAL ESCONDIDA ---------- */
{
    const { T, dom } = load();
    const modal = buildModal(dom.body);
    modal.overlay.style.display = 'none';

    check('Modal escondida: isAdicionarInsumoPage() = false', T.isAdicionarInsumoPage(), false);
    check('Modal escondida: isTransferenciaPage() = true', T.isTransferenciaPage(), true);
}

/* ---------- 4a) MODAL ANTIGA (MUI opacity 0) NAO CONTA ---------- */
{
    const { T, dom } = load();
    const old = buildModal(dom.body);
    old.overlay.style.opacity = '0';

    check('Modal antiga (opacity 0): isAdicionarInsumoPage() = false', T.isAdicionarInsumoPage(), false);
    check('Modal antiga (opacity 0): isTransferenciaPage() = true', T.isTransferenciaPage(), true);
    check('Modal antiga (opacity 0): sem campo de busca da modal', T.getAdicionarInsumoSearchInput(), null);
    check('Modal antiga (opacity 0): NÃO usa o #keyword da tela', T.getAdicionarInsumoSearchInput() === dom.search, false);
    check('Modal antiga (opacity 0): sem botão ADICIONAR (X)', T.getAdicionarButton(), null);
    check('Modal antiga (opacity 0): ADICIONAR INSUMO disponível',
        T.getAdicionarInsumoButton()?.innerText, 'ADICIONAR INSUMO');
}

/* ---------- 4a2) MODAL NOVA COM MODAL ANTIGA AINDA NO DOM ---------- */
{
    const { T, dom } = load();
    const old = buildModal(dom.body);
    old.overlay.style.opacity = '0';

    const active = buildModal(dom.body);

    check('Modal ativa + antiga: campo é o da modal nova',
        T.getAdicionarInsumoSearchInput() === active.search, true);
    check('Modal ativa + antiga: NÃO é o campo da modal antiga',
        T.getAdicionarInsumoSearchInput() === old.search, false);
    check('Modal ativa + antiga: NÃO é o #keyword da tela',
        T.getAdicionarInsumoSearchInput() === dom.search, false);
    check('Modal ativa + antiga: confirmação é a da modal nova',
        T.getAdicionarButton()?.innerText, 'ADICIONAR (20)');
}

/* ---------- 4a3) DOIS #keyword: busca x filtro dos adicionados ---------- */
{
    const { T, dom } = load();
    const modal = buildModal(dom.body);

    const control = el('div', undefined, 'MuiFormControl-root');
    control.appendChild(el('label', 'Buscar um insumo'));

    const good = el('input');
    good.id = 'keyword';
    good.setAttribute('name', 'keyword');
    good.className = 'MuiInputBase-input MuiOutlinedInput-input';
    control.appendChild(good);
    modal.content.appendChild(control);

    const filter = el('input');
    filter.id = 'keyword';
    filter.setAttribute('name', 'keyword');
    filter.setAttribute('aria-label', 'Buscar insumos adicionados');
    filter.className = 'MuiInputBase-input MuiOutlinedInput-input MuiInputBase-inputAdornedEnd';
    modal.content.appendChild(filter);

    check('Campo duplicado: escolhe o campo "Buscar um insumo"',
        T.getAdicionarInsumoSearchInput() === good, true);
    check('Campo duplicado: NÃO escolhe o filtro dos adicionados',
        T.getAdicionarInsumoSearchInput() === filter, false);
    check('Campo duplicado: NÃO escolhe o #keyword antigo da modal',
        T.getAdicionarInsumoSearchInput() === modal.search, false);
}

/* ---------- 4a4) WRAPPER "modal-open" NÃO É MODAL ---------- */
{
    const { T, dom } = load();

    const wrapper = el('div', undefined, 'page-content modal-open');

    const pageFilter = el('input');
    pageFilter.id = 'keyword';
    pageFilter.setAttribute('placeholder', 'Buscar');
    pageFilter.className = 'MuiInputBase-input MuiInputBase-inputAdornedEnd';
    wrapper.appendChild(pageFilter);

    dom.body.appendChild(wrapper);

    check('Wrapper modal-open: isAdicionarInsumoPage() = false', T.isAdicionarInsumoPage(), false);
    check('Wrapper modal-open: sem campo de busca da modal', T.getAdicionarInsumoSearchInput(), null);
    check('Wrapper modal-open: isTransferenciaPage() = true', T.isTransferenciaPage(), true);
    check('Wrapper modal-open: ADICIONAR INSUMO disponível',
        T.getAdicionarInsumoButton()?.innerText, 'ADICIONAR INSUMO');
}

/* ---------- 4a5) WRAPPER "modal-open" COM MODAL ANTIGA ESCONDIDA ---------- */
{
    const { T, dom } = load();

    dom.card.classList.add('modal-open');

    const old = buildMuiModal(dom.card);
    old.overlay.style.opacity = '0';

    check('Wrapper + modal antiga: isAdicionarInsumoPage() = false', T.isAdicionarInsumoPage(), false);
    check('Wrapper + modal antiga: sem campo de busca da modal', T.getAdicionarInsumoSearchInput(), null);
    check('Wrapper + modal antiga: NÃO usa o #keyword da tela',
        T.getAdicionarInsumoSearchInput() === dom.search, false);
    check('Wrapper + modal antiga: isTransferenciaPage() = true', T.isTransferenciaPage(), true);
}

/* ---------- 4a6) "Adicionar" FORA DA MODAL NÃO É O CONFIRM ---------- */
{
    const { T, dom } = load();
    const modal = buildMuiModal(dom.body);

    const outside = el('button', 'Adicionar', 'btn');
    dom.body.appendChild(outside);

    check('Confirmar lote: usa o "Adicionar" DENTRO da modal',
        T.getAdicionarButton() === modal.confirm, true);
    check('Confirmar lote: NÃO usa o "Adicionar" da página',
        T.getAdicionarButton() === outside, false);
}

/* ---------- 4a7) BOTÃO "ADICIONAR INSUMO" DESABILITADO NO RE-RENDER ---------- */
{
    const { T, dom } = load();

    dom.btn.setAttribute('disabled', '');
    dom.btn.onClick = () => buildMuiModal(dom.body);

    setTimeout(() => {
        delete dom.btn.attributes.disabled;
    }, 300);

    const res = await T.openAdicionarInsumoModal();

    check('Botão desabilitado: openAdicionarInsumoModal() espera e retorna ok', res, 'ok');
    check('Botão desabilitado: modal abriu depois do re-render', T.isAdicionarInsumoPage(), true);
    check('Botão desabilitado: busca aponta para o campo da modal',
        T.getAdicionarInsumoSearchInput() === dom.search, false);
}

/* ---------- 4a8) REABRIR A MODAL DEPOIS DE FECHAR (2º LOTE) ---------- */
{
    const { T, dom } = load();

    const modal = buildMuiModal(dom.body);
    modal.overlay.remove();

    let reopened = null;
    dom.btn.onClick = () => { reopened = buildMuiModal(dom.body); };

    check('2º lote: após fechar a modal, está na Transferência', T.isTransferenciaPage(), true);

    const res = await T.openAdicionarInsumoModal();

    check('2º lote: openAdicionarInsumoModal() reabre e retorna ok', res, 'ok');
    check('2º lote: modal reaberta detectada', T.isAdicionarInsumoPage(), true);
    check('2º lote: busca aponta para o campo da modal reaberta',
        T.getAdicionarInsumoSearchInput() === reopened?.search, true);
}

/* ---------- 4b) RESULTADOS EM GRADE (ARIA/MUI) ---------- */
{
    const { T, dom } = load();
    const modal = buildModal(dom.body);

    const grid = el('div');
    grid.setAttribute('role', 'grid');

    const row = el('div');
    row.setAttribute('role', 'row');
    row.appendChild(el('div', 'MAT777 Rolamento'));
    row.appendChild(el('div', '3'));

    const check2 = el('input');
    check2.type = 'checkbox';
    check2.onClick = () => { check2.checked = !check2.checked; };
    row.appendChild(check2);

    grid.appendChild(row);
    modal.content.appendChild(grid);

    check('Grade ARIA: linha MAT777 encontrada', T.findMaterialRow('MAT777') === row, true);
}

/* ---------- 5) openAdicionarInsumoModal() ---------- */
{
    const { T, dom } = load();

    dom.btn.onClick = () => buildModal(dom.body);

    const res = await T.openAdicionarInsumoModal();

    check('openAdicionarInsumoModal(): retorna ok', res, 'ok');
    check('openAdicionarInsumoModal(): modal ficou aberta', T.isAdicionarInsumoPage(), true);
    check('openAdicionarInsumoModal(): busca aponta para o campo da modal',
        T.getAdicionarInsumoSearchInput() === dom.search, false);
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
console.log(`\n${checks.length - fail}/${checks.length} verificacoes de fluxo OK`);
process.exit(fail ? 1 : 0);
