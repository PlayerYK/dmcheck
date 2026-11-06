#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'registrar-prices.json');

const SOURCES = {
  porkbun: 'https://porkbun.com/products/domains/',
  dynadot: 'https://www.dynadot.com/domain/prices',
  cloudflare: 'https://pricing.registrar.cloudflare.com/',
  ovhcloud: 'https://www.ovhcloud.com/en/domains/tld/',
};

const PRICE_FIELD_ORDER = ['registration_usd', 'renewal_usd', 'source_url'];

function parseArgs(argv) {
  const options = {
    config: DEFAULT_CONFIG_PATH,
    date: new Date().toISOString().slice(0, 10),
    dryRun: false,
  };

  for (const arg of argv) {
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg.startsWith('--date=')) {
      options.date = arg.slice('--date='.length);
      continue;
    }
    if (arg.startsWith('--config=')) {
      options.config = path.resolve(arg.slice('--config='.length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    throw new Error(`--date must be YYYY-MM-DD, got ${options.date}`);
  }

  return options;
}

async function fetchText(url, extraHeaders = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      headers: {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'user-agent': 'dmcheck-price-updater/1.0 (+https://dmcheck.app)',
        ...extraHeaders,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeTLD(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
}

function toUSD(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }
  return Math.round(amount * 100) / 100;
}

function centsToUSD(value) {
  return toUSD(Number(value) / 100);
}

function parsePrice(value) {
  if (value === undefined || value === null) {
    return 0;
  }
  const raw = String(value).trim();
  const match = raw.match(/^\$?\s*([0-9]+(?:\.[0-9]+)?)\s*$/);
  return match ? toUSD(match[1]) : 0;
}

function attr(tag, name) {
  const pattern = new RegExp(`${name}=["']([^"']+)["']`, 'i');
  return tag.match(pattern)?.[1] || '';
}

function parsePorkbun(html) {
  const prices = [];
  const seen = new Set();
  for (const match of html.matchAll(/<[a-z][^>]*\bdata-extension=["'][^"']+["'][^>]*>/gi)) {
    const tag = match[0];
    const tld = normalizeTLD(attr(tag, 'data-extension'));
    const registrationUSD = centsToUSD(attr(tag, 'data-price-registration'));
    const renewalUSD = centsToUSD(attr(tag, 'data-price-renewal'));
    if (!tld || !registrationUSD || seen.has(tld)) {
      continue;
    }
    seen.add(tld);
    prices.push({
      tld,
      registration_usd: registrationUSD,
      renewal_usd: renewalUSD || undefined,
    });
  }
  return prices;
}

function extractJsonLd(html) {
  const scripts = [];
  const scriptPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    const json = match[1].trim();
    if (!json) {
      continue;
    }
    try {
      scripts.push(JSON.parse(json));
    } catch (error) {
      console.warn(`Skipping invalid JSON-LD block: ${error.message}`);
    }
  }
  return scripts;
}

function walkJson(value, visit) {
  if (!value || typeof value !== 'object') {
    return;
  }
  visit(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      walkJson(item, visit);
    }
    return;
  }
  for (const item of Object.values(value)) {
    walkJson(item, visit);
  }
}

function createNuxtResolver(store) {
  const resolving = new Set();
  const resolve = (value) => {
    if (typeof value !== 'number') {
      return value;
    }
    if (!Number.isInteger(value) || value < 0 || value >= store.length) {
      return value;
    }
    if (resolving.has(value)) {
      return undefined;
    }

    const raw = store[value];
    if (raw === null || raw === undefined || typeof raw !== 'object') {
      return raw;
    }

    resolving.add(value);
    let out;
    if (Array.isArray(raw)) {
      out = raw.map((item) => resolve(item));
    } else {
      out = {};
      for (const [key, item] of Object.entries(raw)) {
        out[key] = resolve(item);
      }
    }
    resolving.delete(value);
    return out;
  };
  return resolve;
}

function parseDynadotNuxt(html) {
  const match = html.match(/<script[^>]+\bid=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) {
    return [];
  }

  let store;
  try {
    store = JSON.parse(match[1]);
  } catch (error) {
    console.warn(`Skipping invalid Dynadot Nuxt data: ${error.message}`);
    return [];
  }
  if (!Array.isArray(store)) {
    return [];
  }

  const resolve = createNuxtResolver(store);
  const datasets = [];
  for (let index = 0; index < store.length; index += 1) {
    const raw = store[index];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.current_tlds === undefined) {
      continue;
    }
    const hydrated = resolve(index);
    if (Array.isArray(hydrated?.current_tlds)) {
      datasets.push(hydrated.current_tlds);
    }
  }

  const rows = datasets.sort((a, b) => b.length - a.length)[0] || [];
  const seen = new Set();
  const prices = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const tld = normalizeTLD(row.name_utf || row.name);
    const registrationUSD = parsePrice(row.reg_price);
    const renewalUSD = parsePrice(row.renew_price);
    if (!tld || !registrationUSD || seen.has(tld)) {
      continue;
    }
    seen.add(tld);
    prices.push({
      tld,
      registration_usd: registrationUSD,
      renewal_usd: renewalUSD || undefined,
    });
  }
  return prices;
}

