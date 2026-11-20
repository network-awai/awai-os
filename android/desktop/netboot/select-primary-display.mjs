// AWAI-3049: choose the 6600H desktop monitor by disabling the other DRM connector
// on the kernel command line. drm_hwcomposer then attaches the remaining
// connector as display #0, so AOSP Setup/Home run on the owner's monitor.
// Only the pinned persistent-v6 iPXE input is accepted; PE layout is preserved.
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

export const PINNED_INPUT = '34c26bfce0f338b8e0329d762c777e49d3e5fb3b371b15d0e9b516aaef3953c6';
const CONNECTOR = /^(HDMI-A|DP|eDP)-[1-9]$/;
const sha = (x) => createHash('sha256').update(x).digest('hex');

export function patch(input, disable, {pin = PINNED_INPUT} = {}) {
  assert.match(disable, CONNECTOR, 'Unexpected DRM connector name');
  assert.equal(sha(input), pin, 'Unreviewed iPXE input');
  const b = Buffer.from(input);
  const pe = b.readUInt32LE(0x3c), optional = pe + 24;
  assert.equal(b.readUInt32LE(pe), 0x4550);
  assert.equal(b.readUInt16LE(optional), 0x20b);
  assert.equal(b.readUInt32LE(optional + 112 + 4 * 8 + 4), 0, 'Never silently invalidate an Authenticode signature');
  const at = b.indexOf('kernel http://10.77.0.1:18091/kernel');
  assert(at >= 0 && b.indexOf('kernel http://10.77.0.1:18091/kernel', at + 1) === -1);
  const start = b.lastIndexOf('#!ipxe\n', at), end = b.indexOf(0, at);
  assert(start >= 0 && end > at);
  const original = b.toString('ascii', start, end);
  assert(!/ video=/.test(original), 'A video= selection is already present');
  const kernelLine = original.split('\n').find((l) => l.startsWith('kernel '));
  assert(kernelLine.includes(' module_blacklist='));
  const script = original.trimEnd().replace(' module_blacklist=', ` video=${disable}:d module_blacklist=`) + '\n';
  assert(script.length <= original.length, 'Embedded region cannot grow');
  b.write(script.padEnd(original.length, ' '), start, 'ascii');
  const checksumAt = optional + 64;
  b.writeUInt32LE(0, checksumAt);
  let checksum = 0;
  for (let i = 0; i < b.length; i += 2) {
    checksum += (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
    checksum = (checksum & 0xffff) + (checksum >>> 16);
  }
  checksum = (checksum & 0xffff) + (checksum >>> 16);
  b.writeUInt32LE((checksum + b.length) >>> 0, checksumAt);
  return {bytes: b, script};
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, disable, output] = process.argv.slice(2);
  assert(input && disable && output, 'usage: select-primary-display.mjs <ipxe.efi> <connector-to-disable> <output>');
  const {bytes, script} = patch(await readFile(input), disable);
  await writeFile(output, bytes, {flag: 'wx', mode: 0o644});
  console.log(JSON.stringify({input: PINNED_INPUT, disabled: disable, sha256: sha(bytes), bytes: bytes.length, kernelLine: script.split('\n').find((l) => l.startsWith('kernel ')), unsignedEngineeringImage: true}));
}
