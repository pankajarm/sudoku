import { readFile } from 'node:fs/promises';

let instance = 0;
const prefix = 'sudoku:v1:';

// This small platform fake implements only browser primitives used by app.js.
// Sudoku rules, storage coordination, timers, and all handlers execute unchanged.
class Events {
  listeners = new Map();
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  emit(type, values = {}) {
    const event = { type, target: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...values };
    for (const handler of this.listeners.get(type) || []) handler(event);
    return event;
  }
}

class Element extends Events {
  constructor(tag, document) {
    super(); this.tagName = tag.toUpperCase(); this.ownerDocument = document;
    this.children = []; this.parentElement = null; this.dataset = {}; this.style = {};
    this.attributes = new Map(); this.className = ''; this.hidden = false; this.disabled = false;
    this.checked = false; this.open = false; this.value = ''; this.ownText = '';
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      toggle: (name, force) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        const enabled = force ?? !names.has(name);
        if (enabled) names.add(name); else names.delete(name);
        this.className = [...names].join(' '); return enabled;
      },
    };
  }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(''); }
  set textContent(text) { this.replaceChildren(); this.ownText = String(text); }
  get isConnected() { return this === this.ownerDocument.body || Boolean(this.parentElement?.isConnected); }
  append(...children) {
    for (const child of children) {
      if (child.parentElement) child.parentElement.children = child.parentElement.children.filter((c) => c !== child);
      child.parentElement = this; this.children.push(child);
    }
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parentElement = null;
    this.children = []; this.ownText = ''; this.append(...children);
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
  }
  getAttribute(name) {
    if (name.startsWith('data-')) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] ?? null;
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name) { this.attributes.delete(name); }
  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    const attribute = selector.match(/^([\w-]+)?\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
    if (attribute) {
      const [, tag, name, value] = attribute;
      return (!tag || this.tagName === tag.toUpperCase()) && this.getAttribute(name) !== null &&
        (value === undefined || this.getAttribute(name) === value);
    }
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    const result = [];
    const visit = (parent) => {
      for (const child of parent.children) {
        if (selector.split(',').some((part) => child.matches(part.trim()))) result.push(child);
        visit(child);
      }
    };
    visit(this); return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() {
    if (this.ownerDocument.activeElement === this) return;
    this.ownerDocument.activeElement = this; this.emit('focus');
  }
  click() { if (!this.disabled) this.emit('click'); }
  showModal() { this.open = true; }
  close() {
    if (!this.open) return;
    this.open = false;
    this.ownerDocument.pending.push(() => this.emit('close'));
  }
  getBoundingClientRect() { return { left: 0, right: 500, top: 0, bottom: 500 }; }
  select() { this.selected = true; }
}

export async function loadApp(initial = {}, { blockedStorage = false } = {}) {
  const document = new Events();
  document.pending = []; document.hidden = false;
  document.body = new Element('body', document);
  document.documentElement = new Element('html', document);
  document.activeElement = document.body;
  document.createElement = (tag) => new Element(tag, document);
  const elements = new Map();
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const element = new Element(match[1], document); element.id = match[3];
    element.hidden = /\bhidden\b/.test(match[2]);
    for (const attribute of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) element.setAttribute(attribute[1], attribute[2]);
    element.className = element.getAttribute('class') || '';
    elements.set(element.id, element); document.body.append(element);
  }
  for (const id of ['modal-title', 'modal-body', 'modal-actions', 'close-modal-btn']) elements.get('modal').append(elements.get(id));
  document.getElementById = (id) => elements.get(id) || null;
  document.querySelectorAll = (selector) => document.body.querySelectorAll(selector);
  document.querySelector = (selector) => document.body.querySelector(selector);
  const window = new Events(), location = new URL('https://example.test/sudoku/');
  const data = new Map(Object.entries(initial).map(([key, value]) => [prefix + key, JSON.stringify(value)]));
  const backend = {
    blocked: blockedStorage,
    getItem(key) { if (this.blocked) throw new Error('SecurityError'); return data.get(key) ?? null; },
    setItem(key, value) { if (this.blocked) throw new Error('QuotaExceededError'); data.set(key, value); },
  };
  let now = 0, timerId = 0;
  const timers = new Map(), originals = new Map();
  const timer = (callback, delay, interval) => { const id = ++timerId; timers.set(id, { callback, at: now + delay, interval }); return id; };
  const globals = { document, window, location, localStorage: backend, navigator: {}, performance: { now: () => now },
    history: { replaceState(_state, _title, path) { location.href = new URL(path, location).href; } },
    setInterval: (callback, delay) => timer(callback, delay, delay), clearInterval: (id) => timers.delete(id),
    setTimeout: (callback, delay) => timer(callback, delay, 0), clearTimeout: (id) => timers.delete(id) };
  for (const [key, value] of Object.entries(globals)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const dispose = () => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  };
  const flush = () => { while (document.pending.length) document.pending.shift()(); };
  try { await import(`../../src/app.js?integration=${++instance}`); }
  catch (error) { dispose(); throw error; }
  return {
    document, window, backend, dispose,
    element: (id) => elements.get(id),
    cells: () => elements.get('board').querySelectorAll('button'),
    click(target) { (typeof target === 'string' ? elements.get(target) : target).click(); flush(); },
    button(text) { return document.querySelectorAll('button').find((button) => button.textContent === text); },
    checkbox(label) { return document.querySelectorAll('input').find((input) => input.getAttribute('aria-label') === label); },
    key(key, options = {}) {
      const event = document.emit('keydown', { target: document.activeElement, key, code: key, ...options }); flush(); return event;
    },
    change(input, checked) { input.checked = checked; input.emit('change'); flush(); },
    visibility(hidden) { document.hidden = hidden; document.emit('visibilitychange'); flush(); },
    dispatch(type, values = {}) { window.emit(type, values); flush(); },
    advance(ms, runTimers = true) {
      const end = now + ms;
      while (runTimers) {
        const next = [...timers].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, task] = next; now = Math.max(now, task.at);
        if (task.interval) task.at = now + task.interval; else timers.delete(id);
        task.callback(); flush();
      }
      now = end;
    },
    saved(key) { const raw = data.get(prefix + key); return raw === undefined ? null : JSON.parse(raw); },
    remote(key, value, notify = true) {
      data.set(prefix + key, JSON.stringify(value));
      if (notify) { window.emit('storage', { key: prefix + key }); flush(); }
    },
  };
}