function parseDynadotJsonLd(html) {
  const byTLD = new Map();
  for (const block of extractJsonLd(html)) {
    walkJson(block, (node) => {
      const type = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
      if (!type.includes('Offer')) {
        return;
      }
      const name = String(node.name || '');
      const nameMatch = name.match(/^\s*\.?(.+?)\s+Domain\s+(Registration|Renewal)\s*$/i);
      if (!nameMatch || String(node.priceCurrency || '').toUpperCase() !== 'USD') {
        return;
      }
      const tld = normalizeTLD(nameMatch[1]);
      const price = toUSD(node.price);
      if (!tld || !price) {
        return;
      }
      const row = byTLD.get(tld) || { tld };
      if (nameMatch[2].toLowerCase() === 'registration') {
        row.registration_usd = price;
      } else {
        row.renewal_usd = price;
      }
      byTLD.set(tld, row);
    });
  }
  return Array.from(byTLD.values()).filter((row) => row.registration_usd);
}

function parseDynadot(html) {
  const nuxtPrices = parseDynadotNuxt(html);
  const jsonLdPrices = parseDynadotJsonLd(html);
  return {
    prices: nuxtPrices.length >= 300 ? nuxtPrices : jsonLdPrices,
    nuxtCount: nuxtPrices.length,
    jsonLdCount: jsonLdPrices.length,
  };
}

