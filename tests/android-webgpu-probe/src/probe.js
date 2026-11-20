// WebGPU capability probe. Pure checks are exported for tests; runProbe drives
// the real API. A result is "ok" only when the adapter, a compute dispatch and
// an offscreen render all check out; anything missing is "unavailable", any
// wrong value or thrown error is "failed". Nothing here is a fallback.
export const SCHEMA = 'awai.webgpu-probe.result.v1';
export const N = 256;
export const SIZE = 16;
export const CLEAR = [0, 0, 255, 255];   // rgba8unorm clear colour (blue)
export const FILL = [255, 0, 0, 255];    // triangle colour (red)
export const LIMIT_KEYS = ['maxTextureDimension2D', 'maxBufferSize', 'maxStorageBufferBindingSize',
  'maxComputeWorkgroupSizeX', 'maxComputeInvocationsPerWorkgroup', 'maxComputeWorkgroupStorageSize'];

export const COMPUTE_WGSL = `@group(0) @binding(0) var<storage, read_write> data: array<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i < arrayLength(&data)) { data[i] = data[i] * 2u + i; }
}`;

export const RENDER_WGSL = `@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2(0.0, 0.8), vec2(-0.8, -0.8), vec2(0.8, -0.8));
  return vec4<f32>(p[i], 0.0, 1.0);
}
@fragment fn fs() -> @location(0) vec4<f32> { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }`;

export const computeInput = () => Uint32Array.from({length: N}, (_, i) => i * 3 + 1);
export const computeExpected = input => Uint32Array.from(input, (v, i) => (v * 2 + i) >>> 0);

// Index of the first mismatch, or -1 when every element equals the expectation.
export function computeMismatch(input, output) {
  const want = computeExpected(input);
  if (!output || output.length !== want.length) return 0;
  for (let i = 0; i < want.length; i++) if (output[i] !== want[i]) return i;
  return -1;
}

// Rows are padded to 256 bytes by copyTextureToBuffer.
export const BYTES_PER_ROW = 256;
export function pixelAt(bytes, x, y) {
  const o = y * BYTES_PER_ROW + x * 4;
  return [bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]];
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
// Centre of the triangle must be FILL, the top-left corner must be CLEAR.
export function renderCheck(bytes) {
  const centre = pixelAt(bytes, SIZE / 2, SIZE / 2 + 2), corner = pixelAt(bytes, 0, 0);
  return {centre, corner, ok: same(centre, FILL) && same(corner, CLEAR)};
}

export function classify(r) {
  if (r.status === 'unavailable' || r.status === 'failed') return r.status;
  if (r.errors?.length) return 'failed';
  if (!r.compute || !r.render) return 'failed';
  return r.compute.ok && r.render.ok ? 'ok' : 'failed';
}

function limitsOf(adapter) {
  const out = {};
  for (const k of LIMIT_KEYS) out[k] = adapter.limits?.[k] ?? null;
  return out;
}

function infoOf(adapter) {
  const i = adapter.info || {};
  return {vendor: i.vendor ?? null, architecture: i.architecture ?? null, device: i.device ?? null,
    description: i.description ?? null, isFallbackAdapter: adapter.isFallbackAdapter ?? i.isFallbackAdapter ?? null};
}

async function runCompute(device, usage) {
  const input = computeInput(), bytes = input.byteLength;
  const storage = device.createBuffer({size: bytes, usage: usage.BUF.STORAGE | usage.BUF.COPY_SRC | usage.BUF.COPY_DST});
  const read = device.createBuffer({size: bytes, usage: usage.BUF.MAP_READ | usage.BUF.COPY_DST});
  device.queue.writeBuffer(storage, 0, input);
  const pipeline = device.createComputePipeline({layout: 'auto',
    compute: {module: device.createShaderModule({code: COMPUTE_WGSL}), entryPoint: 'main'}});
  const bind = device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: storage}}]});
  const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(Math.ceil(N / 64)); pass.end();
  enc.copyBufferToBuffer(storage, 0, read, 0, bytes);
  device.queue.submit([enc.finish()]);
  await read.mapAsync(usage.MAP.READ);
  const output = new Uint32Array(read.getMappedRange().slice(0));
  read.unmap();
  const at = computeMismatch(input, output);
  return {elements: N, ok: at === -1, firstMismatch: at === -1 ? null : at};
}

