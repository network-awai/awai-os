import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {patch} from './select-primary-display.mjs';

const sha = (x) => createHash('sha256').update(x).digest('hex');

function fixture(padding = 40) {
  const b = Buffer.alloc(4096);
  b.writeUInt32LE(0x80, 0x3c);
  b.writeUInt32LE(0x4550, 0x80);
  b.writeUInt16LE(0x20b, 0x80 + 24);
  const script = '#!ipxe\ndhcp || goto failed\nkernel http://10.77.0.1:18091/kernel initrd=initrd rw module_blacklist=ahci || goto failed\nboot\n';
  b.write(script + ' '.repeat(padding), 1024, 'ascii');
  return b;
}

test('adds the connector disable flag without growing the embedded script', () => {
  const input = fixture();
  const {bytes, script} = patch(input, 'HDMI-A-2', {pin: sha(input)});
  assert.equal(bytes.length, input.length);
  assert.match(script, / video=HDMI-A-2:d module_blacklist=ahci /);
  assert.equal(bytes.indexOf(0, 1024) - 1024, input.indexOf(0, 1024) - 1024);
});

test('rejects unpinned input, bad connector names, reapplication and growth', () => {
  const input = fixture();
  assert.throws(() => patch(input, 'HDMI-A-2'), /Unreviewed/);
  assert.throws(() => patch(input, 'HDMI-A-2; shell', {pin: sha(input)}), /connector/);
  const once = patch(input, 'HDMI-A-2', {pin: sha(input)}).bytes;
  assert.throws(() => patch(once, 'DP-1', {pin: sha(once)}), /already present/);
  const tight = fixture(5);
  assert.throws(() => patch(tight, 'HDMI-A-2', {pin: sha(tight)}), /cannot grow/);
});
