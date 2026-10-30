/* =========================================================
   TABELAS / INDICES / ORDENACAO
   ========================================================= */

import { UI_CLASS } from './config'
import { appState, registerControls } from './state'
import { cleanText, extractMatCode } from './utils'

export function getRelevantTables() {

    return Array.from(
        document.querySelectorAll(
            'table'
        )
    )
    .filter(
        table => {

            const text =
                cleanText(
                    table.innerText
                );


            /*
             * Qualquer tabela que tenha MAT
             * é candidata.
             */

            return /MAT\s*[-_]?\s*\d+/i
                .test(text);
        }
    );
}


export function hasIndexHeader(table) {

    return Array.from(
        table.querySelectorAll(
            'thead th, tr:first-child th'
        )
    )
    .some(
        th =>
            cleanText(
                th.innerText
            )
            .toLowerCase() ===
            'índice'
    );
}


export function ensureIndexColumn(table) {

    const headerRow =
        table.querySelector(
            'thead tr'
        ) ||
        table.querySelector(
            'tr'
        );


    if (!headerRow)
        return;


    const existingIndex =
        headerRow.querySelector(
            '.mc-index-header'
        );


    const alreadyNative =
        hasIndexHeader(
            table
        );


    if (
        !alreadyNative &&
        !existingIndex
    ) {

        const th =
            document.createElement(
                'th'
            );


        th.textContent =
            'Índice';


        th.className =
            'mc-index-header mc-index-cell';


        th.dataset.mcGenerated =
            'true';


        headerRow.insertBefore(
            th,
            headerRow.firstElementChild
        );


        const bodyRows =
            Array.from(
                table.querySelectorAll(
                    'tbody tr'
                )
            );


        bodyRows.forEach(
            row => {

                const td =
                    document.createElement(
                        'td'
                    );


                td.className =
                    `mc-index-cell ${UI_CLASS}`;


                td.dataset.mcGenerated =
                    'true';


                row.insertBefore(
                    td,
                    row.firstElementChild
                );
            }
        );
    }


    reindexTable(table);
}


export function getBodyRows(table) {

    let rows =
        Array.from(
            table.querySelectorAll(
                'tbody tr'
            )
        );


    if (!rows.length) {

        rows =
            Array.from(
                table.querySelectorAll(
                    'tr'
                )
            )
            .slice(1);
    }


    /*
     * Somente linhas de materiais.
     */

    return rows.filter(
        row => {

            const text =
                cleanText(
                    row.innerText
                );


            return /MAT\s*[-_]?\s*\d+/i
                .test(text);
        }
    );
}


export function getIndexCell(row) {

    const cells =
        Array.from(
            row.children
        );


    return (
        cells.find(
            cell =>
                cell.classList.contains(
                    'mc-index-cell'
                )
        ) ||
        null
    );
}


export function reindexTable(table) {

    const rows =
        getBodyRows(table);


    if (!rows.length)
        return;


    rows.forEach(
        (row, index) => {

            let cell =
                getIndexCell(
                    row
                );


            /*
             * Caso o índice já seja nativo
             * do próprio ERP.
             */

            if (!cell) {

                const first =
                    row.firstElementChild;


                if (
                    first &&
                    !extractMatCode(
                        first.innerText
                    )
                ) {

                    const firstText =
                        cleanText(
                            first.innerText
                        );


                    if (
                        /^\d+$/.test(
                            firstText
                        )
                    ) {

                        cell =
                            first;


                        cell.classList.add(
                            'mc-index-cell'
                        );
                    }
                }
            }


            if (cell) {

                /*
                 * Sempre escreve o índice
                 * de acordo com a posição atual.
                 */

                cell.textContent =
                    String(
                        index + 1
                    );


                cell.classList.add(
                    'mc-index-cell'
                );
            }
        }
    );
}


export function getNameForRow(row) {

    const text =
        cleanText(
            row.innerText
        );


    const codeMatch =
        text.match(
            /\bMAT\s*[-_]?\s*\d+\b/i
        );


    if (!codeMatch)
        return text.toLowerCase();


    /*
     * Ordena pelo texto depois do MAT.
     *
     * Exemplo:
     *
     * MAT376 - Manilha Media
     *
     * vira:
     *
     * manilha media
     */

    const afterCode =
        text
            .slice(
                codeMatch.index +
                codeMatch[0].length
            )
            .replace(
                /^\s*[-–—:]?\s*/,
                ''
            )
            .trim();


    return afterCode.toLowerCase();
}


export function sortTable(
    table,
    ascending = true
) {

    const tbody =
        table.querySelector(
            'tbody'
        );


    if (!tbody)
        return;


    const rows =
        getBodyRows(
            table
        );


    if (
        rows.length < 2
    ) {
        return;
    }


    rows.sort(
        (a, b) => {

            const nameA =
                getNameForRow(a);


            const nameB =
                getNameForRow(b);


            return ascending

                ? nameA.localeCompare(
                    nameB,
                    'pt-BR',
                    {
                        sensitivity:
                            'base'
                    }
                )

                : nameB.localeCompare(
                    nameA,
                    'pt-BR',
                    {
                        sensitivity:
                            'base'
                    }
                );
        }
    );


    /*
     * Primeiro move as linhas.
     *
     * DEPOIS recalcula os índices.
     *
     * Assim o índice não viaja com
     * o material.
     */

    rows.forEach(
        row =>
            tbody.appendChild(
                row
            )
    );


    reindexTable(
        table
    );
}


export function addSortButton(table) {

    if (
        !appState.extensionEnabled
    ) {
        return;
    }


    if (
        table.dataset.mcSortButtonAdded ===
        'true'
    ) {
        return;
    }


    /*
     * Primeiro garante os índices.
     */

    ensureIndexColumn(
        table
    );


    const wrapper =
        document.createElement(
            'div'
        );


    wrapper.className =
        UI_CLASS;


    wrapper.style.display =
        'flex';


    wrapper.style.justifyContent =
        'flex-end';


    wrapper.style.marginBottom =
        '4px';


    const button =
        document.createElement(
            'button'
        );


    button.type =
        'button';


    button.className =
        `mc-sort-button ${UI_CLASS}`;


    button.textContent =
        '⇅ Ordenar por Nome (A-Z)';


    let ascending =
        true;


    button.addEventListener(
        'click',
        () => {

            sortTable(
                table,
                ascending
            );


            button.textContent =
                ascending

                    ? '⇅ Ordenar por Nome (Z-A)'

                    : '⇅ Ordenar por Nome (A-Z)';


            ascending =
                !ascending;
        }
    );


    wrapper.appendChild(
        button
    );


    /*
     * O botão fica antes da tabela.
     *
     * Isso funciona tanto:
     *
     * - na tela da solicitação
     * - na tela dos insumos adicionados
     */

    table.parentElement?.insertBefore(
        wrapper,
        table
    );


    table.dataset.mcSortButtonAdded =
        'true';
}


export function sortRelevantTables(
    ascending = true
) {

    const tables =
        getRelevantTables();

    const direction =
        ascending !== false;


    tables.forEach(
        table => {

            ensureIndexColumn(
                table
            );

            sortTable(
                table,
                direction
            );
        }
    );


    appState.sortAscending =
        direction;


    return tables.length;
}


export function setupSortingAndIndexes() {

    if (
        !appState.extensionEnabled
    ) {
        return;
    }


    getRelevantTables().forEach(
        table => {

            ensureIndexColumn(
                table
            );


            addSortButton(
                table
            );
        }
    );
}


registerControls({
    sortTables: sortRelevantTables
});
