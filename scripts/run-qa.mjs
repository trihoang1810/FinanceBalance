import http from 'node:http';
import fs from 'node:fs/promises';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = process.cwd();
const HOST = '127.0.0.1';
const APP_PORT = 3210;
const DEBUG_PORT = 9222;
const STORAGE_KEY = 'personal_finance_dashboard_state_v12';
const LOG_FILE = path.join(ROOT, 'qa-run.log');

const PRELUDE = `
<script>
window.__qa = {
  alerts: [],
  confirms: [],
  prompts: [],
  promptQueue: [],
  downloads: [],
  pageErrors: [],
  unhandledRejections: [],
  consoleErrors: [],
  charts: []
};
window.alert = (message) => window.__qa.alerts.push(String(message));
window.confirm = (message) => {
  window.__qa.confirms.push(String(message));
  return true;
};
window.prompt = (message, defaultValue = '') => {
  window.__qa.prompts.push({ message: String(message), defaultValue: String(defaultValue ?? '') });
  return window.__qa.promptQueue.length ? window.__qa.promptQueue.shift() : defaultValue;
};
window.addEventListener('error', (event) => {
  window.__qa.pageErrors.push(String(event.message || event.error?.message || 'Unknown page error'));
});
window.addEventListener('unhandledrejection', (event) => {
  window.__qa.unhandledRejections.push(String(event.reason?.message || event.reason || 'Unhandled rejection'));
});
window.__qa.setNextPrompt = (value) => window.__qa.promptQueue.push(value);
window.__qa.clearMessages = () => {
  window.__qa.alerts = [];
  window.__qa.confirms = [];
  window.__qa.prompts = [];
  window.__qa.consoleErrors = [];
  window.__qa.pageErrors = [];
  window.__qa.unhandledRejections = [];
};
window.__qa.blobs = {};
URL.createObjectURL = (blob) => {
  const id = 'blob:qa:' + Math.random().toString(36).slice(2);
  window.__qa.blobs[id] = blob;
  return id;
};
URL.revokeObjectURL = () => {};
const __qaAnchorClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function clickOverride() {
  if (this.href && this.href.startsWith('blob:qa:')) {
    const blob = window.__qa.blobs[this.href];
    Promise.resolve(blob?.text ? blob.text() : '').then((text) => {
      window.__qa.downloads.push({ download: this.download || '', text });
    });
    return;
  }
  return __qaAnchorClick.call(this);
};
</script>`;

const CHART_MOCK = `
window.Chart = class Chart {
  static defaults = { color: '', font: {}, plugins: { legend: { labels: {} } } };
  constructor(canvas, config = {}) {
    this.canvas = canvas;
    this.type = config.type || 'line';
    this.data = JSON.parse(JSON.stringify(config.data || { labels: [], datasets: [] }));
    this.options = JSON.parse(JSON.stringify(config.options || {}));
    window.__qa.charts.push({ id: canvas?.id || null, type: this.type });
  }
  update() {}
  destroy() {}
  resize() {}
};
`;

