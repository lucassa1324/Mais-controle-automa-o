import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(root, 'src');
const outFile = path.join(root, 'dist', 'bundle.user.js');

const HEADER = `// ==UserScript==
// @name         Mais_Controle_Automação_de_Transferência
// @namespace    http://tampermonkey.net/
// @version      2026-10-29-v15
// @description  Automação de transferência com atalho, painel flutuante, lotes de 10, índices, ordenação A-Z e ponte Clipboard (ERP Mais Controle + AppSheet)
// @match        https://acessar.maiscontroleerp.com.br/*
// @match        https://www.appsheet.com/*
// @match        https://appsheet.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// ==/UserScript==

`;

const watch = process.argv.includes('--watch');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });

const options = {
    entryPoints: [path.join(srcDir, 'index.js')],
    bundle: true,
    format: 'iife',
    target: ['chrome100', 'firefox100', 'safari15'],
    charset: 'utf8',
    legalComments: 'none',
    banner: { js: HEADER },
    outfile: outFile,
    logLevel: 'info'
};

if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('Assistindo src/ ...');
} else {
    const result = await esbuild.build(options);
    if (result.errors.length) {
        process.exit(1);
    }
    console.log(`Bundle gerado: ${path.relative(root, outFile)}`);
}