function drawTriangle(device, view, format) {
  const pipeline = device.createRenderPipeline({layout: 'auto',
    vertex: {module: device.createShaderModule({code: RENDER_WGSL}), entryPoint: 'vs'},
    fragment: {module: device.createShaderModule({code: RENDER_WGSL}), entryPoint: 'fs', targets: [{format}]},
    primitive: {topology: 'triangle-list'}});
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({colorAttachments: [{view, loadOp: 'clear', storeOp: 'store',
    clearValue: {r: CLEAR[0] / 255, g: CLEAR[1] / 255, b: CLEAR[2] / 255, a: 1}}]});
  pass.setPipeline(pipeline); pass.draw(3); pass.end();
  return enc;
}

async function runRender(device, usage) {
  const texture = device.createTexture({size: [SIZE, SIZE], format: 'rgba8unorm',
    usage: usage.TEX.RENDER_ATTACHMENT | usage.TEX.COPY_SRC});
  const read = device.createBuffer({size: BYTES_PER_ROW * SIZE, usage: usage.BUF.MAP_READ | usage.BUF.COPY_DST});
  const enc = drawTriangle(device, texture.createView(), 'rgba8unorm');
  enc.copyTextureToBuffer({texture}, {buffer: read, bytesPerRow: BYTES_PER_ROW}, [SIZE, SIZE]);
  device.queue.submit([enc.finish()]);
  await read.mapAsync(usage.MAP.READ);
  const bytes = new Uint8Array(read.getMappedRange().slice(0));
  read.unmap();
  return {size: SIZE, ...renderCheck(bytes)};
}

// Draws the same triangle on the visible canvas, for a screenshot. Not part of
// the pass/fail result: a presented frame cannot be read back reliably.
function present(gpu, device, canvas) {
  const ctx = canvas?.getContext?.('webgpu');
  if (!ctx) return 'no-webgpu-canvas-context';
  const format = gpu.getPreferredCanvasFormat();
  ctx.configure({device, format, alphaMode: 'opaque'});
  device.queue.submit([drawTriangle(device, ctx.getCurrentTexture().createView(), format).finish()]);
  return format;
}

const message = e => String(e?.message ?? e);

export async function runProbe({gpu, canvas, usage, now = () => new Date().toISOString(), userAgent = null} = {}) {
  const base = {schema: SCHEMA, at: now(), userAgent};
  if (!gpu) return {...base, status: 'unavailable', reason: 'navigator.gpu is missing'};
  let adapter;
  try { adapter = await gpu.requestAdapter(); }
  catch (e) { return {...base, status: 'failed', reason: 'requestAdapter threw', errors: [message(e)]}; }
  if (!adapter) return {...base, status: 'unavailable', reason: 'requestAdapter returned null'};
  const r = {...base, adapter: infoOf(adapter), features: [...(adapter.features ?? [])].sort(), limits: limitsOf(adapter), errors: []};
  let device;
  try { device = await adapter.requestDevice(); }
  catch (e) { return {...r, status: 'failed', reason: 'requestDevice threw', errors: [message(e)]}; }
  const lost = device.lost?.then(i => r.errors.push('device lost: ' + (i?.message || i?.reason || 'unknown')));
  device.pushErrorScope?.('validation');
  try { r.compute = await runCompute(device, usage); } catch (e) { r.errors.push('compute: ' + message(e)); }
  try { r.render = await runRender(device, usage); } catch (e) { r.errors.push('render: ' + message(e)); }
  try { r.presentFormat = present(gpu, device, canvas); } catch (e) { r.presentFormat = 'error: ' + message(e); }
  const v = await device.popErrorScope?.();
  if (v) r.errors.push('validation: ' + message(v));
  void lost;
  r.status = classify(r);
  return r;
}

export const browserUsage = g => ({BUF: g.GPUBufferUsage, TEX: g.GPUTextureUsage, MAP: g.GPUMapMode});
