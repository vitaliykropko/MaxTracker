import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, ExtData } from '@msgpack/msgpack';
import { decodeLz4Block, decodeMaxFrame, serverId } from '../src/max-codec.js';

function frame(payload) {
  const body = payload instanceof Uint8Array ? payload : encode(payload);
  const bytes = new Uint8Array(10 + body.length);
  bytes.set([10, 1, 0, 7, 0, 49, 0, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255]);
  bytes.set(body, 10);
  return bytes;
}

test('server ID survives the MAX ext-1 integer wrapper without precision loss', () => {
  const id = 123456789012345678n;
  const wrapped = new ExtData(1, encode(id, { useBigInt64: true }));
  const decoded = decodeMaxFrame(frame({ chatId: '-100', messages: [{ id: wrapped, sender: 77 }] }));
  assert.equal(decoded.opcode, 49);
  assert.equal(decoded.sequence, 7);
  assert.equal(serverId(decoded.payload.messages[0].id), '123456789012345678');
});

test('LZ4 supports overlapping back references and rejects corrupt offsets', () => {
  assert.equal(new TextDecoder().decode(decodeLz4Block(Uint8Array.from([0x10, 97, 1, 0]), 5)), 'aaaaa');
  assert.throws(() => decodeLz4Block(Uint8Array.from([0, 0, 0]), 4), /offset/);
  assert.throws(() => decodeLz4Block(Uint8Array.from([0xf0]), 16), /Truncated/);
});

test('invalid frames and unsafe numeric identities fail instead of guessing', () => {
  const bytes = frame({ id: 42 });
  assert.throws(() => decodeMaxFrame(bytes.subarray(0, bytes.length - 1)), /length mismatch/);
  assert.equal(serverId(123456789012345678), null);
  assert.equal(serverId('id_with_separator'), 'id_with_separator');
});

test('server maps with ext-1 64-bit participant keys preserve the full key', () => {
  const key = encode(new ExtData(1, encode(123456789012345678n, { useBigInt64: true })));
  const body = Uint8Array.from([0x81, ...key, 0xc3]);
  assert.deepEqual(decodeMaxFrame(frame(body)).payload, { '123456789012345678': true });
});
