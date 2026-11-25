import guide from './police-guide-data.js';

const sections = {
  jurisdiction: '管轄と担当機関',
  intake: '届出の窓口',
  evidence: '準備する証拠・資料',
  progress: '受付・受理の確認',
  cases: '公表された事例',
  followUp: '追加提出・差し戻し・不受理後',
};

const statusLabels = {
  'official-route': '公式の窓口案内を確認',
  partial: '一部の地域・事案のみ確認',
  unverified: '既存台帳に記録あり・現行経路は未確認',
  unassessed: '未調査',
};

const detailLabels = {
  required: '公式案内の必須資料',
  recommended: '準備を案内している資料',
  retain: '保全用の資料',
  'action-confirmed': '届出の到達と機関の対応を確認',
  'investigation-confirmed': '届出先での捜査着手を確認',
  'status-check': '状況照会',
  'channel-unavailable': '窓口が使えないとき',
  'service-complaint': '警察の対応に関する苦情',
  'no-acknowledgment': '受付通知が来ないとき',
  supplement: '補足資料があるとき',
  review: '通知後の不服申立て',
};

function element(tag, text) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}

function renderArea(code, area) {
  const article = element('article');
  article.lang = guide.language;
  const heading = element('h3', area.name + ' · ' + code);
  heading.lang = 'en';
  article.append(heading, element('p', statusLabels[area.status ?? 'unassessed']));
  if (area.note) article.append(element('p', area.note));
  if (!area.sources) return article;

  const sourceIds = Object.keys(area.sources);
  for (const [key, label] of Object.entries(sections)) {
    article.append(element('h4', label));
    const entries = area[key] ?? [];
    if (!entries.length) {
      article.append(element('p', '未確認'));
      continue;
    }
    const list = element('ol');
    for (const entry of entries) {
      const detail = detailLabels[entry.kind ?? entry.stage];
      const citations = entry.refs.map(ref => String(sourceIds.indexOf(ref) + 1)).join(', ');
      list.append(element('li', (detail ? detail + ' — ' : '') + entry.text + ' [' + citations + ']'));
    }
    article.append(list);
  }
  const sources = element('ol');
  for (const {title, url, checkedOn} of Object.values(area.sources)) {
    const source = element('li', title + ' · 確認日 ' + checkedOn);
    // Display source addresses without handing navigation or case data to another origin.
    const address = element('p', url);
    address.className = 'mono';
    source.append(address);
    sources.append(source);
  }
  article.append(element('h4', '一次資料'), sources);
  return article;
}

export function renderPoliceGuide(view, locale, code) {
  const ja = locale === 'ja';
  const title = element('h2', ja ? '警察への届出' : 'Police reporting');
  title.id = 'police-guide-title';
  title.tabIndex = -1;
  const intro = element('p', ja
    ? 'サイバー犯罪・詐欺の届出を、国・地域ごとに調べられます。'
    : 'Look up cybercrime and fraud reporting by country or area. Detailed guidance is in Japanese.');
  const search = element('search');
  const picker = element('form');
  picker.setAttribute('aria-labelledby', title.id);
  picker.action = '#/police';

  const label = element('label', ja ? '国・地域（国連 M49）' : 'Country or area (UN M49)');
  label.htmlFor = 'police-area';
  const select = element('select');
  select.id = 'police-area';
  select.name = 'area';
  select.required = true;
  const placeholder = element('option', ja ? '選んでください' : 'Choose a country or area');
  placeholder.value = '';
  select.append(placeholder);
  const regionNames = new Intl.DisplayNames([locale], {type: 'region', fallback: 'none'});
  const areas = Object.entries(guide.jurisdictions).map(([id, area]) => ({
    id,
    name: regionNames.of(area.iso2) ?? area.name,
    covered: Boolean(area.sources),
  })).sort((a, b) => a.name.localeCompare(b.name, locale));
  const reviewed = element('optgroup');
  reviewed.label = ja ? '公式資料を掲載' : 'With official sources';
  const remaining = element('optgroup');
  remaining.label = ja ? '調査中・未調査' : 'Pending review';
  for (const area of areas) {
    const option = element('option', area.name + ' (' + area.id + ')');
    option.value = area.id;
    (area.covered ? reviewed : remaining).append(option);
  }
  select.append(reviewed, remaining);
  const area = code && Object.hasOwn(guide.jurisdictions, code) ? guide.jurisdictions[code] : null;
  select.value = area ? code : '';
  const submit = element('button', ja ? 'ガイドを表示' : 'Show guide');
  submit.type = 'submit';
  const actions = element('div');
  actions.className = 'actions';
  actions.append(submit);
  picker.append(label, select, actions);
  picker.addEventListener('submit', event => {
    event.preventDefault();
    const next = '#/police/' + select.value;
    if (location.hash === next) renderPoliceGuide(view, locale, select.value);
    else location.hash = next;
  });
  search.append(picker);
  view.replaceChildren(title, intro, search);
  if (area) view.append(renderArea(code, area));
  else if (code) view.append(element('p', ja ? '該当する国・地域がありません。' : 'Country or area not found.'));
  title.focus();
}
