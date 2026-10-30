/*
 * DOM mock compartilhado pelos testes.
 *
 * Suporta:
 *  - seletores com tag, #id, .classe, [attr], [attr="v"], [attr*="v"];
 *  - combinador de descendente;
 *  - visibilidade (display/visibility herdado dos ancestrais).
 */

import vm from 'node:vm';

export class El {

    constructor(tag) {
        this.tagName = (tag || 'div').toUpperCase();
        this.childNodes = [];
        this.parentElement = null;
        this.attributes = {};
        this.style = {};
        this.dataset = {};
        this.hidden = false;
        this._classList = new Set();
        this._text = null;
        this.id = '';
        this.type = '';
        this.value = '';
        this.checked = false;

        this.classList = {
            add: (...c) => c.forEach(x => this._classList.add(x)),
            remove: (...c) => c.forEach(x => this._classList.delete(x)),
            contains: c => this._classList.has(c),
            toggle: (c, on) => on ? this._classList.add(c) : this._classList.delete(c)
        };
    }

    get className() { return Array.from(this._classList).join(' '); }
    set className(v) { this._classList = new Set(String(v || '').split(/\s+/).filter(Boolean)); }

    getAttribute(name) {
        if (name === 'class') return this.className || null;
        if (name === 'id') return this.id || null;
        return Object.prototype.hasOwnProperty.call(this.attributes, name)
            ? this.attributes[name]
            : null;
    }

    setAttribute(name, value) { this.attributes[name] = String(value); }

    get children() { return this.childNodes.filter(c => c instanceof El); }
    get firstElementChild() { return this.children[0] || null; }
    get nextElementSibling() {
        if (!this.parentElement) return null;
        const sibs = this.parentElement.children;
        const i = sibs.indexOf(this);
        return i >= 0 ? (sibs[i + 1] || null) : null;
    }
    get previousElementSibling() {
        if (!this.parentElement) return null;
        const sibs = this.parentElement.children;
        const i = sibs.indexOf(this);
        return i > 0 ? sibs[i - 1] : null;
    }

    appendChild(c) { c.parentElement = this; this.childNodes.push(c); return c; }
    removeChild(c) { this.childNodes = this.childNodes.filter(x => x !== c); return c; }
    remove() { this.parentElement?.removeChild(this); }

    get textContent() {
        if (this._text !== null && this._text !== undefined)
            return this._text;
        return this.children.map(c => c.textContent).join('');
    }

    set textContent(v) { this._text = v; }

    get innerText() {
        if (this._text !== null) return this._text;
        return this.children.map(c => c.innerText).filter(Boolean).join('\n');
    }

    set innerText(v) { this._text = v; }

    getClientRects() {
        /* no navegador, um filho de um container display:none tambem nao tem retangulos */
        let node = this;
        while (node) {
            if (node.style.display === 'none') return [];
            if (node.style.visibility === 'hidden') return [];
            if (node.hidden) return [];
            node = node.parentElement;
        }
        return [{ left: 0, top: 0, width: 100, height: 20 }];
    }

    getBoundingClientRect() {
        if (this._rect)
            return this._rect;
        return { left: 0, top: 0, width: 100, height: 20 };
    }

    focus() {}
    select() {}
    click() {
        this._clicked = true;
        this.onClick?.(this);
        (this._listeners?.click || []).forEach(fn => fn({ target: this }));
    }
    addEventListener(type, fn) {
        this._listeners = this._listeners || {};
        (this._listeners[type] = this._listeners[type] || []).push(fn);
    }
    removeEventListener() {}
    dispatchEvent() { return true; }
    querySelectorAll(selector) { return querySelectorAll(this, selector); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) {
        const list = String(selector).split(',').map(s => s.trim()).filter(Boolean);
        let node = this;
        while (node) {
            if (list.some(s => matchesSelector(node, s))) return node;
            node = node.parentElement;
        }
        return null;
    }
    contains(node) {
        let n = node;
        while (n) {
            if (n === this) return true;
            n = n.parentElement;
        }
        return false;
    }
    get offsetWidth() { return 100; }
    get offsetHeight() { return 20; }

    descendants() {
        const out = [];
        const walk = el => el.children.forEach(c => { out.push(c); walk(c); });
        walk(this);
        return out;
    }
}

