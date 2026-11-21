import { clientRuntimeProblems } from './runtime.js';

const app = document.querySelector('main');
const form = document.querySelector('#settings');
const input = document.querySelector('#art');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const preview = document.querySelector('#preview');
const view = document.querySelector('#view');
const sample = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><rect x="4" y="4" width="112" height="72" rx="8" fill="#165047"/><circle cx="40" cy="40" r="25" fill="#f34871"/><path fill="#ffd447" d="M76 20h28v12H76z M76 47h28v12H76z"/></svg>';
let job;
let previewUrl;
let activeRun = 0;
let activeWorker;

function renderPreview() {
  const white = Object.entries(job.films).find(([name]) => name.endsWith('-white.svg'))?.[1];
  const svg = view.value === 'white' ? white ?? job.preview : job[view.value];
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  preview.src = previewUrl;
}

function renderJob() {
  const films = document.querySelector('#films');
  films.replaceChildren();
  for (const [name, svg] of Object.entries(job.films).sort(([a], [b]) => a.localeCompare(b))) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = name;
    button.addEventListener('click', event => {
      if (event.isTrusted) {
        status.textContent = window.ShirohanFiles.saveSvg(name, svg)
          ? `ダウンロードに保存しました（${name}）`
          : '版下を保存できませんでした。';
      }
    });
    films.append(button);
  }
  const findings = document.querySelector('#findings');
  findings.replaceChildren(...job.findings.map(({ note }) => {
    const item = document.createElement('li');
    item.textContent = note;
    return item;
  }));
  document.querySelector('#notices').hidden = job.findings.length === 0;
  result.hidden = false;
  renderPreview();
  status.textContent = Object.keys(job.films).length ? `${Object.keys(job.films).length} 版を生成しました。` : '書き出せる版がありません。';
}

function imagePixels(image, side) {
  const ratio = Math.min(1, side / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * ratio));
  canvas.height = Math.max(1, Math.round(image.height * ratio));
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function runWorker(message) {
  const worker = new Worker('./worker.js');
  activeWorker = worker;
  worker.onmessage = ({data}) => {
    if (worker !== activeWorker) return;
    worker.terminate();
    activeWorker = undefined;
    if (data.error) status.textContent = `図案を処理できませんでした。 ${data.error}`;
    else {
      job = data.job;
      renderJob();
    }
  };
  worker.onerror = () => {
    if (worker !== activeWorker) return;
    worker.terminate();
    activeWorker = undefined;
    status.textContent = '製版エンジンを読み込めませんでした。';
  };
  worker.postMessage(message);
}

async function generate() {
  const run = ++activeRun;
  activeWorker?.terminate();
  activeWorker = undefined;
  result.hidden = true;
  status.textContent = '版を生成しています…';
  const file = input.files[0];
  const options = {
    'print-width-mm': Number(form.elements.width.value),
    'choke-mm': Number(form.elements.choke.value),
    'cut-line?': false,
    'separate-colors?': form.elements.separate.checked,
  };
  try {
    if (file?.size > 8 * 1024 * 1024) throw new Error('8 MB 以下の図案を選んでください。');
    const isSvg = file?.type === 'image/svg+xml' || /\.svg$/i.test(file?.name ?? '');
    if (!file || isSvg) {
      const svg = file ? await file.text() : sample;
      if (run === activeRun) runWorker({ svg, options });
    } else {
      const image = await createImageBitmap(file);
      try {
        if (run === activeRun) {
          runWorker({ color: imagePixels(image, 192), silhouette: imagePixels(image, 768), options });
        }
      } finally {
        image.close();
      }
    }
  } catch (error) {
    if (run === activeRun) status.textContent = `図案を処理できませんでした。 ${error.message ?? ''}`;
  }
}

try {
  const response = await fetch('./descriptor.json');
  if (!response.ok || clientRuntimeProblems(await response.json()).length) throw new Error("Invalid descriptor");
  form.addEventListener('submit', event => {
    event.preventDefault();
    void generate();
  });
  view.addEventListener('change', renderPreview);
  await generate();
} catch {
  status.textContent = 'Shirohan を読み込めませんでした。';
  app.querySelector('button').disabled = true;
}
