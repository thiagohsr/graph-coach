// Loads the built workspace packages the way the built API does (CommonJS require of
// package exports) and prints JSON: which export names several entry points share and
// whether each shared export is the same object everywhere. Run by src/module-format.spec.ts.
'use strict';

const entries = [
  '@coach/graph-kit',
  '@coach/agents/llm',
  '@coach/agents/testing',
  '@coach/agents/coach',
  '@coach/agents/curator',
  '@coach/types',
  '@coach/admin-kit',
];

const modules = {};
const resolved = {};
for (const entry of entries) {
  modules[entry] = require(entry);
  resolved[entry] = require.resolve(entry);
}

const byName = new Map();
for (const entry of entries) {
  for (const [name, value] of Object.entries(modules[entry])) {
    // Classes only: plain functions with the same name may be separate implementations in different packages.
    if (typeof value !== 'function' || !/^class[\s{]/.test(Function.prototype.toString.call(value))) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push({ entry, value });
  }
}

const shared = [];
for (const [name, owners] of byName) {
  if (owners.length < 2) continue;
  shared.push({
    name,
    entries: owners.map((owner) => owner.entry),
    identical: owners.every((owner) => owner.value === owners[0].value),
  });
}

// A real cross-entry use: an error class thrown by one entry must match instanceof in another.
const llm = modules['@coach/agents/llm'];
const stub = modules['@coach/agents/testing'];
const kit = modules['@coach/graph-kit'];
const crossEntry = {
  providerErrorChain:
    new llm.ProviderOutputError('x', { provider: 'p', issues: [], raw: '' }) instanceof
    llm.ProviderError,
  stubChatSameClass: stub.StubChatProvider === llm.StubChatProvider,
  graphErrorChain: new kit.GraphUnavailableError('x') instanceof kit.GraphKitError,
};

process.stdout.write(JSON.stringify({ resolved, shared, crossEntry }));