/* ---------- seletor CSS ---------- */
export function compoundTokens(compound) {
    const tokens = [];
    const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([~^$*|]?=)"?([^"\]]*)"?)?\]/g;
    let m;
    while ((m = re.exec(compound))) {
        if (m[1]) tokens.push({ type: 'tag', value: m[1].toLowerCase() });
        else if (m[2]) tokens.push({ type: 'id', value: m[2] });
        else if (m[3]) tokens.push({ type: 'cls', value: m[3] });
        else if (m[4]) tokens.push({ type: 'attr', name: m[4], op: m[5], value: m[6] });
    }
    return tokens;
}

export function matchesCompound(el, tokens) {
    for (const t of tokens) {
        if (t.type === 'tag') {
            if (el.tagName.toLowerCase() !== t.value) return false;
        } else if (t.type === 'id') {
            if (el.id !== t.value) return false;
        } else if (t.type === 'cls') {
            if (!el.classList.contains(t.value)) return false;
        } else {
            const v = el.getAttribute(t.name);
            if (v === null) return false;
            if (t.op === '=' && v !== t.value) return false;
            if (t.op === '*=' && !v.includes(t.value)) return false;
            if (t.op === '^=' && !v.startsWith(t.value)) return false;
            if (t.op === '$=' && !v.endsWith(t.value)) return false;
            if (t.op === '~=' && !v.split(/\s+/).includes(t.value)) return false;
        }
    }
    return true;
}

export function matchesSelector(el, selector) {
    const parts = selector.trim().split(/\s+/).map(p => compoundTokens(p));
    if (!parts.length) return false;

    let node = el;
    let i = parts.length - 1;

    if (!matchesCompound(node, parts[i])) return false;
    i--;

    while (i >= 0) {
        let ancestor = node.parentElement;
        let found = false;
        while (ancestor) {
            if (matchesCompound(ancestor, parts[i])) {
                found = true;
                node = ancestor;
                break;
            }
            ancestor = ancestor.parentElement;
        }
        if (!found) return false;
        i--;
    }

    return true;
}

export function querySelectorAll(root, selector) {
    const list = String(selector).split(',').map(s => s.trim()).filter(Boolean);
    return root.descendants().filter(el => list.some(s => matchesSelector(el, s)));
}

export const el = (tag, text, cls) => {
    const e = new El(tag);
    if (text !== undefined) e.innerText = text;
    if (cls) cls.split(' ').forEach(c => e.classList.add(c));
    return e;
};

export function makeSandbox(dom, options = {}) {

    const store = new Map();

    const sb = {
        document: {
            body: dom.body,
            head: el('head'),
            documentElement: el('html'),
            readyState: 'complete',
            createElement: t => el(t),
            getElementById: id => dom.body.descendants().find(e => e.id === id) || null,
            querySelector: s => querySelectorAll(dom.body, s)[0] || null,
            querySelectorAll: s => querySelectorAll(dom.body, s),
            addEventListener: () => {},
            removeEventListener: () => {},
            execCommand: () => true
        },
        window: {
            innerWidth: 1440,
            innerHeight: 900,
            location: {
                hostname: options.hostname || 'acessar.maiscontroleerp.com.br',
                href: options.href || `https://${options.hostname || 'acessar.maiscontroleerp.com.br'}/`
            },
            getComputedStyle: el2 => ({
                display: el2.style.display || 'block',
                visibility: el2.style.visibility || 'visible',
                opacity: el2.style.opacity ?? '1',
                position: el2.style.position || 'static'
            })
        },
        location: {
            hostname: options.hostname || 'acessar.maiscontroleerp.com.br'
        },
        localStorage: {
            getItem: k => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: k => store.delete(k)
        },
        MutationObserver: class { observe() {} disconnect() {} },
        KeyboardEvent: class { constructor() {} },
        Event: class { constructor(t, o) { this.type = t; Object.assign(this, o); } },
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: id => clearTimeout(id),
        console: { log: () => {}, error: () => {}, warn: () => {} },
        alert: () => {},
        Math, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Error, Promise, Set, Map,
        isNaN, parseInt, parseFloat, Infinity, undefined
    };

    sb.globalThis = sb;
    sb.self = sb;
    sb.__store = store;

    vm.createContext(sb);

    return sb;
}
