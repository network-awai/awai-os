import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const guide = JSON.parse(readFileSync(new URL('../src/police-guide.json', import.meta.url), 'utf8'));

test('UN country and area index has distinct M49 and ISO codes', () => {
  const entries = Object.entries(guide.jurisdictions);
  assert.equal(entries.length, 248);
  assert.equal(new Set(entries.map(([, area]) => area.m49)).size, entries.length);
  assert.equal(new Set(entries.map(([, area]) => area.iso2)).size, entries.length);
  for (const [iso3, area] of entries) {
    assert.match(iso3, /^[A-Z]{3}$/);
    assert.match(area.iso2, /^[A-Z]{2}$/);
    assert.match(area.m49, /^\d{3}$/);
    assert.ok(area.name);
  }
});

test('every displayed procedure and case resolves to its own jurisdiction sources', () => {
  for (const [iso3, area] of Object.entries(guide.jurisdictions)) {
    const hasSources = ['official-route', 'partial'].includes(area.status);
    assert.equal(Boolean(area.sources), hasSources, iso3);
    if (hasSources) assert.ok(area.jurisdiction.length && area.intake.length, iso3);
    for (const source of Object.values(area.sources ?? {})) {
      const url = new URL(source.url);
      assert.equal(url.protocol, 'https:', iso3);
      assert.equal(url.username + url.password, '', iso3);
      assert.match(source.checkedOn, /^\d{4}-\d{2}-\d{2}$/, iso3);
      assert.ok(source.title, iso3);
    }
    for (const section of ['jurisdiction', 'intake', 'evidence', 'progress', 'cases', 'followUp']) {
      for (const entry of area[section] ?? []) {
        assert.ok(entry.text && entry.refs.length, iso3 + ' ' + section);
        assert.ok(entry.refs.every(ref => Object.hasOwn(area.sources, ref)), iso3);
        if (section === 'cases') assert.match(entry.stage, /^(action|investigation)-confirmed$/, iso3);
        if (section === 'evidence') assert.match(entry.kind, /^(required|recommended|retain)$/, iso3);
      }
    }
  }
});
