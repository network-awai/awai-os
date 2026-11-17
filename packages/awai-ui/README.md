# @awai/ui — Awai Android Native UX v2

Reusable presentation primitives for Awai Otehon browser/Android Tauri apps. Source is pure `.cljc` hiccup plus a small CLJS DOM adapter; compiled ESM and scoped CSS are packaged together. No React, DADS, service access, application state, consent broker or OS controls.

## Use from another app

Pin the awai-os commit, enter `packages/awai-ui`, run `npm ci`, `npm run test`, then `npm pack`. Install the resulting immutable `.tgz` in the consumer (keep its integrity in the lockfile). Registry publication is not required and has not been performed. Copy `dist/awai-ui.css` and `dist/ui-assets/` together into the static artifact. No remote fonts/icons/CDN. Icons must use a bundled local path; URL schemes and protocol-relative URLs are rejected.

```js
import {button, card, search_field, navigation, mount} from '@awai/ui';
mount(document.querySelector('#app'), ['div', {class:'awai-ui'},
  card(['h1', {}, 'My Awai app'], button('Continue', {attrs:{'on-click': () => console.log('local action')}})),
  search_field({id:'find', label:'Find a document', value:'', 'icon-src':'ui-assets/search.svg'}),
  navigation('My Awai app', [{id:'documents', label:'Documents', href:'#documents', 'icon-src':'ui-assets/apps.svg'}], 'documents')
]);
```

CLJS: `(:require ["@awai/ui" :as ui])`, then `(ui/button "続ける" {:variant "tonal" :attrs {:on-click handler}})`. CLJC consumers may use `src/awai/ui.cljc` directly with their own renderer. ESM export names use underscores (`search_field`); CLJC names use hyphens (`search-field`). Labels and error strings belong to the caller's locale dictionary.

## Components and contract

- `button(label, opts)`: primary/tonal/text; disabled/busy/destructive; actual native button, default type button. Busy blocks activation, accessible name remains caller-provided. No action authorization.
- `search_field(opts)`: required id/label; value/on-input/on-composition-end/disabled/error/icon-src; native search field, 56px target and associated errors.
- `field(opts, control)`: required id/label, optional hint/error; native input/select/textarea supplied by caller.
- `navigation(label, items, current)`: a single semantic nav/list of local fragment anchors. One current-page capsule; no menu/tab roles or custom arrow-key behavior. App-scoped, never Android global navigation.
- `card`, `stack`, `heading`, `container`, `disclosure`, `status`: layout and semantics only. Disclosure is for supplemental content, not a nested navigation menu.
- `node`/`mount`: text-safe rendering, no innerHTML; handlers use `on-click` etc. Strings are content, not HTML. Replacing a tree is explicit: app owns focus restoration/state, subscriptions and input composition.

Add `.awai-ui` to a root. System theme follows prefers-color-scheme; override root `data-awai-theme="light"` or `"dark"`. No global body reset. Minimum controls48px, buttons52px, fluid content heights, scalable text, reduced motion/forced-colors support. Display/error/loading labels must be meaningful and localized by the consumer. This is not a WCAG certification or a replacement for TalkBack/device tests.

## Design provenance and intentional adaptation

[Figma Android v2](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=192-2). `tokens/figma-android-v2.json` preserves actual light/dark variables, raw RGBA and alias IDs; CSS rounds to sRGB 8-bit. `design-map.json` maps exact component IDs, icon bytes, font source and app proposal. Button radius999,52px and label14/22; search56px/shape28; navigation64×32 selection area. Source data cards wrap and grow instead of clipping at Figma's illustrative120px. Focus ring/current underline/forced-colors borders add non-color-only state cues. Native v2 defines design, this package implements WebView/DOM behavior; Compose Code Connect mappings are not claimed as CLJS code.

Source Figma definitions are unchanged. Only a new app proposal page was added. Existing Awai apps and SystemUI are not auto-migrated. Consumer CSP, each-operation consent, host permissions and Android insets remain the host's responsibility. Never import this package as a permission or identity authority.

## Build and local verification

`npm ci && npm test` builds pinned Squint0.16.214/esbuild0.28.2; `npm pack` includes self-contained ESM/CSS, CLJC source, local icons/font/license and byte integrity manifest. `examples/gallery.html` demonstrates reuse independently of World Observatory. No JVM/native gate or required CI is added.

## Adopt existing Awai screens (0.2)

`bind_native(root, {buttons, tonal, text, skip})` adds shared presentation classes to existing native buttons and observes added descendants. It never replaces a node, listeners, type, value, disabled/hidden state, labels, approval or storage. The default skip is `.kotoba-client-consent`: the canonical broker owns those controls. Dynamic app state stays with the owning React/DOM code. The returned function disconnects the observer. Call once for the application root; application theme adapters map existing choice to `data-awai-theme` (light/hiru/dark). Hiru's actual Figma tokens/IDs are in `tokens/figma-hiru.json`.

Owning builds call `distributeUi(destination)` from `@awai/ui/distribute` after building this package. It recomputes the library source/artifact integrity, copies the same bundle/CSS/local assets into an `awai-ui/` subfolder and writes consumer provenance. Include `awai-ui/awai-ui.css` after product layout CSS, and import `bind_native` from `./awai-ui/index.js`. This is a build-time copier, not an app-origin API. Consumer release manifests must include copied files. Static origin/CSP/local font loading and the shared consent broker remain separately governed.

0.2 migration consumers in awai-os: Itonami's existing owning shell, Murakumo, Drive and Yotei. The shell's Core/Apps/System, Manimani, identity and three theme selections are preserved; local UI binding does not sign in. `hidden` elements stay hidden, checkbox/radio labels provide touch targets without enlarging the native glyph, and disabled actions retain their original behavior. Other Awai repositories are not silently migrated.