const SUPABASE_MOCK = `
const clone = (value) => JSON.parse(JSON.stringify(value));
const SESSION_KEY = '__qa_supabase_session__';
const STATE = globalThis.__qaSupabaseState || (globalThis.__qaSupabaseState = {
  listeners: [],
  behavior: {},
  pendingEmails: [],
  users: {}
});

const TABLES = ['accounts', 'categories', 'transactions', 'debt_plans', 'debt_entries'];

function ensureUser(userId) {
  if (!STATE.users[userId]) {
    STATE.users[userId] = {
      accounts: [],
      categories: [],
      transactions: [],
      debt_plans: [],
      debt_entries: []
    };
  }
  return STATE.users[userId];
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

STATE.session = STATE.session || loadSession();

function emit(event, session) {
  STATE.listeners.forEach((listener) => {
    try {
      listener(event, clone(session));
    } catch {}
  });
}

function makeError(message) {
  return { message };
}

function getRows(table, userId) {
  if (STATE.behavior.networkDown) return { data: null, error: makeError('Failed to fetch') };
  if (STATE.behavior.missingTable === table) return { data: null, error: makeError('relation "' + table + '" does not exist') };
  if (STATE.behavior.missingColumnTable === table) return { data: null, error: makeError('column new_field does not exist') };
  return { data: clone(ensureUser(userId)[table]), error: null };
}

function upsertRows(table, rows) {
  if (STATE.behavior.networkDown) return { data: null, error: makeError('Failed to fetch') };
  if (STATE.behavior.missingTable === table) return { data: null, error: makeError('relation "' + table + '" does not exist') };
  if (STATE.behavior.missingColumnTable === table) return { data: null, error: makeError('column new_field does not exist') };
  const userId = rows?.[0]?.user_id || STATE.session?.user?.id;
  if (!userId) return { data: null, error: makeError('No user session') };
  const bucket = ensureUser(userId)[table];
  for (const row of rows || []) {
    const index = bucket.findIndex((item) => item.id === row.id);
    if (index >= 0) bucket[index] = clone(row);
    else bucket.push(clone(row));
  }
  return { data: null, error: null };
}

globalThis.__qaSupabase = {
  reset() {
    STATE.behavior = {};
    STATE.pendingEmails = [];
    STATE.users = {};
    STATE.session = null;
    saveSession(null);
  },
  seed(email, payload) {
    const userId = 'user:' + String(email).toLowerCase();
    const bucket = ensureUser(userId);
    for (const table of TABLES) bucket[table] = clone(payload[table] || []);
  },
  setBehavior(behavior) {
    STATE.behavior = { ...STATE.behavior, ...behavior };
  },
  clearBehavior() {
    STATE.behavior = {};
  },
  completeMagicLink(email) {
    const normalized = String(email).trim().toLowerCase();
    const session = { access_token: 'qa-token', user: { id: 'user:' + normalized, email: normalized } };
    STATE.session = session;
    ensureUser(session.user.id);
    saveSession(session);
    emit('SIGNED_IN', session);
    return clone(session);
  },
  getState() {
    return clone({ behavior: STATE.behavior, pendingEmails: STATE.pendingEmails, users: STATE.users, session: STATE.session });
  }
};

export function createClient() {
  return {
    auth: {
      async getSession() {
        return { data: { session: clone(STATE.session) }, error: null };
      },
      onAuthStateChange(callback) {
        STATE.listeners.push(callback);
        return {
          data: {
            subscription: {
              unsubscribe() {
                STATE.listeners = STATE.listeners.filter((item) => item !== callback);
              }
            }
          }
        };
      },
      async signInWithOtp({ email }) {
        if (STATE.behavior.rateLimit || String(email).includes('rate-limit')) {
          return { data: null, error: makeError('email rate limit exceeded') };
        }
        if (STATE.behavior.authError) {
          return { data: null, error: makeError(STATE.behavior.authError) };
        }
        STATE.pendingEmails.push({ email: String(email).trim().toLowerCase(), at: new Date().toISOString() });
        return { data: {}, error: null };
      },
      async signOut() {
        if (STATE.behavior.signOutError) return { error: makeError(STATE.behavior.signOutError) };
        STATE.session = null;
        saveSession(null);
        emit('SIGNED_OUT', null);
        return { error: null };
      }
    },
    from(table) {
      return {
        select() {
          return {
            eq(_field, value) {
              return Promise.resolve(getRows(table, value));
            }
          };
        },
        upsert(rows) {
          return Promise.resolve(upsertRows(table, rows));
        }
      };
    }
  };
}
`;

function stripBom(value) {
  return value.replace(/^\uFEFF/, '').replace(/^\?<!DOCTYPE html>/i, '<!DOCTYPE html>');
}

async function readUtf8(filePath) {
  return stripBom(await fs.readFile(filePath, 'utf8'));
}

function json(data, status = 200) {
  return { status, body: JSON.stringify(data), headers: { 'content-type': 'application/json; charset=utf-8' } };
}

function text(body, contentType = 'text/plain; charset=utf-8', status = 200) {
  return { status, body, headers: { 'content-type': contentType } };
}

async function buildIndexHtml() {
  let html = await readUtf8(path.join(ROOT, 'index.html'));
  html = html.replace('<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>', '<script src="/__qa/chart.js"></script>');
  html = html.replace('<script type="module" src="src/js/app.js"></script>', '<script type="module" src="/__qa/app.js"></script>');
  html = html.replace('</head>', `${PRELUDE}\n</head>`);
  return html;
}

async function buildAppJs() {
  let source = await readUtf8(path.join(ROOT, 'src/js/app.js'));
  source = source.replace(/^\?/, '');
  source = source.replace(
    /import\s+\{\s*createClient\s*\}\s+from\s+'https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js\/\+esm';/,
    "import { createClient } from '/__qa/supabase.js';"
  );
  source = source.replace("from './config.js';", "from '/src/js/config.js';");
  source = source.replace("from './utils.js';", "from '/src/js/utils.js';");
  return source;
}

