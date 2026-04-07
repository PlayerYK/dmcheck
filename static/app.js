(function () {
  'use strict';

  const DEFAULT_TLDS = ['com','ai','io','org','net','app','dev','im','pro','one','co','me','xyz','tv','us'];
  const LS_KEY = 'dq_custom_tlds';
  const LS_THEME = 'dq_theme';
  const SUPPORTED_LANGS = ['en', 'zh', 'ja', 'ko', 'es'];
  const THEME_CYCLE = ['auto', 'light', 'dark'];
  const THEME_ICONS = {
    auto: '<circle cx="12" cy="12" r="9" stroke-dasharray="28.27 28.27" stroke-dashoffset="14.14"/><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/><line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/><line x1="1" y1="12" x2="4" y2="12"/>',
    light: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
    dark: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
  };

  const $ = s => document.querySelector(s);

  const app = $('#app');
  const form = $('#searchForm');
  const input = $('#keyword');
  const searchBtn = $('#searchBtn');
  const btnText = searchBtn.querySelector('.btn-text');
  const btnSpinner = searchBtn.querySelector('.btn-spinner');
  const tldToggle = $('#tldToggle');
  const tldEditor = $('#tldEditor');
  const tldTextarea = $('#tldTextarea');
  const resultsSection = $('#resultsSection');
  const statsLine = $('#statsLine');
  const resultsList = $('#resultsList');
  const loadingSection = $('#loadingSection');
  const loadingText = $('#loadingText');
  const errorSection = $('#errorSection');
  const errorMsg = $('#errorMsg');
  const panel = $('#detailPanel');
  const panelTitle = $('#panelTitle');
  const panelBody = $('#panelBody');
  const panelOverlay = $('#panelOverlay');
  const langSwitch = $('#langSwitch');
  const clearBtn = $('#clearBtn');
  const themeToggle = $('#themeToggle');

  let allResults = [];
  let activeSource = null;
  let activeRow = null;

  let currentLang = 'en';
  let currentTheme = 'auto';
  let translations = {};

  function T(key) {
    return translations[key] || key;
  }

  function detectLang() {
    const seg = location.pathname.split('/')[1];
    if (SUPPORTED_LANGS.includes(seg) && seg !== 'en') return seg;
    return 'en';
  }

  async function loadTranslations(lang) {
    if (lang === 'en') {
      try {
        const res = await fetch('/lang/en.json');
        if (res.ok) translations = await res.json();
      } catch (_) {}
      return;
    }
    try {
      const res = await fetch('/lang/' + lang + '.json');
      if (res.ok) translations = await res.json();
    } catch (_) {}
  }

  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (translations[key]) {
        if (el.tagName === 'TITLE') {
          document.title = translations[key];
        } else {
          el.textContent = translations[key];
        }
      }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (translations[key]) el.placeholder = translations[key];
    });
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const key = el.getAttribute('data-i18n-html');
      if (translations[key]) el.innerHTML = translations[key];
    });
    const htmlLangs = { en: 'en', zh: 'zh-CN', ja: 'ja', ko: 'ko', es: 'es' };
    document.documentElement.lang = htmlLangs[currentLang] || 'en';
  }

  const STATUS_KEY_MAP = {
    'clientdeleteprohibited': 'statusClientDeleteProhibited',
    'clienttransferprohibited': 'statusClientTransferProhibited',
    'clientupdateprohibited': 'statusClientUpdateProhibited',
    'clienthold': 'statusClientHold',
    'clientrenewprohibited': 'statusClientRenewProhibited',
    'serverdeleteprohibited': 'statusServerDeleteProhibited',
    'servertransferprohibited': 'statusServerTransferProhibited',
    'serverupdateprohibited': 'statusServerUpdateProhibited',
    'serverhold': 'statusServerHold',
    'serverrenewprohibited': 'statusServerRenewProhibited',
    'addperiod': 'statusAddPeriod',
    'autorenewperiod': 'statusAutoRenewPeriod',
    'redemptionperiod': 'statusRedemptionPeriod',
    'pendingdelete': 'statusPendingDelete',
    'pendingtransfer': 'statusPendingTransfer',
    'ok': 'statusOk',
    'active': 'statusActive',
  };

  function initTheme() {
    const saved = localStorage.getItem(LS_THEME);
    currentTheme = THEME_CYCLE.includes(saved) ? saved : 'auto';
    applyTheme();
  }

  function applyTheme() {
    if (currentTheme === 'auto') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', currentTheme);
    }
    updateThemeIcon();
  }

  function cycleTheme() {
    const idx = THEME_CYCLE.indexOf(currentTheme);
    currentTheme = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
    if (currentTheme === 'auto') {
      localStorage.removeItem(LS_THEME);
    } else {
      localStorage.setItem(LS_THEME, currentTheme);
    }
    applyTheme();
  }

  function updateThemeIcon() {
    const svg = themeToggle.querySelector('.theme-icon');
    if (svg) svg.innerHTML = THEME_ICONS[currentTheme] || THEME_ICONS.auto;
  }

  async function init() {
    initTheme();

    currentLang = detectLang();
    await loadTranslations(currentLang);
    applyTranslations();

    langSwitch.value = currentLang;
    langSwitch.addEventListener('change', () => {
      const lang = langSwitch.value;
      location.href = lang === 'en' ? '/' : '/' + lang + '/';
    });

    themeToggle.addEventListener('click', cycleTheme);

    loadTldSettings();
    form.addEventListener('submit', e => { e.preventDefault(); doSearch(); });
    tldToggle.addEventListener('click', toggleTldEditor);
    $('#tldReset').addEventListener('click', resetTlds);
    $('#tldSave').addEventListener('click', saveTldsAndClose);
    tldTextarea.addEventListener('input', saveTlds);
    $('#panelClose').addEventListener('click', closePanel);
    panelOverlay.addEventListener('click', closePanel);
    $('#errorDismiss').addEventListener('click', () => setState('idle'));
    input.addEventListener('input', () => { clearBtn.hidden = !input.value; });
    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.hidden = true;
      input.focus();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && panel.classList.contains('open')) closePanel();
    });
  }

  function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  function loadTldSettings() {
    const saved = localStorage.getItem(LS_KEY);
    if (saved !== null && saved.trim() !== '') {
      tldTextarea.value = saved;
    } else {
      tldTextarea.value = DEFAULT_TLDS.join('\n');
    }
    autoResize(tldTextarea);
  }

  function saveTlds() {
    const val = tldTextarea.value.trim();
    if (val === '' || val === DEFAULT_TLDS.join('\n')) {
      localStorage.removeItem(LS_KEY);
    } else {
      localStorage.setItem(LS_KEY, tldTextarea.value);
    }
    autoResize(tldTextarea);
  }

  function resetTlds() {
    tldTextarea.value = DEFAULT_TLDS.join('\n');
    localStorage.removeItem(LS_KEY);
    autoResize(tldTextarea);
    tldEditor.hidden = true;
    tldToggle.textContent = T('tldToggle');
  }

  function saveTldsAndClose() {
    saveTlds();
    tldEditor.hidden = true;
    tldToggle.textContent = T('tldToggle');
  }

  function getTlds() {
    const lines = tldTextarea.value.split(/[\n,]+/).map(s => s.trim().replace(/^\./, '').toLowerCase()).filter(Boolean);
    return lines.length > 0 ? [...new Set(lines)] : DEFAULT_TLDS;
  }

  function toggleTldEditor() {
    const show = tldEditor.hidden;
    tldEditor.hidden = !show;
    tldToggle.textContent = show ? T('tldToggleHide') : T('tldToggle');
    if (show) autoResize(tldTextarea);
  }

  function doSearch() {
    if (activeSource) { activeSource.close(); activeSource = null; }

    if (!tldEditor.hidden) saveTldsAndClose();

    const raw = input.value;
    const keyword = raw.replace(/[\s\u3000]+/g, '');
    if (!keyword) return;

    const tlds = getTlds();
    allResults = [];
    resultsList.innerHTML = '';
    closePanel();
    setState('streaming');

    const hasTLD = keyword.includes('.') && /^[a-zA-Z]+$/.test(keyword.split('.').pop());
    let url = '/api/search?keyword=' + encodeURIComponent(keyword) + '&stream=true';
    if (!hasTLD) {
      url += '&tlds=' + encodeURIComponent(tlds.join(','));
    }

    const totalExpected = hasTLD ? 1 : tlds.length;
    let received = 0;

    const source = new EventSource(url);
    activeSource = source;

    source.addEventListener('message', e => {
      try {
        const result = JSON.parse(e.data);
        allResults.push(result);
        received++;
        appendRow(result);
        updateStats();
        loadingText.textContent = T('loadingProgress')
          .replace('{received}', received)
          .replace('{total}', totalExpected);
      } catch {}
    });

    source.addEventListener('done', () => {
      source.close();
      activeSource = null;
      setState('results');
    });

    source.addEventListener('error', () => {
      source.close();
      activeSource = null;
      if (allResults.length > 0) {
        setState('results');
      } else {
        showError(T('errorNetwork'));
      }
    });
  }

  function setState(state) {
    app.className = state === 'idle' ? 'idle' : '';
    const streaming = state === 'streaming';
    resultsSection.hidden = !(state === 'results' || streaming);
    loadingSection.hidden = !streaming;
    errorSection.hidden = state !== 'error';
    searchBtn.disabled = streaming;
    btnText.textContent = streaming ? T('searchBtnLoading') : T('searchBtn');
    btnSpinner.hidden = !streaming;
  }

  function showError(msg) {
    errorMsg.textContent = msg;
    setState('error');
  }

  function updateStats() {
    const c = { available: 0, registered: 0, unknown: 0 };
    allResults.forEach(r => { if (c[r.status] !== undefined) c[r.status]++; });
    const parts = [T('statsTotal').replace('{n}', allResults.length)];
    if (c.available) parts.push(T('statsAvailable').replace('{n}', c.available));
    if (c.registered) parts.push(T('statsRegistered').replace('{n}', c.registered));
    if (c.unknown) parts.push(T('statsUnknown').replace('{n}', c.unknown));
    statsLine.textContent = parts.join(T('statsSep'));
  }

  function appendRow(r) {
    const item = document.createElement('div');
    item.className = 'result-item';

    const row = document.createElement('div');
    row.className = 'result-row';

    const domain = document.createElement('span');
    domain.className = 'result-domain ' + r.status;
    domain.textContent = r.domain;
    row.appendChild(domain);

    if (r.status === 'available') {
      const tag = document.createElement('span');
      tag.className = 'result-tag available';
      tag.textContent = T('tagAvailable');
      row.appendChild(tag);

      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-btn';
      copyBtn.textContent = T('copyBtn');
      copyBtn.addEventListener('click', e => {
        e.stopPropagation();
        copyDomain(r.domain, copyBtn);
      });
      row.appendChild(copyBtn);
    } else if (r.status === 'registered') {
      const meta = document.createElement('span');
      meta.className = 'result-meta';
      const parts = [];
      if (r.registered) parts.push(shortDate(r.registered));
      if (r.expires) parts.push(shortDate(r.expires));
      meta.textContent = parts.length === 2 ? parts[0] + ' ~ ' + parts[1] : parts[0] || '';
      row.appendChild(meta);

      row.classList.add('clickable');
      row.addEventListener('click', () => openPanel(r.domain, row));
    } else {
      const meta = document.createElement('span');
      meta.className = 'result-meta';
      meta.textContent = T('tagUnknown');
      row.appendChild(meta);

      row.classList.add('clickable');
      row.addEventListener('click', () => openPanel(r.domain, row));
    }

    item.appendChild(row);
    resultsList.appendChild(item);
  }

  function copyDomain(domain, btn) {
    navigator.clipboard.writeText(domain).then(() => {
      btn.textContent = T('copiedBtn');
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = T('copyBtn');
        btn.classList.remove('copied');
      }, 1500);
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = domain;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      btn.textContent = T('copiedBtn');
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = T('copyBtn');
        btn.classList.remove('copied');
      }, 1500);
    });
  }

  function openPanel(domain, row) {
    if (activeRow) activeRow.classList.remove('active');
    activeRow = row;
    row.classList.add('active');

    panelTitle.textContent = domain;
    panelBody.innerHTML = '<p class="panel-status-hint" style="opacity:0.5">' + esc(T('panelLoading')) + '</p>';
    panel.classList.add('open');
    panelOverlay.hidden = false;
    requestAnimationFrame(() => panelOverlay.classList.add('visible'));

    fetch('/api/whois/' + encodeURIComponent(domain))
      .then(res => { if (!res.ok) throw new Error(); return res.json(); })
      .then(data => renderPanel(data))
      .catch(() => {
        panelBody.innerHTML = '<p class="panel-status-hint" style="color:var(--c-red)">' + esc(T('panelLoadFail')) + '</p>';
      });
  }

  function closePanel() {
    panel.classList.remove('open');
    panelOverlay.classList.remove('visible');
    setTimeout(() => { panelOverlay.hidden = true; }, 250);
    if (activeRow) { activeRow.classList.remove('active'); activeRow = null; }
  }

  function renderPanel(data) {
    let html = '';

    if (data.status === 'available') {
      html += '<p class="panel-status-hint" style="color:var(--c-green)">' + esc(T('panelAvailable')) + '</p>';
      panelBody.innerHTML = html;
      return;
    }

    if (data.status === 'unknown') {
      html += '<p class="panel-status-hint">' + esc(T('panelUnknown')) + '</p>';
      if (data.raw_whois) {
        html += '<p class="panel-section-title">' + esc(T('sectionRawWhois')) + '</p>' +
          '<pre class="raw-whois-pre">' + esc(data.raw_whois) + '</pre>';
      }
      panelBody.innerHTML = html;
      return;
    }

    var d = esc(data.domain);
    html += '<div class="preview-shot-wrap">' +
        '<img class="preview-shot" src="https://screenshot.domains/' + d + '" alt="' + esc(T('screenshotAlt')) + '" loading="lazy" onerror="this.closest(\'.preview-shot-wrap\').style.display=\'none\'">' +
      '</div>' +
      '<div class="preview-site-link">' +
        '<img class="preview-favicon" src="https://favicon.im/' + d + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' +
        '<a href="http://' + d + '" target="_blank" rel="noopener">' + d + ' ↗</a>' +
      '</div>';

    html += '<p class="panel-section-title">' + esc(T('sectionBasic')) + '</p>';
    html += '<div class="info-grid">';
    if (data.registered) html += infoRow(T('labelRegistered'), formatDate(data.registered));
    if (data.expires) html += infoRow(T('labelExpires'), formatDate(data.expires));
    if (data.updated) html += infoRow(T('labelUpdated'), formatDate(data.updated));
    if (data.registrar) html += infoRow(T('labelRegistrar'), esc(data.registrar));
    html += '</div>';

    if (data.nameservers && data.nameservers.length) {
      html += '<p class="panel-section-title">' + esc(T('sectionDNS')) + '</p>';
      html += '<div class="info-grid">';
      data.nameservers.forEach((ns, i) => {
        html += infoRow('NS' + (i + 1), esc(ns));
      });
      html += '</div>';
    }

    if (data.domain_status && data.domain_status.length) {
      html += '<p class="panel-section-title">' + esc(T('sectionStatus')) + '</p>';
      data.domain_status.forEach(s => {
        html += formatStatusCode(s);
      });
    }

    if (data.raw_whois) {
      html += '<p class="panel-section-title">' + esc(T('sectionRawWhois')) + '</p>' +
        '<pre class="raw-whois-pre">' + esc(data.raw_whois) + '</pre>';
    }

    panelBody.innerHTML = html;
  }

  function infoRow(label, value) {
    return '<span class="info-label">' + esc(label) + '</span><span class="info-value">' + value + '</span>';
  }

  function formatStatusCode(raw) {
    const code = raw.split(/\s/)[0];
    const clean = code.toLowerCase().replace(/[^a-z]/g, '');
    const tKey = STATUS_KEY_MAP[clean];
    const desc = tKey ? T(tKey) : '';
    return '<div class="status-code"><code>' + esc(code) + '</code>' +
      (desc ? '<span class="status-code-desc">' + desc + '</span>' : '') + '</div>';
  }

  function shortDate(s) {
    if (!s) return '';
    return s.substring(0, 7);
  }

  function formatDate(s) {
    if (!s) return '-';
    return s.substring(0, 10);
  }

  function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  init();
})();
