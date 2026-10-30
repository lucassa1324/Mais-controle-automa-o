/* =========================================================
   FUNCOES UTILITARIAS
   ========================================================= */

export const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));


export function log(...args) {
    console.log('[Mais Controle]', ...args);
}


export function bodyText() {
    return document.body?.innerText?.toLowerCase() || '';
}


export function cleanText(text) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .trim();
}


export function extractMatCode(text) {
    if (!text) return null;

    const match = String(text)
        .match(/\bMAT\s*[-_]?\s*(\d+)\b/i);

    return match
        ? `MAT${match[1]}`.toUpperCase()
        : null;
}


export function normalizeMatCode(code) {
    if (!code) return null;

    const match = String(code)
        .match(/\bMAT\s*[-_]?\s*(\d+)\b/i);

    return match
        ? `MAT${match[1]}`.toUpperCase()
        : null;
}


export function getSearchNumber(code) {
    if (!code) return '';

    const match = String(code)
        .match(/MAT\s*[-_]?\s*(\d+)/i);

    return match
        ? match[1]
        : String(code).trim();
}


export function parseQuantity(text) {

    const value =
        cleanText(text);


    if (!value)
        return null;


    const match =
        value.match(
            /-?\d+(?:[.,]\d+)?/
        );


    if (!match)
        return null;


    return match[0]
        .replace(',', '.');
}