async function serveFile(requestPath) {
  const target = path.join(ROOT, requestPath.replace(/^\/+/, '').replace(/\//g, path.sep));
  const normalized = path.normalize(target);
  if (!normalized.startsWith(ROOT)) return text('Forbidden', 'text/plain; charset=utf-8', 403);
  const ext = path.extname(normalized).toLowerCase();
  const contentType = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
  }[ext] || 'application/octet-stream';
  return text(await fs.readFile(normalized), contentType);
}

async function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${HOST}:${APP_PORT}`);
      let response;
      if (url.pathname === '/' || url.pathname === '/index.html') response = text(await buildIndexHtml(), 'text/html; charset=utf-8');
      else if (url.pathname === '/__qa/app.js') response = text(await buildAppJs(), 'application/javascript; charset=utf-8');
      else if (url.pathname === '/__qa/chart.js') response = text(CHART_MOCK, 'application/javascript; charset=utf-8');
      else if (url.pathname === '/__qa/supabase.js') response = text(SUPABASE_MOCK, 'application/javascript; charset=utf-8');
      else if (url.pathname === '/__qa/ping') response = json({ ok: true });
      else response = await serveFile(url.pathname);
      res.writeHead(response.status, response.headers);
      res.end(response.body);
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(String(error.stack || error.message || error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(APP_PORT, HOST, resolve);
  });
  return server;
}

async function waitForJson(url, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await delay(200);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

function findChrome() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.ws = null;
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      const listeners = this.handlers.get(message.method) || [];
      listeners.forEach((listener) => listener(message.params || {}));
    });
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
  }

  on(method, listener) {
    const list = this.handlers.get(method) || [];
    list.push(listener);
    this.handlers.set(method, list);
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async close() {
    if (!this.ws) return;
    this.ws.close();
    await delay(100);
  }
}

async function startBrowser() {
  const chromePath = findChrome();
  if (!chromePath) throw new Error('Không tìm thấy Chrome/Edge để chạy automation.');
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'finance-qa-'));
  const browser = spawn(chromePath, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    `--user-data-dir=${userDataDir}`,
    `http://${HOST}:${APP_PORT}/`
  ], { stdio: 'ignore' });
  const pageList = await waitForJson(`http://${HOST}:${DEBUG_PORT}/json/list`, 15000);
  const pageTarget = pageList.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
  if (!pageTarget) throw new Error('Không lấy được tab browser để debug.');
  return { browser, userDataDir, pageTarget };
}

async function disposeBrowser(browser, userDataDir) {
  if (browser && !browser.killed) {
    browser.kill();
    if (browser.exitCode === null) {
      await Promise.race([
        new Promise((resolve) => browser.once('exit', resolve)),
        delay(2000)
      ]);
    }
  }
  if (userDataDir) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await fs.rm(userDataDir, { recursive: true, force: true });
        break;
      } catch (error) {
        if (error?.code !== 'EBUSY' || attempt === 4) break;
        await delay(300);
      }
    }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function log(message) {
  console.log(message);
  appendFileSync(LOG_FILE, `${message}\n`);
}

