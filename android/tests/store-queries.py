#!/usr/bin/env python3
"""The Store's <queries> name every package it may list, so its downgrade and signer checks do not depend on a
launcher activity (AWAI-3771). Plain Python; nothing is built or installed.

  python3 -I android/tests/store-queries.py
"""
import importlib.util, json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('build', ROOT / 'android/build.py')
assert spec is not None and spec.loader is not None
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)
results = []


def check(name, ok, detail=''):
    results.append({'check': name, 'ok': bool(ok)} | ({'detail': detail} if detail and not ok else {}))


ids = build.store_query_packages()
series = [a['id'] for a in json.loads((ROOT / 'store/catalog-source/series-apps.json').read_text())['apps']]
local = ['network.itonami.' + a['suffix'] for a in json.loads((ROOT / 'android/local-apps.json').read_text())['apps']]
check('every series table app is named', all(i in ids for i in series), str([i for i in series if i not in ids]))
check('every local app is named', all(i in ids for i in local))
check('the apps named in Catalog.java are named', all(i in ids for i in ['network.itonami.app', 'network.itonami.registry.assoc',
                                                                         'network.itonami.torihiki.bot', 'network.itonami.dougaka.preview']))
check('the exact two-component Aozora package is visible without a launcher or pins', 'app.aozora' in ids)
check('only whole package ids (no prefix such as network.itonami.)', 'network.itonami.' not in ids and all(re.fullmatch(r'[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+', i) for i in ids))
pins = {'apks': {'network.itonami.pinnedonly': {}}}
check('a package only in the online pins is named too', 'network.itonami.pinnedonly' in build.store_query_packages(pins))

store = build.manifest('network.awai.store', 'network.awai.store.StoreActivity', 1, 'store', True, query_packages=ids)
queries = re.search(r'<queries>(.*)</queries>', store, re.S).group(1)
named = re.findall(r'<package android:name="([^"]+)"/>', queries)
check('the Store manifest names each package once', len(named) == len(set(named)) and set(ids) <= set(named), str(len(named)))
check('the Store keeps its launcher intent query', 'android.intent.category.LAUNCHER' in queries)
check('the Store does not ask for QUERY_ALL_PACKAGES', 'QUERY_ALL_PACKAGES' not in store)
home = build.manifest('network.awai.home', 'network.awai.home.HomeActivity', 1, 'home')
check('other hosts are unchanged (no series packages)', 'network.itonami.isco2423' not in home)

failed = [r for r in results if not r['ok']]
print(json.dumps({'checks': len(results), 'failed': len(failed), 'packages': len(ids), 'results': results}, indent=1))
sys.exit(1 if failed else 0)