function parseDollarCell(cell = '') {
  const amount = cell.replace(/<[^>]+>/g, '').trim();
  const dollars = /^\$\s*(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;
  return dollars.test(amount) ? parsePrice(amount.replaceAll(',', '')) : 0;
}

function parseCloudflare(html) {
  const table = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)]
    .map(([, content]) => content)
    .find((content) => {
      const header = content.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1] || '';
      const columns = [...header.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)]
        .map(([, cell]) => cell.replace(/<[^>]+>/g, '').trim());
      return columns[0] === 'Extension' && columns[1] === 'Registration' && columns[2] === 'Renewal';
    }) || '';

  const parseCell = (cell = '') => {
    // The discounted registration cell hides the struck-through list price from screen readers.
    return parseDollarCell(cell.replace(/<span\b[^>]*\baria-hidden=["']true["'][^>]*>[\s\S]*?<\/span>/gi, ''));
  };

  const prices = new Map();
  for (const [, row] of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const tld = normalizeTLD(row.match(/<th\b[^>]*\bscope=["']row["'][^>]*>\s*(\.[^<]+)<\/th>/i)?.[1]);
    const [registration, renewal] = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
    const registrationUSD = parseCell(registration?.[1]);
    const renewalUSD = parseCell(renewal?.[1]);
    if (tld && registrationUSD && renewalUSD) {
      prices.set(tld, { tld, registration_usd: registrationUSD, renewal_usd: renewalUSD });
    }
  }
  return [...prices.values()];
}

function parseOVHcloud(html) {
  // Other OVHcloud markets can display a dollar sign for a different currency.
  const market = html.match(/\{[^{}]*"page_name"\s*:\s*"domains::prices"[^{}]*\}/)?.[0] || '';
  if (!/"env_currency"\s*:\s*"USD"/.test(market)) {
    throw new Error('OVHcloud pricing page did not confirm USD; refusing to overwrite config');
  }

  const prices = new Map();
  for (const [, row] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const tld = normalizeTLD(row.match(/\bdata-plancode=["']([^"']+)["']/i)?.[1]);
    const registration = row.match(/<td\b[^>]*\bdata-price-type=["']installation["'][^>]*>([\s\S]*?)<\/td>/i)?.[1];
    const renewal = row.match(/<td\b[^>]*\bdata-price-type=["']renew["'][^>]*>([\s\S]*?)<\/td>/i)?.[1];
    const registrationUSD = parseDollarCell(registration);
    const renewalUSD = parseDollarCell(renewal);
    if (tld && registrationUSD && renewalUSD) {
      prices.set(tld, { tld, registration_usd: registrationUSD, renewal_usd: renewalUSD });
    }
  }
  return [...prices.values()];
}

function mergePrice(prices, tld, registrarID, nextRow) {
  if (!prices[tld]) {
    prices[tld] = {};
  }

  const previous = prices[tld][registrarID] || {};
  const merged = {
    ...previous,
    registration_usd: toUSD(nextRow.registration_usd || previous.registration_usd),
  };

  const renewalUSD = toUSD(nextRow.renewal_usd || previous.renewal_usd);
  if (renewalUSD) {
    merged.renewal_usd = renewalUSD;
  } else {
    delete merged.renewal_usd;
  }

  if (nextRow.source_url || previous.source_url) {
    merged.source_url = nextRow.source_url || previous.source_url;
  } else {
    delete merged.source_url;
  }

  if (merged.registration_usd) {
    prices[tld][registrarID] = sortPriceRow(merged);
  }
}

function sortPriceRow(row) {
  const sorted = {};
  for (const key of PRICE_FIELD_ORDER) {
    if (row[key] !== undefined && row[key] !== '') {
      sorted[key] = row[key];
    }
  }
  return sorted;
}

function prunePreviousPrices(prices, retainedRegistrars) {
  const retained = new Set(retainedRegistrars);
  for (const [tld, rows] of Object.entries(prices)) {
    for (const registrarID of Object.keys(rows || {})) {
      if (!retained.has(registrarID)) {
        delete rows[registrarID];
      }
    }
    if (Object.keys(rows || {}).length === 0) {
      delete prices[tld];
    }
  }
}

function sortPrices(prices, registrarOrder) {
  const out = {};
  const tlds = Object.keys(prices).sort((a, b) => a.localeCompare(b));
  for (const tld of tlds) {
    const rows = prices[tld];
    const sortedRows = {};
    const registrarIDs = Object.keys(rows).sort((a, b) => {
      const ai = registrarOrder.indexOf(a);
      const bi = registrarOrder.indexOf(b);
      if (ai !== -1 || bi !== -1) {
        return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
      }
      return a.localeCompare(b);
    });
    for (const registrarID of registrarIDs) {
      sortedRows[registrarID] = sortPriceRow(rows[registrarID]);
    }
    if (Object.keys(sortedRows).length) {
      out[tld] = sortedRows;
    }
  }
  return out;
}

function countByRegistrar(config) {
  const counts = Object.fromEntries((config.registrars || []).map((registrar) => [registrar.id, 0]));
  for (const rows of Object.values(config.prices || {})) {
    for (const registrarID of Object.keys(rows)) {
      counts[registrarID] = (counts[registrarID] || 0) + 1;
    }
  }
  return counts;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = JSON.parse(await fs.readFile(options.config, 'utf8'));

  const [porkbunHTML, dynadotHTML, cloudflareHTML, ovhcloudHTML] = await Promise.all([
    fetchText(SOURCES.porkbun),
    // Dynadot's currency selector stores USD as glbl_curr=0.
    fetchText(SOURCES.dynadot, { cookie: 'glbl_curr=0' }),
    fetchText(SOURCES.cloudflare),
    fetchText(SOURCES.ovhcloud),
  ]);

  const porkbunPrices = parsePorkbun(porkbunHTML);
  const dynadot = parseDynadot(dynadotHTML);
  const dynadotPrices = dynadot.prices;
  const completeSources = [
    { id: 'cloudflare', name: 'Cloudflare', rows: parseCloudflare(cloudflareHTML), minimum: 300 },
    { id: 'ovhcloud', name: 'OVHcloud', rows: parseOVHcloud(ovhcloudHTML), minimum: 600 },
  ];

  if (porkbunPrices.length < 100) {
    throw new Error(`Porkbun source returned only ${porkbunPrices.length} prices; refusing to overwrite config`);
  }
  if (dynadot.nuxtCount < 300) {
    throw new Error(`Dynadot source returned only ${dynadot.nuxtCount} full-table prices; refusing to overwrite config`);
  }
  for (const { name, rows, minimum } of completeSources) {
    if (rows.length < minimum) {
      throw new Error(`${name} source returned only ${rows.length} complete USD price pairs; refusing to overwrite config`);
    }
  }

  config.currency = 'USD';
  config.updated_at = options.date;
  config.prices ||= {};
  // Keep the legacy merge for Porkbun and Dynadot. Rebuild the other price rows from complete pairs.
  prunePreviousPrices(config.prices, ['porkbun', 'dynadot']);

  for (const row of porkbunPrices) {
    mergePrice(config.prices, row.tld, 'porkbun', row);
  }
  for (const row of dynadotPrices) {
    mergePrice(config.prices, row.tld, 'dynadot', {
      ...row,
      source_url: SOURCES.dynadot,
    });
  }
  for (const { id, rows } of completeSources) {
    for (const row of rows) {
      mergePrice(config.prices, row.tld, id, row);
    }
  }

  const registrarOrder = (config.registrars || []).map((registrar) => registrar.id);
  config.prices = sortPrices(config.prices, registrarOrder);

  if (!options.dryRun) {
    await fs.writeFile(options.config, `${JSON.stringify(config, null, 2)}\n`);
  }

  const counts = countByRegistrar(config);
  console.log(`Porkbun prices parsed: ${porkbunPrices.length}`);
  console.log(`Dynadot full-table prices parsed: ${dynadot.nuxtCount}`);
  console.log(`Dynadot JSON-LD fallback offers parsed: ${dynadot.jsonLdCount}`);
  for (const { name, rows } of completeSources) {
    console.log(`${name} complete USD price pairs parsed: ${rows.length}`);
  }
  console.log(`${options.dryRun ? 'Would write' : 'Wrote'} ${path.relative(process.cwd(), options.config)}`);
  console.log(`Total priced TLDs: ${Object.keys(config.prices).length}`);
  console.log(`Registrar coverage: ${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(', ')}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