function isoNow() {
  return new Date().toISOString();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function tomorrow() {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  return value.toISOString().slice(0, 10);
}

function makeState(overrides = {}) {
  const base = {
    version: 12,
    meta: {
      currency: 'VND',
      themeLabel: 'dark-green',
      lastSavedAt: isoNow(),
      lastCloudSyncAt: null,
      deviceId: 'qa-device'
    },
    accounts: [],
    categories: { expense: [], income: [] },
    transactions: [],
    debtPlans: [],
    debtEntries: []
  };
  return JSON.parse(JSON.stringify({ ...base, ...overrides, meta: { ...base.meta, ...(overrides.meta || {}) } }));
}

async function main() {
  writeFileSync(LOG_FILE, '');
  const server = await startServer();
  let browser;
  let userDataDir = '';
  let client;
  const results = [];
  const browserLogs = { consoleErrors: [], exceptions: [] };

  try {
    const started = await startBrowser();
    browser = started.browser;
    userDataDir = started.userDataDir;
    client = new CDPClient(started.pageTarget.webSocketDebuggerUrl);
    await client.connect();
    client.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error') browserLogs.consoleErrors.push(params.args?.map((arg) => arg.value ?? arg.description ?? '').join(' '));
    });
    client.on('Runtime.exceptionThrown', (params) => {
      browserLogs.exceptions.push(params.exceptionDetails?.text || 'Runtime exception');
    });
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Log.enable');
    await client.send('Console.enable');

    async function evaluate(expression, returnByValue = true) {
      const response = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue, userGesture: true });
      return returnByValue ? response.result.value : response.result;
    }

    async function waitFor(expression, timeoutMs = 8000) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        if (await evaluate(`Boolean(${expression})`)) return;
        await delay(100);
      }
      throw new Error(`Timeout waiting for: ${expression}`);
    }

    async function reload() {
      await client.send('Page.reload', { ignoreCache: true });
      await delay(600);
      await waitFor(`document.querySelector('#navMenu') && document.querySelector('.page.active') && window.__qa && window.__qa.charts.length >= 9`);
      await delay(250);
    }

    async function click(selector) {
      await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Missing ${selector}'); el.click(); })()`);
    }

    async function setValue(selector, value, eventName = 'input') {
      await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Missing ${selector}');
        el.focus();
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event(${JSON.stringify(eventName)}, { bubbles: true }));
        if (${JSON.stringify(eventName)} !== 'change') el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
    }

    async function submit(selector) {
      await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Missing ${selector}');
        if (typeof el.requestSubmit === 'function') el.requestSubmit();
        else el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      })()`);
      await delay(100);
    }

    async function textOf(selector) {
      return evaluate(`(() => document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() || '')()`);
    }

    async function state() {
      return evaluate(`(() => JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)}) || 'null'))()`);
    }

    async function qa() {
      return evaluate(`window.__qa`);
    }

    async function resetApp(seed = makeState()) {
      await evaluate(`(() => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, JSON.stringify(${JSON.stringify(seed)}));
      })()`);
      await reload();
      await evaluate(`window.__qaSupabase.reset(); window.__qa.clearMessages();`);
    }

    async function setViewport(width, height) {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: width <= 480
      });
      await delay(150);
    }

    async function importJson(textPayload, mode = 'merge') {
      await evaluate(`window.__qa.setNextPrompt(${JSON.stringify(mode)})`);
      await evaluate(`(() => {
        const input = document.querySelector('#settingsImportInput');
        const file = new File([${JSON.stringify(textPayload)}], 'qa-import.json', { type: 'application/json' });
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await delay(250);
    }

    async function exportJsonFromSettings() {
      const before = (await qa()).downloads.length;
      await click('#settingsExportBtn');
      await waitFor(`window.__qa.downloads.length > ${before}`);
      return (await qa()).downloads.slice(-1)[0];
    }

    async function test(name, fn) {
      try {
        log(`RUN  ${name}`);
        await fn();
        results.push({ name, ok: true });
        log(`PASS ${name}`);
      } catch (error) {
        results.push({ name, ok: false, error: error.message });
        log(`FAIL ${name}: ${error.message}`);
      }
    }

    await reload();

    await test('NAV-001 load app lần đầu', async () => {
      assert(await textOf('#pageTitle') === 'Dashboard', 'page mặc định không phải Dashboard');
      assert(await evaluate(`!!document.querySelector('.sidebar')`), 'thiếu sidebar');
      assert(browserLogs.consoleErrors.length === 0 && browserLogs.exceptions.length === 0, 'có lỗi JS chặn render');
    });

    await test('NAV-002/NAV-003 thứ tự menu và điều hướng', async () => {
      const order = await evaluate(`[...document.querySelectorAll('#navMenu .nav-btn')].map((button) => button.dataset.page)`);
      assert(JSON.stringify(order) === JSON.stringify(['dashboard', 'reports', 'compare', 'debt', 'transactions', 'accounts', 'settings']), 'thứ tự menu sai');
      for (const page of order) {
        await click(`#navMenu .nav-btn[data-page="${page}"]`);
        await waitFor(`document.querySelector('#page-${page}').classList.contains('active')`);
        assert((await textOf('#pageTitle')).length > 0, `pageTitle rỗng ở ${page}`);
        assert((await textOf('#pageSubtitle')).length > 0, `pageSubtitle rỗng ở ${page}`);
      }
    });

    await test('NAV-004/NAV-005 reload và chuyển trang liên tục', async () => {
      for (const page of ['dashboard', 'reports', 'compare', 'debt', 'transactions', 'accounts', 'settings']) {
        await click(`#navMenu .nav-btn[data-page="${page}"]`);
        await reload();
      }
      assert(await evaluate(`window.__qa.charts.length >= 9`), 'chart không được khởi tạo lại sau reload');
      assert((await qa()).pageErrors.length === 0, 'phát sinh page error khi đổi trang');
    });

    await test('NAV-006/NAV-007/NAV-008 responsive smoke', async () => {
      for (const [w, h] of [[1440, 900], [900, 1000], [390, 844]]) {
        await setViewport(w, h);
        assert(await evaluate(`document.body.scrollHeight > 0`), `layout lỗi ở viewport ${w}`);
        assert(await evaluate(`!!document.querySelector('.sidebar') && !!document.querySelector('.main')`), `mất layout ở viewport ${w}`);
      }
      await setViewport(1440, 900);
    });

    await test('SET-001..SET-013 theme và thiết lập chung', async () => {
      await click('#navMenu .nav-btn[data-page="settings"]');
      assert(await evaluate(`['Thiết lập chung','Cloud Sync với Supabase','Xuất và nhập dữ liệu'].every((text) => document.body.innerText.includes(text))`), 'thiếu block settings');
      await setValue('#currencyInput', 'VND');
      await setValue('#themeLabelInput', 'dark-green', 'change');
      await submit('#generalSettingsForm');
      let savedState = await state();
      assert(savedState.meta.currency === 'VND', 'không lưu VND');
      assert(savedState.meta.themeLabel === 'dark-green', 'không lưu dark-green');
      await click('#navMenu .nav-btn[data-page="dashboard"]');
      assert((await textOf('#metricNetWorth')).includes('₫'), 'VND format sai');
      await click('#navMenu .nav-btn[data-page="settings"]');
      await setValue('#currencyInput', 'USD');
      await setValue('#themeLabelInput', 'dark-blue', 'change');
      await submit('#generalSettingsForm');
      savedState = await state();
      assert(savedState.meta.currency === 'USD', 'không lưu USD');
      assert(savedState.meta.themeLabel === 'dark-blue', 'không lưu dark-blue');
      await click('#navMenu .nav-btn[data-page="dashboard"]');
      assert((await textOf('#metricNetWorth')).includes('USD'), 'USD format sai');
      assert(await evaluate(`document.body.classList.contains('theme-dark-blue')`), 'theme dark-blue không apply');
      await click('#navMenu .nav-btn[data-page="settings"]');
      await setValue('#currencyInput', '');
      await submit('#generalSettingsForm');
      assert((await qa()).alerts.slice(-1)[0].includes('Đơn vị tiền tệ không hợp lệ'), 'không validate currency rỗng');
      await setValue('#currencyInput', 'ABCDEFGHIJK');
      await submit('#generalSettingsForm');
      assert((await qa()).alerts.slice(-1)[0].includes('Đơn vị tiền tệ không hợp lệ'), 'không validate currency quá dài');
      for (const theme of ['dark-green', 'dark-blue', 'light']) {
        await setValue('#currencyInput', 'USD');
        await setValue('#themeLabelInput', theme, 'change');
        await submit('#generalSettingsForm');
        assert(await evaluate(`document.body.classList.contains(${JSON.stringify(`theme-${theme}`)})`), `theme ${theme} không apply`);
        const focusShadow = await evaluate(`(() => {
          const input = document.querySelector('#currencyInput');
          input.focus();
          return getComputedStyle(input).boxShadow;
        })()`);
        assert(focusShadow && focusShadow !== 'none', `focus ring không hiện ở theme ${theme}`);
      }
      await reload();
      assert(await evaluate(`document.body.classList.contains('theme-light')`), 'reload không giữ theme');
      assert(await evaluate(`document.body.innerText.includes('Thiết lập') && !document.body.innerText.includes('Thiáº¿t')`), 'text tiếng Việt còn lỗi mojibake');
    });

    await test('AUTH-001..AUTH-008 auth smoke với mock Supabase', async () => {
      await resetApp();
      await click('#navMenu .nav-btn[data-page="settings"]');
      assert((await textOf('#cloudStatusBox')).includes('chưa kết nối'), 'trạng thái ban đầu không phải chưa kết nối');
      assert(await evaluate(`document.querySelector('#cloudSyncBtn').disabled && document.querySelector('#cloudPullBtn').disabled`), 'nút sync không disable');
      await submit('#cloudLoginForm');
      assert((await qa()).alerts.slice(-1)[0].includes('nhập email'), 'không validate email rỗng');
      await setValue('#cloudEmailInput', 'qa@example.com');
      await submit('#cloudLoginForm');
      assert((await textOf('#cloudStatusBox')).includes('qa@example.com'), 'không hiện trạng thái gửi mail');
      assert(await evaluate(`document.querySelector('#cloudLoginForm button[type="submit"]').disabled`), 'cooldown không khóa nút');
      await submit('#cloudLoginForm');
      assert((await qa()).alerts.slice(-1)[0].includes('chờ'), 'không chặn spam magic link');
      await evaluate(`window.__qaSupabase.completeMagicLink('qa@example.com')`);
      await waitFor(`document.querySelector('#cloudStatusBox').innerText.includes('đã kết nối') && !document.querySelector('#cloudSyncBtn').disabled`);
      await reload();
      assert((await textOf('#cloudStatusBox')).includes('đã kết nối') && await evaluate(`!document.querySelector('#cloudSyncBtn').disabled`), 'reload không restore session');
      await click('#cloudLogoutBtn');
      await waitFor(`document.querySelector('#cloudStatusBox').innerText.includes('chưa kết nối')`);
      await resetApp();
      await click('#navMenu .nav-btn[data-page="settings"]');
      await setValue('#cloudEmailInput', 'rate-limit@example.com');
      await submit('#cloudLoginForm');
      assert((await textOf('#cloudStatusBox')).includes('tạm khóa'), 'không hiện rate limit');
    });

    await test('AUTH-009..AUTH-015 bootstrap cloud và cô lập user', async () => {
      const cloudSeed = {
        accounts: [{ id: 'acc_cloud', user_id: 'user:seed@example.com', name: 'Cloud Wallet', type: 'cash', opening_balance: 500000, note: '', created_at: isoNow(), updated_at: isoNow(), deleted_at: null }],
        categories: [{ id: 'exp_food', user_id: 'user:seed@example.com', kind: 'expense', name: 'Ăn uống', created_at: isoNow(), updated_at: isoNow(), deleted_at: null }],
        transactions: [],
        debt_plans: [],
        debt_entries: []
      };
      await resetApp();
      await evaluate(`window.__qaSupabase.seed('seed@example.com', ${JSON.stringify(cloudSeed)})`);
      await click('#navMenu .nav-btn[data-page="settings"]');
      await evaluate(`window.__qaSupabase.completeMagicLink('seed@example.com')`);
      await waitFor(`JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})).accounts.length === 1`);
      let saved = await state();
      assert(saved.accounts[0].name === 'Cloud Wallet', 'không pull dữ liệu cloud khi local rỗng');

      const localWithData = makeState({
        accounts: [{ id: 'acc_local', name: 'Local Wallet', type: 'cash', openingBalance: 100000, note: '', created_at: isoNow(), updated_at: isoNow(), deleted_at: null }],
        categories: { expense: [], income: [] }
      });
      await resetApp(localWithData);
      await evaluate(`window.__qaSupabase.seed('merge@example.com', ${JSON.stringify(cloudSeed)})`);
      await click('#navMenu .nav-btn[data-page="settings"]');
      await evaluate(`window.__qaSupabase.completeMagicLink('merge@example.com')`);
      await waitFor(`JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})).accounts.length >= 2`);
      saved = await state();
      assert(saved.accounts.some((item) => item.name === 'Local Wallet') && saved.accounts.some((item) => item.name === 'Cloud Wallet'), 'merge bootstrap làm mất dữ liệu');
      await click('#cloudSyncBtn');
      await waitFor(`JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})).meta.lastCloudSyncAt`);
      await evaluate(`window.__qaSupabase.setBehavior({ networkDown: true })`);
      await click('#cloudSyncBtn');
      await waitFor(`document.querySelector('#cloudStatusBox').innerText.includes('Failed to fetch')`);
      await evaluate(`window.__qaSupabase.clearBehavior(); window.__qaSupabase.setBehavior({ missingColumnTable: 'transactions' })`);
      await click('#cloudSyncBtn');
      await waitFor(`document.querySelector('#cloudStatusBox').innerText.includes('column new_field does not exist')`);
      await evaluate(`window.__qaSupabase.clearBehavior()`);
      await click('#cloudLogoutBtn');
      await waitFor(`document.querySelector('#cloudStatusBox').innerText.includes('chưa kết nối')`);
      await evaluate(`window.__qaSupabase.seed('userb@example.com', { accounts: [], categories: [], transactions: [], debt_plans: [], debt_entries: [] });`);
      await evaluate(`window.__qaSupabase.completeMagicLink('userb@example.com')`);
      await delay(300);
      await waitFor(`document.querySelector('#cloudStatusBox').innerText.includes('đã kết nối') && !document.querySelector('#cloudSyncBtn').disabled`);
      saved = await state();
      assert(saved.accounts.some((item) => item.name === 'Local Wallet') && !saved.accounts.some((item) => item.name === 'Only User B'), 'dữ liệu lẫn giữa hai user');
    });

    await test('JSON-001..JSON-009 export/import/merge', async () => {
      await resetApp();
      let download = await exportJsonFromSettings();
      let exported = JSON.parse(download.text);
      assert(Array.isArray(exported.accounts) && Array.isArray(exported.transactions), 'export rỗng không hợp lệ');
      const populated = makeState({
        accounts: [{ id: 'acc1', name: 'Ví', type: 'cash', openingBalance: 1000, note: '', created_at: isoNow(), updated_at: isoNow(), deleted_at: null }],
        categories: { expense: [{ id: 'exp1', kind: 'expense', name: 'Ăn uống', created_at: isoNow(), updated_at: isoNow(), deleted_at: null }], income: [] },
        transactions: [{ id: 'tx1', type: 'expense', date: today(), amount: 100, accountFromId: 'acc1', accountToId: null, categoryId: 'exp1', note: 'Bữa trưa', expenseMode: 'fixed', deviceId: 'qa-device', created_at: isoNow(), updated_at: isoNow(), deleted_at: null }]
      });
      await resetApp(populated);
      download = await exportJsonFromSettings();
      exported = JSON.parse(download.text);
      assert(exported.accounts.length === 1 && exported.categories && exported.meta, 'export đầy đủ thiếu trường chính');
      const replaceState = makeState({ accounts: [{ id: 'acc2', name: 'Bank', type: 'bank', openingBalance: 5000, note: '', created_at: isoNow(), updated_at: isoNow(), deleted_at: null }] });
      await importJson(JSON.stringify(replaceState), 'replace');
      let saved = await state();
      assert(saved.accounts.length === 1 && saved.accounts[0].name === 'Bank', 'replace import không thay toàn bộ');
      const mergeState = makeState({
        accounts: [
          { id: 'acc2', name: 'Bank', type: 'bank', openingBalance: 7000, note: '', created_at: isoNow(), updated_at: new Date(Date.now() + 1000).toISOString(), deleted_at: null },
          { id: 'acc3', name: 'Cash', type: 'cash', openingBalance: 200, note: '', created_at: isoNow(), updated_at: isoNow(), deleted_at: null }
        ],
        categories: {
          expense: [
            { id: 'exp_same_old', kind: 'expense', name: 'Ăn uống', created_at: isoNow(), updated_at: isoNow(), deleted_at: null },
            { id: 'exp_same_new', kind: 'expense', name: 'Ăn uống', created_at: isoNow(), updated_at: new Date(Date.now() + 2000).toISOString(), deleted_at: null }
          ],
          income: []
        }
      });
      await importJson(JSON.stringify(mergeState), 'merge');
      saved = await state();
      assert(saved.accounts.length === 2, 'merge không gộp tài khoản');
      assert(saved.accounts.find((item) => item.id === 'acc2').openingBalance === 7000, 'merge không ưu tiên updated_at mới hơn');
      assert(saved.categories.expense.filter((item) => !item.deleted_at && item.name === 'Ăn uống').length === 1, 'merge không dedup category trùng tên');
      await importJson('not json', 'merge');
      assert((await qa()).alerts.slice(-1)[0].includes('JSON không hợp lệ'), 'không bắt lỗi file không phải JSON');
      const normalizedInput = { version: 12, accounts: [{}], categories: { expense: [], income: [] }, transactions: [] };
      await importJson(JSON.stringify(normalizedInput), 'replace');
      saved = await state();
      assert(saved.accounts[0].name, 'không normalize JSON thiếu trường');
    });

    await test('ACC/CAT/TX/CAL core flow', async () => {
      await resetApp();
      await click('#navMenu .nav-btn[data-page="accounts"]');
      await setValue('#accountNameInput', 'Ví tiền mặt');
      await setValue('#accountTypeInput', 'cash', 'change');
      await setValue('#openingBalanceInput', '100000');
      await submit('#accountForm');
      let saved = await state();
      assert(saved.accounts.length === 1, 'thêm account cash thất bại');
      await setValue('#accountNameInput', 'Ví tiền mặt');
      await setValue('#openingBalanceInput', '100000');
      await submit('#accountForm');
      assert((await qa()).alerts.slice(-1)[0].includes('đã tồn tại'), 'không chặn account trùng');
      await setValue('#accountNameInput', '');
      await submit('#accountForm');
      assert((await qa()).alerts.slice(-1)[0].includes('Tên tài khoản'), 'không chặn account rỗng');
      await setValue('#accountNameInput', 'Bank A');
      await setValue('#openingBalanceInput', '-1');
      await evaluate(`window.__qa.clearMessages()`);
      await submit('#accountForm');
      saved = await state();
      assert((await qa()).alerts.slice(-1)[0]?.includes('không âm') || saved.accounts.length === 1, 'không chặn số dư âm');

      await click('#navMenu .nav-btn[data-page="settings"]');
      await setValue('#expenseCategoryInput', 'Ăn uống');
      await submit('#expenseCategoryForm');
      await setValue('#incomeCategoryInput', 'Lương');
      await submit('#incomeCategoryForm');
      saved = await state();
      assert(saved.categories.expense.length === 1 && saved.categories.income.length === 1, 'thêm category thất bại');
      await setValue('#expenseCategoryInput', 'Ăn uống');
      await submit('#expenseCategoryForm');
      assert((await qa()).alerts.slice(-1)[0].includes('đã tồn tại'), 'không chặn category trùng');

      await click('#navMenu .nav-btn[data-page="transactions"]');
      assert(await evaluate(`document.body.innerText.includes('Quy tắc nhập giao dịch') && document.querySelector('#transactionsTable')`), 'thiếu form giao dịch');
      await setValue('#txTypeInput', 'expense', 'change');
      assert(await evaluate(`!document.querySelector('#txExpenseModeField').classList.contains('hidden')`), 'expense không hiện expense mode');
      await setValue('#txAmountInput', '20000');
      await setValue('#txAccountFromInput', saved.accounts[0].id, 'change');
      await setValue('#txCategoryInput', saved.categories.expense[0].id, 'change');
      await setValue('#txExpenseModeInput', 'fixed', 'change');
      await setValue('#txNoteInput', 'Ăn sáng');
      await submit('#transactionForm');
      saved = await state();
      assert(saved.transactions.length === 1 && saved.transactions[0].expenseMode === 'fixed', 'lưu expense thất bại');

      await setValue('#txTypeInput', 'income', 'change');
      assert(await evaluate(`document.querySelector('#txExpenseModeField').classList.contains('hidden')`), 'income chưa ẩn expense mode');
      await setValue('#txAmountInput', '500000');
      await setValue('#txAccountToInput', saved.accounts[0].id, 'change');
      await setValue('#txCategoryInput', saved.categories.income[0].id, 'change');
      await setValue('#txNoteInput', 'Lương tháng');
      await submit('#transactionForm');

      await click('#navMenu .nav-btn[data-page="accounts"]');
      assert(await evaluate(`document.querySelector('#accountsTable').innerText.includes('580,000') || document.querySelector('#accountsTable').innerText.includes('580.000') || document.querySelector('#accountsTable').innerText.includes('580000')`), 'số dư không cập nhật theo income/expense');

      await click('#navMenu .nav-btn[data-page="transactions"]');
      await setValue('#txTypeInput', 'transfer', 'change');
      assert(await evaluate(`document.querySelector('#txCategoryInput').disabled`), 'transfer không disable category');
      await setValue('#txAmountInput', '10000');
      await setValue('#txAccountFromInput', saved.accounts[0].id, 'change');
      await setValue('#txAccountToInput', saved.accounts[0].id, 'change');
      await submit('#transactionForm');
      assert((await qa()).alerts.slice(-1)[0].includes('khác nhau'), 'không chặn transfer cùng account');

      await setValue('#txTypeInput', 'adjustment', 'change');
      assert(await evaluate(`!document.querySelector('#txAdjustmentField').classList.contains('hidden')`), 'adjustment không hiện mode');
      await setValue('#txAmountInput', '1000');
      await setValue('#txAccountFromInput', saved.accounts[0].id, 'change');
      await setValue('#txAdjustmentModeInput', 'subtract', 'change');
      await submit('#transactionForm');
      saved = await state();
      assert(saved.transactions.slice(-1)[0].amount === -1000, 'adjustment subtract không lưu âm');
      await setValue('#txDateInput', tomorrow(), 'change');
      await setValue('#txAmountInput', '1');
      await evaluate(`window.__qa.clearMessages()`);
      await submit('#transactionForm');
      saved = await state();
      assert((await qa()).alerts.slice(-1)[0]?.includes('tương lai') || saved.transactions.length === 3, 'không chặn ngày tương lai');
    });

    await test('TXL/DASH/REP/CMP/DEBT/UI smoke', async () => {
      const seeded = makeState({
        accounts: [
          { id: 'acc1', name: 'Ví', type: 'cash', openingBalance: 1000, note: '', created_at: isoNow(), updated_at: isoNow(), deleted_at: null },
          { id: 'acc2', name: 'Bank', type: 'bank', openingBalance: 2000, note: '', created_at: isoNow(), updated_at: isoNow(), deleted_at: null }
        ],
        categories: {
          expense: [{ id: 'exp1', kind: 'expense', name: 'Ăn uống', created_at: isoNow(), updated_at: isoNow(), deleted_at: null }],
          income: [{ id: 'inc1', kind: 'income', name: 'Lương', created_at: isoNow(), updated_at: isoNow(), deleted_at: null }]
        },
        transactions: [
          { id: 'tx1', type: 'income', date: today(), amount: 5000, accountFromId: null, accountToId: 'acc2', categoryId: 'inc1', note: 'Lương', expenseMode: null, deviceId: 'qa-device', created_at: isoNow(), updated_at: isoNow(), deleted_at: null },
          { id: 'tx2', type: 'expense', date: today(), amount: 1200, accountFromId: 'acc1', accountToId: null, categoryId: 'exp1', note: 'Ăn tối', expenseMode: 'variable', deviceId: 'qa-device', created_at: isoNow(), updated_at: isoNow(), deleted_at: null }
        ]
      });
      await resetApp(seeded);
      await click('#navMenu .nav-btn[data-page="transactions"]');
      await evaluate(`window.startEditTransaction('tx2')`);
      assert((await textOf('#transactionFormTitle')).includes('Sửa giao dịch'), 'edit transaction không nạp form');
      await click('#transactionCancelEditBtn');
      assert((await textOf('#transactionFormTitle')).includes('Nhập giao dịch'), 'hủy sửa không reset form');
      await evaluate(`window.softDeleteTransaction('tx2')`);
      let saved = await state();
      assert(saved.transactions.find((item) => item.id === 'tx2').deleted_at, 'soft delete transaction thất bại');

      await click('#navMenu .nav-btn[data-page="dashboard"]');
      assert(await evaluate(`document.querySelector('#metricNetWorth').textContent.length > 0 && window.__qa.charts.length >= 9`), 'dashboard không render KPI/chart');
      await setValue('#dashboardQuickRange', '30d', 'change');
      await setValue('#dashboardQuickRange', 'ytd', 'change');
      await setValue('#dashboardQuickRange', 'all', 'change');
      await setValue('#dashboardQuickRange', 'custom', 'change');
      await setValue('#dashboardDateFrom', '2099-01-10', 'change');
      await setValue('#dashboardDateTo', '2099-01-01', 'change');
      assert((await qa()).alerts.slice(-1)[0].includes('không được nhỏ hơn'), 'dashboard không chặn from > to');

      await click('#navMenu .nav-btn[data-page="reports"]');
      await setValue('#reportTypeFilter', 'income', 'change');
      assert((await textOf('#reportTransactionCount')).length > 0, 'reports không update theo filter');

      await click('#navMenu .nav-btn[data-page="compare"]');
      await click('#compareTypeFilter .multi-trigger');
      assert(await evaluate(`document.querySelector('#compareTypeFilter').classList.contains('open')`), 'dropdown compare không mở');
      await click('body');
      assert(await evaluate(`!document.querySelector('#compareTypeFilter').classList.contains('open')`), 'click ngoài dropdown không đóng');

      await click('#navMenu .nav-btn[data-page="debt"]');
      assert(await evaluate(`document.querySelector('#page-debt').classList.contains('active') && !window.__qa.pageErrors.length`), 'trang debt làm app crash');
      assert(await evaluate(`document.body.innerText.includes('Thiết lập') || document.body.innerText.includes('Dashboard')`), 'text tiếng Việt hiển thị lỗi');
    });

    const passed = results.filter((item) => item.ok).length;
    const failed = results.filter((item) => !item.ok);
    log(`\nSummary: ${passed}/${results.length} passed`);
    if (failed.length) {
      log('Failed cases:');
      failed.forEach((item) => log(`- ${item.name}: ${item.error}`));
      process.exitCode = 1;
    }
  } catch (error) {
    log(`Fatal QA runner error: ${error?.stack || error?.message || error}`);
    process.exitCode = 1;
  } finally {
    if (client) await client.close();
    await disposeBrowser(browser, userDataDir);
    server.close();
  }
}

await main();
