(function () {
  'use strict';

  const DEFAULT_TLDS = ['com','ai','io','org','net','app','dev','im','pro','one','co','me','xyz','tv','us'];
  const LS_KEY = 'dq_custom_tlds';
  const LS_THEME = 'dq_theme';
  const SUPPORTED_LANGS = ['en', 'zh', 'ja', 'ko', 'es'];
  const THEME_CYCLE = ['graphite', 'carbon'];
  const THEME_ICONS = {
    graphite: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    carbon: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
  };
  const DOMAIN_LABEL_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
  const TLD_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

  const $ = s => document.querySelector(s);

  const app = $('#app');
  const form = $('#searchForm');
  const input = $('#keyword');
  const searchBtn = $('#searchBtn');
  const btnText = searchBtn.querySelector('.btn-text');
  const btnSpinner = searchBtn.querySelector('.btn-spinner');
  const tldToggle = $('#tldToggle');
  const tldToggleButtons = Array.from(document.querySelectorAll('[data-tld-toggle]'));
  const tldEditor = $('#tldEditor');
  const tldTextarea = $('#tldTextarea');
  const resultsSection = $('#resultsSection');
  const statsLine = $('#statsLine');
  const resultsList = $('#resultsList');
  const loadingSection = $('#loadingSection');
  const loadingText = $('#loadingText');
  const ledgerTitle = $('#ledgerTitle');
  const progressText = $('#progressText');
  const progressCount = $('#progressCount');
  const progressFill = $('#progressFill');
  const snapshotButton = $('#snapshotButton');
  const snapshotOverlay = $('#snapshotOverlay');
  const snapshotDialog = $('#snapshotDialog');
  const snapshotPreview = $('#snapshotPreview');
  const snapshotClose = $('#snapshotClose');
  const snapshotCopy = $('#snapshotCopy');
  const snapshotDownload = $('#snapshotDownload');
  const snapshotShare = $('#snapshotShare');
  const snapshotStatus = $('#snapshotStatus');
  const errorSection = $('#errorSection');
  const errorMsg = $('#errorMsg');
  const formError = $('#formError');
  const panel = $('#detailPanel');
  const panelTitle = $('#panelTitle');
  const panelSubtitle = $('#panelSubtitle');
  const panelBody = $('#panelBody');
  const panelOverlay = $('#panelOverlay');
  const panelClose = $('#panelClose');
  const langSwitch = $('#langSwitch');
  const clearBtn = $('#clearBtn');
  const themeToggle = $('#themeToggle');
  const suffixChips = [$('#suffixOne'), $('#suffixTwo'), $('#suffixThree')];
  const suffixMore = $('#suffixMore');
  const lineCount = $('#lineCount');
  const uniqueCount = $('#uniqueCount');
  const invalidCount = $('#invalidCount');

  let allResults = [];
  let activeSource = null;
  let activeRow = null;
  let panelRestoreTarget = null;
  let panelRequestSeq = 0;
  let currentSearchKeyword = '';
  let currentExpected = DEFAULT_TLDS.length;
  let currentReceived = DEFAULT_TLDS.length;
  let activeSnapshotBlob = null;
  let activeSnapshotFileName = '';
  let activeSnapshotUrl = '';
  let snapshotReturnFocus = null;

  let currentLang = 'en';
  let currentTheme = 'graphite';
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
    document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
      const key = el.getAttribute('data-i18n-aria-label');
      if (translations[key]) el.setAttribute('aria-label', translations[key]);
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
    if (saved === 'dark') {
      currentTheme = 'carbon';
    } else if (saved === 'light' || saved === 'auto') {
      currentTheme = 'graphite';
    } else {
      currentTheme = THEME_CYCLE.includes(saved) ? saved : 'graphite';
    }
    applyTheme();
  }

  function applyTheme() {
    if (currentTheme === 'carbon') {
      document.documentElement.setAttribute('data-theme', currentTheme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    updateThemeIcon();
  }

  function cycleTheme() {
    const idx = THEME_CYCLE.indexOf(currentTheme);
    currentTheme = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
    localStorage.setItem(LS_THEME, currentTheme);
    applyTheme();
  }

  function updateThemeIcon() {
    const svg = themeToggle.querySelector('.theme-icon');
    if (svg) svg.innerHTML = THEME_ICONS[currentTheme] || THEME_ICONS.graphite;
    themeToggle.setAttribute('aria-label', currentTheme === 'carbon' ? T('themeDayLabel') : T('themeNightLabel'));
  }

  async function init() {
    initTheme();

    currentLang = detectLang();
    await loadTranslations(currentLang);
    applyTranslations();
    updateThemeIcon();

    langSwitch.value = currentLang;
    langSwitch.addEventListener('change', () => {
      const lang = langSwitch.value;
      location.href = lang === 'en' ? '/' : '/' + lang + '/';
    });

    themeToggle.addEventListener('click', cycleTheme);
    if (snapshotButton) {
      snapshotButton.addEventListener('click', createResultSnapshot);
    }
    if (snapshotClose) snapshotClose.addEventListener('click', closeSnapshotDialog);
    if (snapshotOverlay) snapshotOverlay.addEventListener('click', closeSnapshotDialog);
    if (snapshotCopy) snapshotCopy.addEventListener('click', copyActiveSnapshot);
    if (snapshotDownload) snapshotDownload.addEventListener('click', downloadActiveSnapshot);
    if (snapshotShare) snapshotShare.addEventListener('click', shareActiveSnapshot);

    loadTldSettings();
    form.addEventListener('submit', e => { e.preventDefault(); doSearch(); });
    tldToggleButtons.forEach(button => button.addEventListener('click', toggleTldEditor));
    $('#tldReset').addEventListener('click', resetTlds);
    tldTextarea.addEventListener('input', () => {
      saveTlds();
      updateTldUi();
    });
    tldTextarea.addEventListener('input', clearFormError);
    panelClose.addEventListener('click', () => closePanel(true));
    panelOverlay.addEventListener('click', closePanel);
    $('#errorDismiss').addEventListener('click', () => setState('idle'));
    input.addEventListener('input', () => {
      if (clearBtn) clearBtn.hidden = !input.value;
      clearFormError();
    });
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        input.value = '';
        clearBtn.hidden = true;
        clearFormError();
        input.focus();
      });
    }
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && snapshotDialog && snapshotDialog.classList.contains('open')) {
        closeSnapshotDialog();
        return;
      }
      if (e.key === 'Escape' && panel.classList.contains('open')) closePanel();
    });

    var q = new URLSearchParams(location.search).get('q');
    if (q) {
      input.value = q;
      if (clearBtn) clearBtn.hidden = false;
      doSearch();
    }
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
    updateTldUi();
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
    updateTldUi();
  }

  function getTlds() {
    const lines = tldTextarea.value.split(/[\n,]+/).map(s => s.trim().replace(/^\./, '').toLowerCase()).filter(Boolean);
    return lines.length > 0 ? [...new Set(lines)] : DEFAULT_TLDS;
  }

  function toggleTldEditor() {
    setTldEditorOpen(tldEditor.hidden);
  }

  function setTldEditorOpen(open) {
    tldEditor.hidden = !open;
    tldEditor.classList.toggle('open', open);
    tldToggleButtons.forEach(button => {
      button.setAttribute('aria-expanded', String(open));
      button.textContent = open ? T('tldToggleHide') : T('tldToggle');
    });
    if (open) {
      autoResize(tldTextarea);
      tldEditor.style.maxHeight = tldEditor.scrollHeight + 'px';
    } else {
      tldEditor.style.maxHeight = '0px';
    }
  }

  function getTldStats() {
    const rawLines = tldTextarea.value.split(/\n/).map(s => s.trim()).filter(Boolean);
    const normalized = rawLines.map(s => s.replace(/^\./, '').toLowerCase()).filter(Boolean);
    const unique = [...new Set(normalized)];
    const invalid = unique.filter(tld => !isValidTld(tld)).length;
    return { rawLines, unique, invalid };
  }

  function updateTldUi() {
    const stats = getTldStats();
    const tlds = stats.unique.length ? stats.unique : DEFAULT_TLDS;
    if (lineCount) lineCount.textContent = String(stats.rawLines.length || DEFAULT_TLDS.length);
    if (uniqueCount) uniqueCount.textContent = String(tlds.length);
    if (invalidCount) invalidCount.textContent = String(stats.invalid);
    suffixChips.forEach((chip, index) => {
      if (!chip) return;
      chip.hidden = !tlds[index];
      if (tlds[index]) chip.textContent = '.' + tlds[index];
    });
    if (suffixMore) {
      suffixMore.hidden = tlds.length <= 3;
      suffixMore.textContent = tlds.length > 3 ? '+' + (tlds.length - 3) : '';
    }
    const summary = $('#tldSummary');
    if (summary) summary.textContent = T('selectedTlds').replace('{n}', tlds.length);
    if (!tldEditor.hidden) {
      autoResize(tldTextarea);
      tldEditor.style.maxHeight = tldEditor.scrollHeight + 'px';
    }
  }

  function isValidLabel(s) {
    return s.length > 0 && s.length <= 63 && DOMAIN_LABEL_RE.test(s);
  }

  function isValidTld(s) {
    return s.length > 0 && s.length <= 63 && TLD_RE.test(s);
  }

  function prepareSearch(keyword, tlds) {
    var searchKeyword = keyword;
    var searchTlds = tlds.slice();
    var dotIdx = keyword.lastIndexOf('.');
    if (dotIdx > 0 && /^[a-zA-Z]{2,}$/.test(keyword.substring(dotIdx + 1))) {
      searchKeyword = keyword.substring(0, dotIdx);
      var extraTld = keyword.substring(dotIdx + 1).toLowerCase();
      if (searchTlds.indexOf(extraTld) < 0) {
        searchTlds.unshift(extraTld);
      }
    }
    return { keyword: searchKeyword, tlds: searchTlds };
  }

  function validateSearch(keyword, tlds) {
    if (!keyword) {
      return { message: T('errorEmptyKeyword'), target: input };
    }

    var dotIdx = keyword.lastIndexOf('.');
    var domainLike = dotIdx > 0 && /^[a-zA-Z]{2,}$/.test(keyword.substring(dotIdx + 1));
    var label = domainLike ? keyword.substring(0, dotIdx) : keyword;
    if (!isValidLabel(label)) {
      return { message: T('errorInvalidKeyword'), target: input };
    }

    for (var i = 0; i < tlds.length; i++) {
      if (!isValidTld(tlds[i])) {
        return { message: T('errorInvalidTld').replace('{tld}', tlds[i]), target: tldTextarea };
      }
    }

    return null;
  }

  function showFormError(msg, target) {
    formError.textContent = msg;
    formError.hidden = false;
    input.setAttribute('aria-invalid', target === input ? 'true' : 'false');
    tldTextarea.setAttribute('aria-invalid', target === tldTextarea ? 'true' : 'false');
    if (target === tldTextarea && tldEditor.hidden) {
      setTldEditorOpen(true);
    }
    target.focus();
  }

  function clearFormError() {
    formError.textContent = '';
    formError.hidden = true;
    input.removeAttribute('aria-invalid');
    tldTextarea.removeAttribute('aria-invalid');
  }

  function doSearch() {
    const raw = input.value;
    const keyword = raw.replace(/[\s\u3000]+/g, '');
    const tlds = getTlds();
    const validation = validateSearch(keyword, tlds);
    if (validation) {
      showFormError(validation.message, validation.target);
      return;
    }

    if (activeSource) { activeSource.close(); activeSource = null; }

    if (!tldEditor.hidden) setTldEditorOpen(false);

    clearFormError();
    allResults = [];
    resultsList.innerHTML = '';
    closePanel(false);

    var prepared = prepareSearch(keyword, tlds);
    var searchKeyword = prepared.keyword;
    var searchTlds = prepared.tlds;
    currentSearchKeyword = searchKeyword;
    currentExpected = searchTlds.length;
    currentReceived = 0;
    if (ledgerTitle) ledgerTitle.textContent = searchKeyword;
    updateStats(0, currentExpected);
    setState('streaming');
    history.replaceState(null, '', (location.pathname === '/' ? '/' : location.pathname) + '?q=' + encodeURIComponent(searchKeyword));

    let url = '/api/search?keyword=' + encodeURIComponent(searchKeyword) + '&stream=true';
    url += '&tlds=' + encodeURIComponent(searchTlds.join(','));

    const totalExpected = searchTlds.length;
    let received = 0;

    const source = new EventSource(url);
    activeSource = source;

    source.addEventListener('message', e => {
      try {
        const result = JSON.parse(e.data);
        allResults.push(result);
        received++;
        currentReceived = received;
        appendRow(result);
        updateStats(received, totalExpected);
        if (loadingText) {
          loadingText.textContent = T('loadingProgress')
            .replace('{received}', received)
            .replace('{total}', totalExpected);
        }
      } catch {}
    });

    source.addEventListener('done', () => {
      source.close();
      activeSource = null;
      renderResults();
      currentReceived = totalExpected;
      updateStats(totalExpected, totalExpected);
      setState('results');
      retryUnknowns();
    });

    source.addEventListener('error', () => {
      source.close();
      activeSource = null;
      if (allResults.length > 0) {
        setState('results');
      } else {
        showError(T('errorSearchFailed'));
      }
    });
  }

  function setState(state) {
    app.classList.toggle('idle', state === 'idle');
    const streaming = state === 'streaming';
    resultsSection.hidden = !(state === 'results' || streaming);
    if (loadingSection) loadingSection.hidden = true;
    errorSection.hidden = state !== 'error';
    searchBtn.disabled = streaming;
    btnText.textContent = streaming ? T('searchBtnLoading') : T('searchBtn');
    if (btnSpinner) btnSpinner.hidden = true;
    updateSnapshotButton();
    if (!streaming && state !== 'results') {
      progressFill.style.transform = 'scaleX(0)';
      progressCount.textContent = '';
      progressText.textContent = '';
    }
  }

  function showError(msg) {
    clearFormError();
    errorMsg.textContent = msg;
    setState('error');
  }

  function updateStats(received, totalExpected) {
    const expected = totalExpected || currentExpected || allResults.length || DEFAULT_TLDS.length;
    const done = typeof received === 'number' ? received : (currentReceived || allResults.length);
    const c = { available: 0, registered: 0, reserved: 0, unknown: 0 };
    allResults.forEach(r => { if (c[r.status] !== undefined) c[r.status]++; });
    const registered = c.registered || allResults.filter(r => r.status === 'registered').length;
    const complete = done >= expected;
    const template = complete ? T('ledgerStatsComplete') : T('ledgerStatsStreaming');
    statsLine.textContent = template
      .replace('{total}', expected)
      .replace('{received}', done)
      .replace('{available}', c.available)
      .replace('{registered}', registered)
      .replace('{unknown}', c.unknown);
    progressText.textContent = complete ? T('progressComplete') : T('progressStreaming');
    progressCount.textContent = done + '/' + expected;
    const ratio = expected ? Math.max(0.04, Math.min(1, done / expected)) : 0;
    progressFill.style.transform = 'scaleX(' + ratio + ')';
    updateSnapshotButton();
  }

  function updateSnapshotButton() {
    if (!snapshotButton) return;
    const complete = currentReceived >= currentExpected;
    snapshotButton.disabled = allResults.length === 0 || Boolean(activeSource) || !complete;
  }

  function isRecentDate(s) {
    if (!s) return false;
    var d = parseDate(s);
    if (!d) return false;
    var diff = Math.floor((new Date() - d) / 86400000);
    return diff >= 0 && diff <= 6;
  }

  function makeRowOpenable(row, domain) {
    row.classList.add('clickable');
    row.dataset.openable = 'true';
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', T('openDetailsLabel').replace('{domain}', domain));
    row.addEventListener('click', () => openPanel(domain, row));
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPanel(domain, row);
      }
    });
  }

  function buildRow(r) {
    const row = document.createElement('div');
    const recent = r.status === 'registered' && isRecentDate(r.registered);
    const tone = recent ? 'recent' : r.status;
    row.className = 'domain-row ' + tone;
    row.dataset.domain = r.domain;

    const domain = document.createElement('div');
    domain.className = 'domain-name';
    const domainText = document.createElement('span');
    domainText.textContent = r.domain;
    domain.appendChild(domainText);

    if (r.status === 'available') {
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'copy-chip';
      copyBtn.textContent = T('copyBtn');
      copyBtn.setAttribute('aria-label', T('copyDomainLabel').replace('{domain}', r.domain));
      copyBtn.addEventListener('click', e => {
        e.stopPropagation();
        copyDomain(r.domain, copyBtn);
      });
      domain.appendChild(copyBtn);
    } else {
      makeRowOpenable(row, r.domain);
    }

    const resultCell = document.createElement('div');
    resultCell.className = 'result-cell';
    if (r.status === 'available') {
      resultCell.appendChild(buildAvailableActions(r));
    } else {
      resultCell.appendChild(buildResultValue(r, recent));
    }

    row.appendChild(domain);
    row.appendChild(resultCell);
    return row;
  }

  function buildAvailableActions(r) {
    const wrap = document.createElement('div');
    wrap.className = 'available-actions';
    wrap.appendChild(buildResultValue(r, false));

    const options = registrationOptions(r);
    const lowest = lowestRegistrationOption(r);
    const primary = lowest || options[0];
    if (lowest && lowest.registration_usd) {
      const price = document.createElement('span');
      price.className = 'price-chip';
      price.textContent = formatUSD(lowest.registration_usd) + T('pricePerYearShort');
      price.title = T('priceRegistrarTitle')
        .replace('{registrar}', lowest.registrar_name)
        .replace('{date}', lowest.updated_at || '');
      wrap.appendChild(price);
    }
    if (primary && primary.register_url) {
      const register = document.createElement('a');
      register.className = 'register-link';
      register.href = primary.register_url;
      register.target = '_blank';
      register.rel = optionRel(primary);
      register.textContent = T('registerBtn');
      register.setAttribute('aria-label', T('registerDomainLabel')
        .replace('{domain}', r.domain)
        .replace('{registrar}', primary.registrar_name));
      register.addEventListener('click', e => e.stopPropagation());
      wrap.appendChild(register);
    }
    if (options.length > 1) {
      const compare = document.createElement('button');
      compare.type = 'button';
      compare.className = 'compare-chip';
      compare.textContent = T('compareBtn');
      compare.setAttribute('aria-label', T('compareRegistrarsLabel').replace('{domain}', r.domain));
      compare.addEventListener('click', e => {
        e.stopPropagation();
        openPanel(r.domain, compare.closest('.domain-row') || compare, compare);
      });
      wrap.appendChild(compare);
    }
    return wrap;
  }

  function buildResultValue(r, recent) {
    const value = document.createElement('span');
    value.className = 'result-value ';
    if (r.status === 'available') {
      value.className += 'available';
      value.textContent = T('tagAvailable');
    } else if (r.status === 'reserved') {
      value.className += 'reserved';
      value.textContent = T('tagReserved');
    } else if (r.status === 'unknown') {
      value.className += 'unknown';
      value.textContent = T('tagUnknown');
    } else if (recent) {
      value.className += 'fresh';
      value.textContent = shortDate(r.registered);
    } else {
      value.className += 'registered';
      value.textContent = r.registered ? formatDate(r.registered) : T('tagRegistered');
    }
    return value;
  }

  function renderResults() {
    resultsList.innerHTML = '';
    sortedResults().forEach(function(r) { resultsList.appendChild(buildRow(r)); });
    updateSnapshotButton();
  }

  function sortedResults() {
    var available = [], recent = [], registered = [], reserved = [], unknown = [];
    allResults.forEach(function(r) {
      if (r.status === 'available') available.push(r);
      else if (r.status === 'registered' && isRecentDate(r.registered)) recent.push(r);
      else if (r.status === 'registered') registered.push(r);
      else if (r.status === 'reserved') reserved.push(r);
      else unknown.push(r);
    });
    return available.concat(recent, registered, reserved, unknown);
  }

  function retryUnknowns() {
    var unknowns = allResults.filter(function(r) { return r.status === 'unknown'; });
    if (!unknowns.length) return;
    unknowns.forEach(function(r) {
      fetch('/api/whois/' + encodeURIComponent(r.domain))
        .then(function(res) { if (!res.ok) throw new Error(); return res.json(); })
        .then(function(data) {
          if (data.status === 'unknown') return;
          var idx = allResults.findIndex(function(x) { return x.domain === r.domain; });
          if (idx === -1) return;
          allResults[idx] = data;
          renderResults();
          updateStats();
        })
        .catch(function() {});
    });
  }

  function appendRow(r) {
    resultsList.appendChild(buildRow(r));
    updateSnapshotButton();
  }

  function copyDomain(domain, btn) {
    navigator.clipboard.writeText(domain).then(() => {
      btn.textContent = T('copiedBtn');
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = T('copyBtn');
        btn.classList.remove('copied');
      }, 650);
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
      }, 650);
    });
  }

  async function createResultSnapshot() {
    if (!snapshotButton || !allResults.length) return;
    snapshotButton.disabled = true;
    snapshotButton.textContent = T('snapshotWorking');
    try {
      const canvas = renderSnapshotCanvas();
      const blob = await canvasToBlob(canvas);
      if (!blob) throw new Error('snapshot failed');
      openSnapshotDialog(blob);
    } catch (_) {
      showSnapshotStatus(T('snapshotFailed'), true);
    }
    snapshotButton.textContent = T('snapshotBtn');
    updateSnapshotButton();
  }

  function openSnapshotDialog(blob) {
    if (!snapshotDialog || !snapshotPreview) return;
    cleanupSnapshotPreview();
    activeSnapshotBlob = blob;
    activeSnapshotFileName = snapshotFileName();
    activeSnapshotUrl = URL.createObjectURL(blob);
    snapshotReturnFocus = document.activeElement;
    const img = document.createElement('img');
    img.src = activeSnapshotUrl;
    img.alt = T('snapshotPreviewLabel');
    img.decoding = 'async';
    snapshotPreview.appendChild(img);
    if (snapshotStatus) snapshotStatus.textContent = '';
    updateSnapshotActions();
    snapshotDialog.hidden = false;
    snapshotDialog.classList.add('open');
    snapshotDialog.setAttribute('aria-hidden', 'false');
    snapshotDialog.inert = false;
    snapshotOverlay.hidden = false;
    requestAnimationFrame(() => snapshotOverlay.classList.add('open'));
    if (snapshotCopy) snapshotCopy.focus({ preventScroll: true });
  }

  function closeSnapshotDialog() {
    if (!snapshotDialog) return;
    snapshotDialog.classList.remove('open');
    snapshotDialog.setAttribute('aria-hidden', 'true');
    snapshotDialog.inert = true;
    if (snapshotOverlay) snapshotOverlay.classList.remove('open');
    setTimeout(() => {
      snapshotDialog.hidden = true;
      if (snapshotOverlay) snapshotOverlay.hidden = true;
      cleanupSnapshotPreview();
    }, 120);
    activeSnapshotBlob = null;
    activeSnapshotFileName = '';
    if (snapshotReturnFocus && document.body.contains(snapshotReturnFocus)) {
      snapshotReturnFocus.focus({ preventScroll: true });
    }
    snapshotReturnFocus = null;
  }

  function cleanupSnapshotPreview() {
    if (snapshotPreview) snapshotPreview.innerHTML = '';
    if (activeSnapshotUrl) {
      URL.revokeObjectURL(activeSnapshotUrl);
      activeSnapshotUrl = '';
    }
  }

  function updateSnapshotActions() {
    const hasBlob = Boolean(activeSnapshotBlob);
    if (snapshotCopy) snapshotCopy.disabled = !hasBlob || !canCopyImage();
    if (snapshotDownload) snapshotDownload.disabled = !hasBlob;
    if (snapshotShare) snapshotShare.disabled = !hasBlob || !canShareSnapshot(activeSnapshotBlob);
  }

  async function copyActiveSnapshot() {
    if (!activeSnapshotBlob) return;
    setSnapshotButtonWorking(snapshotCopy, T('snapshotWorking'));
    const copied = await copySnapshotBlob(activeSnapshotBlob);
    if (copied) {
      setSnapshotButtonDone(snapshotCopy, T('snapshotCopied'), T('snapshotCopyImage'));
      showSnapshotStatus(T('snapshotCopiedStatus'), false);
    } else {
      setSnapshotButtonDone(snapshotCopy, T('snapshotCopyFailed'), T('snapshotCopyImage'));
      showSnapshotStatus(T('snapshotCopyUnavailable'), true);
    }
  }

  function downloadActiveSnapshot() {
    if (!activeSnapshotBlob) return;
    downloadSnapshotBlob(activeSnapshotBlob);
    setSnapshotButtonDone(snapshotDownload, T('snapshotSaved'), T('snapshotDownload'));
    showSnapshotStatus(T('snapshotSavedStatus'), false);
  }

  async function shareActiveSnapshot() {
    if (!activeSnapshotBlob) return;
    const file = snapshotFile(activeSnapshotBlob);
    if (!navigator.share || !navigator.canShare || !navigator.canShare({ files: [file] })) {
      showSnapshotStatus(T('snapshotShareUnavailable'), true);
      return;
    }
    setSnapshotButtonWorking(snapshotShare, T('snapshotWorking'));
    try {
      await navigator.share({
        files: [file],
        title: T('snapshotTitle'),
        text: T('snapshotShareText')
      });
      setSnapshotButtonDone(snapshotShare, T('snapshotShared'), T('snapshotShare'));
      showSnapshotStatus(T('snapshotSharedStatus'), false);
    } catch (_) {
      snapshotShare.textContent = T('snapshotShare');
      showSnapshotStatus(T('snapshotShareCancelled'), true);
    }
  }

  function setSnapshotButtonWorking(button, label) {
    if (!button) return;
    button.disabled = true;
    button.textContent = label;
  }

  function setSnapshotButtonDone(button, label, resetLabel) {
    if (!button) return;
    button.textContent = label;
    setTimeout(() => {
      button.textContent = resetLabel;
      updateSnapshotActions();
    }, 900);
  }

  function showSnapshotStatus(message, isError) {
    if (!snapshotStatus) return;
    snapshotStatus.textContent = message || '';
    snapshotStatus.classList.toggle('error', Boolean(isError));
  }

  function renderSnapshotCanvas() {
    const rows = sortedResults();
    const stats = getSnapshotStats(rows);
    const visibleRows = rows.slice(0, 40);
    const hiddenRows = Math.max(0, rows.length - visibleRows.length);
    const width = 560;
    const pad = 28;
    const headerH = 102;
    const rowH = 38;
    const footerH = 50;
    const height = headerH + (visibleRows.length + (hiddenRows ? 1 : 0)) * rowH + footerH;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement('canvas');
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = '100%';
    canvas.style.maxWidth = width + 'px';
    canvas.style.height = 'auto';
    const ctx = canvas.getContext('2d');
    const pal = snapshotPalette();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, width, height);

    fillRoundRect(ctx, 12, 12, width - 24, height - 24, 8, pal.card);
    ctx.strokeStyle = pal.border;
    ctx.lineWidth = 1;
    strokeRoundRect(ctx, 12.5, 12.5, width - 25, height - 25, 8);

    ctx.fillStyle = pal.ink;
    ctx.font = '620 30px ' + sansFont();
    drawFit(ctx, currentSearchKeyword || 'dmcheck', pad, 54, width - pad * 2);

    ctx.fillStyle = pal.muted;
    ctx.font = '460 13px ' + sansFont();
    drawFit(ctx, snapshotSummaryText(stats), pad, 82, width - pad * 2);

    ctx.strokeStyle = pal.border;
    ctx.beginPath();
    ctx.moveTo(pad, headerH);
    ctx.lineTo(width - pad, headerH);
    ctx.stroke();

    let y = headerH;
    visibleRows.forEach((row, index) => {
      drawSnapshotRow(ctx, row, index, pad, y, width - pad * 2, rowH, pal);
      y += rowH;
    });
    if (hiddenRows) {
      ctx.fillStyle = pal.muted;
      ctx.font = '520 13px ' + sansFont();
      drawFit(ctx, T('snapshotMore').replace('{n}', hiddenRows), pad + 10, y + 24, width - pad * 2);
      y += rowH;
    }

    ctx.strokeStyle = pal.border;
    ctx.beginPath();
    ctx.moveTo(pad, height - 40);
    ctx.lineTo(width - pad, height - 40);
    ctx.stroke();

    ctx.fillStyle = pal.faint;
    ctx.font = '460 12px ' + sansFont();
    drawFit(ctx, T('snapshotFooter'), pad, height - 20, width - pad * 2 - 190);
    ctx.textAlign = 'right';
    ctx.font = '460 12px ' + sansFont();
    drawFit(ctx, T('snapshotChecked').replace('{time}', snapshotTime()), width - pad, height - 20, 190);
    ctx.textAlign = 'left';
    return canvas;
  }

  function drawSnapshotRow(ctx, r, index, x, y, w, h, pal) {
    const tone = snapshotTone(r);
    if (index % 2 === 1) {
      ctx.fillStyle = pal.rowAlt;
      fillRoundRect(ctx, x - 8, y + 4, w + 16, h - 8, 5, pal.rowAlt);
    }

    ctx.fillStyle = tone.color;
    fillRoundRect(ctx, x, y + 15, 4, 8, 2, tone.color);

    const result = snapshotResultText(r);
    ctx.font = tone.plain ? '500 13px ' + monoFont() : '560 12px ' + sansFont();
    const resultW = Math.min(150, Math.ceil(ctx.measureText(result).width) + (tone.plain ? 0 : 20));
    const resultX = x + w - resultW;

    ctx.fillStyle = pal.ink;
    ctx.font = '500 15px ' + monoFont();
    drawFit(ctx, r.domain, x + 14, y + 24, w - resultW - 26);

    if (tone.plain) {
      ctx.textAlign = 'right';
      ctx.fillStyle = pal.ink;
      ctx.font = '500 13px ' + monoFont();
      ctx.fillText(result, x + w, y + 24);
      ctx.textAlign = 'left';
    } else {
      fillRoundRect(ctx, resultX, y + 7, resultW, 24, 12, tone.bg);
      ctx.strokeStyle = tone.border;
      strokeRoundRect(ctx, resultX + .5, y + 7.5, resultW - 1, 23, 12);
      ctx.textAlign = 'center';
      ctx.fillStyle = tone.color;
      ctx.font = '560 12px ' + sansFont();
      ctx.fillText(result, resultX + resultW / 2, y + 23);
      ctx.textAlign = 'left';
    }

    ctx.strokeStyle = pal.borderSoft;
    ctx.beginPath();
    ctx.moveTo(x, y + h - .5);
    ctx.lineTo(x + w, y + h - .5);
    ctx.stroke();
  }

  function snapshotResultText(r) {
    const recent = r.status === 'registered' && isRecentDate(r.registered);
    if (r.status === 'available') {
      const lowest = lowestRegistrationOption(r);
      return lowest && lowest.registration_usd ? formatUSD(lowest.registration_usd) + T('pricePerYearShort') : T('tagAvailable');
    }
    if (r.status === 'reserved') return T('tagReserved');
    if (r.status === 'unknown') return T('tagUnknown');
    if (recent) return shortDate(r.registered);
    return r.registered ? formatDate(r.registered) : T('tagRegistered');
  }

  function snapshotTone(r) {
    const pal = snapshotPalette();
    const recent = r.status === 'registered' && isRecentDate(r.registered);
    if (r.status === 'available') return { color: pal.green, bg: pal.greenSoft, border: pal.greenBorder };
    if (r.status === 'reserved') return { color: pal.reserved, bg: pal.reservedSoft, border: pal.reservedBorder };
    if (r.status === 'unknown') return { color: pal.muted, bg: pal.mutedSoft, border: pal.border };
    if (recent) return { color: pal.amber, bg: pal.amberSoft, border: pal.amberBorder };
    return { color: pal.ink, plain: true };
  }

  function getSnapshotStats(rows) {
    const stats = { total: rows.length, available: 0, registered: 0, reserved: 0, unknown: 0 };
    rows.forEach(r => {
      if (stats[r.status] !== undefined) stats[r.status]++;
    });
    return stats;
  }

  function snapshotSummaryText(stats) {
    const parts = [T('snapshotTotalCount').replace('{n}', stats.total)];
    if (stats.available > 0) parts.push(T('snapshotAvailableCount').replace('{n}', stats.available));
    if (stats.registered > 0) parts.push(T('snapshotRegisteredCount').replace('{n}', stats.registered));
    if (stats.reserved > 0) parts.push(T('snapshotReservedCount').replace('{n}', stats.reserved));
    if (stats.unknown > 0) parts.push(T('snapshotUnknownCount').replace('{n}', stats.unknown));
    return parts.join(T('snapshotSep'));
  }

  function snapshotPalette() {
    if (currentTheme === 'carbon') {
      return {
        bg: '#111719',
        card: '#1d2527',
        rowAlt: '#222b2e',
        ink: '#e9eff0',
        muted: '#a9b4b8',
        brand: '#7f8b90',
        faint: '#748086',
        border: '#455256',
        borderSoft: '#303b3f',
        green: '#89e6aa',
        greenSoft: '#20372b',
        greenBorder: '#44765a',
        amber: '#e6ba5d',
        amberSoft: '#3a301d',
        amberBorder: '#79602b',
        reserved: '#e09271',
        reservedSoft: '#3c2b24',
        reservedBorder: '#7b5443',
        mutedSoft: '#283134'
      };
    }
    return {
      bg: '#f3f5f5',
      card: '#fbfcfc',
      rowAlt: '#f4f7f7',
      ink: '#1f2a33',
      muted: '#62707a',
      brand: '#8a959b',
      faint: '#98a2a7',
      border: '#d7dddf',
      borderSoft: '#e7ebec',
      green: '#168957',
      greenSoft: '#e5f6ec',
      greenBorder: '#98d6b6',
      amber: '#9a6a10',
      amberSoft: '#f6efd9',
      amberBorder: '#dcc179',
      reserved: '#9a553b',
      reservedSoft: '#f5e7e0',
      reservedBorder: '#d8ad9a',
      mutedSoft: '#eef1f2'
    };
  }

  function canvasToBlob(canvas) {
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }

  async function copySnapshotBlob(blob) {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') return false;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    } catch (_) {
      return false;
    }
  }

  function canCopyImage() {
    return Boolean(navigator.clipboard && typeof ClipboardItem !== 'undefined');
  }

  function canShareSnapshot(blob) {
    if (!blob || !navigator.share || !navigator.canShare || typeof File === 'undefined') return false;
    try {
      return navigator.canShare({ files: [snapshotFile(blob)] });
    } catch (_) {
      return false;
    }
  }

  function snapshotFile(blob) {
    return new File([blob], activeSnapshotFileName || snapshotFileName(), { type: 'image/png' });
  }

  function downloadSnapshotBlob(blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeSnapshotFileName || snapshotFileName();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function snapshotFileName() {
    const base = (currentSearchKeyword || 'domains').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'domains';
    return 'dmcheck-' + base + '.png';
  }

  function snapshotTime() {
    return new Date().toLocaleString(localeCode(), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      hourCycle: 'h23'
    }).replace(',', '');
  }

  function localeCode() {
    return { en: 'en-US', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', es: 'es-ES' }[currentLang] || 'en-US';
  }

  function drawFit(ctx, text, x, y, maxWidth) {
    const out = ellipsize(ctx, String(text || ''), maxWidth);
    ctx.fillText(out, x, y);
  }

  function ellipsize(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ctx.measureText(text.slice(0, mid) + '...').width <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return text.slice(0, lo) + '...';
  }

  function fillRoundRect(ctx, x, y, w, h, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    roundedPath(ctx, x, y, w, h, r);
    ctx.fill();
  }

  function strokeRoundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    roundedPath(ctx, x, y, w, h, r);
    ctx.stroke();
  }

  function roundedPath(ctx, x, y, w, h, r) {
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    const radius = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function sansFont() {
    return '"Aptos", "Avenir Next", "Segoe UI", "Noto Sans", system-ui, sans-serif';
  }

  function monoFont() {
    return '"SF Mono", "Cascadia Code", "Roboto Mono", ui-monospace, monospace';
  }

  function openPanel(domain, row, restoreTarget) {
    const seq = ++panelRequestSeq;
    if (activeRow) {
      activeRow.classList.remove('active');
      activeRow.removeAttribute('aria-current');
    }
    activeRow = row;
    panelRestoreTarget = restoreTarget || row;
    row.classList.add('active');
    row.setAttribute('aria-current', 'true');

    panelTitle.textContent = domain;
    if (panelSubtitle) panelSubtitle.textContent = T('panelCachedPreview');
    panelBody.innerHTML = '<p class="panel-status-hint" style="opacity:0.5">' + esc(T('panelLoading')) + '</p>';
    panel.hidden = false;
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    panel.inert = false;
    panelOverlay.hidden = false;
    requestAnimationFrame(() => panelOverlay.classList.add('open'));
    panelClose.focus({ preventScroll: true });

    const localPreview = allResults.find(r => r.domain === domain);
    if (localPreview) renderPanelPreview(localPreview);

    fetch('/api/whois/' + encodeURIComponent(domain) + '?preview=true')
      .then(res => {
        if (res.status === 204) return null;
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(data => {
        if (seq !== panelRequestSeq || !data) return;
        renderPanelPreview(data);
      })
      .catch(() => {});

    fetch('/api/whois/' + encodeURIComponent(domain))
      .then(res => { if (!res.ok) throw new Error(); return res.json(); })
      .then(data => {
        if (seq !== panelRequestSeq) return;
        if (panelSubtitle) panelSubtitle.textContent = T('panelLiveDetails');
        renderPanel(data);
      })
      .catch(() => {
        if (seq !== panelRequestSeq) return;
        panelBody.innerHTML = '<p class="panel-status-hint" style="color:var(--c-red)">' + esc(T('panelLoadFail')) + '</p>';
      });
  }

  function closePanel(restoreFocus) {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    panel.inert = true;
    panelOverlay.classList.remove('open');
    setTimeout(() => {
      panel.hidden = true;
      panelOverlay.hidden = true;
    }, 140);
    if (activeRow) {
      var row = activeRow;
      var restoreTarget = panelRestoreTarget;
      row.classList.remove('active');
      row.removeAttribute('aria-current');
      activeRow = null;
      panelRestoreTarget = null;
      if (restoreFocus !== false && restoreTarget && document.body.contains(restoreTarget)) {
        restoreTarget.focus({ preventScroll: true });
      }
    }
    panelRequestSeq++;
  }

  function renderPanelPreview(data) {
    let html = '<p class="panel-status-hint" style="opacity:0.55">' + esc(T('panelLoadingDetails')) + '</p>';

    if (data.status === 'available') {
      html += '<p class="panel-status-hint" style="color:var(--c-green)">' + esc(T('panelAvailable')) + '</p>';
      html += registrationPanelHtml(data);
      panelBody.innerHTML = html;
      return;
    }

    if (data.status === 'reserved') {
      html += '<p class="panel-status-hint" style="color:var(--c-orange)">' + esc(T('panelReserved')) + '</p>';
      panelBody.innerHTML = html;
      return;
    }

    if (data.status === 'unknown') {
      html += '<p class="panel-status-hint">' + esc(T('panelUnknown')) + '</p>';
      panelBody.innerHTML = html;
      return;
    }

    html += '<p class="panel-section-title">' + esc(T('sectionBasic')) + '</p>';
    html += '<div class="info-grid">';
    if (data.registered) html += infoRow(T('labelRegistered'), formatDate(data.registered));
    html += '</div>';
    panelBody.innerHTML = html;
  }

  function renderPanel(data) {
    let html = '';

    if (data.status === 'available') {
      html += '<p class="panel-status-hint" style="color:var(--c-green)">' + esc(T('panelAvailable')) + '</p>';
      html += registrationPanelHtml(data);
      panelBody.innerHTML = html;
      return;
    }

    if (data.status === 'reserved') {
      html += '<p class="panel-status-hint" style="color:var(--c-orange)">' + esc(T('panelReserved')) + '</p>';
      if (data.raw_whois) {
        html += '<p class="panel-section-title">' + esc(T('sectionRawWhois')) + '</p>' +
          '<pre class="raw-whois-pre">' + esc(data.raw_whois) + '</pre>';
      }
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
    html += '<div class="preview-placeholder">' +
        '<p class="preview-placeholder-title">' + esc(T('previewPlaceholderTitle')) + '</p>' +
        '<p class="preview-placeholder-text">' + esc(T('previewPlaceholderText')) + '</p>' +
        '<button type="button" class="preview-load-btn">' + esc(T('loadPreviewBtn')) + '</button>' +
      '</div>' +
      '<div class="preview-site-link">' +
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
    bindPanelPreview(data.domain);
  }

  function bindPanelPreview(domain) {
    const btn = panelBody.querySelector('.preview-load-btn');
    if (!btn) return;
    btn.addEventListener('click', () => loadPreview(domain));
  }

  function loadPreview(domain) {
    const wrap = panelBody.querySelector('.preview-placeholder');
    if (!wrap) return;
    wrap.className = 'preview-shot-wrap preview-shot-loading';
    wrap.innerHTML = '<p class="panel-status-hint">' + esc(T('previewLoading')) + '</p>';
    loadPanelFavicon(domain);

    const img = document.createElement('img');
    img.className = 'preview-shot';
    img.alt = T('screenshotAlt');
    img.loading = 'lazy';
    img.addEventListener('load', () => {
      wrap.className = 'preview-shot-wrap';
      wrap.innerHTML = '';
      wrap.appendChild(img);
    });
    img.addEventListener('error', () => {
      wrap.className = 'preview-placeholder preview-placeholder-error';
      wrap.innerHTML = '<p class="preview-placeholder-title">' + esc(T('previewLoadFail')) + '</p>';
    });
    img.src = 'https://screenshot.domains/' + encodeURIComponent(domain);
  }

  function loadPanelFavicon(domain) {
    const siteLink = panelBody.querySelector('.preview-site-link');
    if (!siteLink || siteLink.querySelector('.preview-favicon')) return;
    const img = document.createElement('img');
    img.className = 'preview-favicon';
    img.alt = '';
    img.loading = 'lazy';
    img.src = 'https://favicon.im/' + encodeURIComponent(domain);
    siteLink.prepend(img);
  }

  function infoRow(label, value) {
    return '<span class="info-label">' + esc(label) + '</span><span class="info-value">' + value + '</span>';
  }

  function registrationPanelHtml(data) {
    const options = registrationOptions(data);
    let html = '<p class="panel-section-title">' + esc(T('sectionRegistrationOptions')) + '</p>';
    if (!options.length) {
      return html + '<p class="panel-status-hint">' + esc(T('registrationNoPrices')) + '</p>';
    }
    html += '<div class="registrar-list">';
    options.forEach(option => {
      const hasPrice = Boolean(option.registration_usd);
      const priceText = hasPrice ? formatUSD(option.registration_usd) + T('pricePerYearShort') : T('priceUnavailable');
      const renewText = option.renewal_usd ? T('renewalPrice').replace('{price}', formatUSD(option.renewal_usd)) : T('renewalUnknown');
      const source = option.source_url ? '<a href="' + esc(option.source_url) + '" target="_blank" rel="noopener noreferrer">' + esc(T('priceSource')) + '</a>' : '';
      html += '<div class="registrar-option' + (option.is_lowest ? ' lowest' : '') + '">' +
        '<div class="registrar-main">' +
          '<strong>' + esc(option.registrar_name) + '</strong>' +
          (option.is_lowest ? '<span class="lowest-mark">' + esc(T('lowestPrice')) + '</span>' : '') +
        '</div>' +
        '<div class="registrar-price">' + esc(priceText) + '</div>' +
        '<div class="registrar-meta">' + esc(renewText) + (source ? ' · ' + source : '') + '</div>' +
        '<a class="registrar-register" href="' + esc(option.register_url) + '" target="_blank" rel="' + esc(optionRel(option)) + '">' +
          esc(T('registerAt').replace('{registrar}', option.registrar_name)) +
        '</a>' +
      '</div>';
    });
    html += '</div>';
    const updated = options.find(option => option.updated_at);
    if (updated) {
      html += '<p class="price-disclaimer">' + esc(T('priceDisclaimer').replace('{date}', updated.updated_at)) + '</p>';
    }
    return html;
  }

  function registrationOptions(data) {
    return Array.isArray(data && data.registration_options) ? data.registration_options : [];
  }

  function lowestRegistrationOption(data) {
    return registrationOptions(data).find(option => option.is_lowest) || null;
  }

  function formatUSD(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '';
    return '$' + n.toFixed(2);
  }

  function optionRel(option) {
    return option && option.sponsored ? 'noopener noreferrer sponsored' : 'noopener noreferrer';
  }

  function formatStatusCode(raw) {
    const code = raw.split(/\s/)[0];
    const clean = code.toLowerCase().replace(/[^a-z]/g, '');
    const tKey = STATUS_KEY_MAP[clean];
    const desc = tKey ? T(tKey) : '';
    return '<div class="status-code"><code>' + esc(code) + '</code>' +
      (desc ? '<span class="status-code-desc">' + desc + '</span>' : '') + '</div>';
  }

  function parseDate(s) {
    if (!s) return null;
    var d = new Date(s);
    return isNaN(d) ? null : d;
  }

  function shortDate(s) {
    if (!s) return '';
    var date = parseDate(s);
    if (!date) return s.substring(0, 7);
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var diff = Math.floor((today - target) / 86400000);
    if (diff === 0) return T('dateToday');
    if (diff === 1) return T('dateYesterday');
    if (diff >= 2 && diff <= 6) return T('dateDaysAgo').replace('{n}', diff);
    return formatDate(s);
  }

  function formatDate(s) {
    if (!s) return '-';
    var d = parseDate(s);
    if (!d) return s.substring(0, 10);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  init();
})();
