import { decode, ExtensionCodec } from '@msgpack/msgpack';

// Read-only decoder of the frame format observed in the live MAX web client.
// No MAX request encoder or independent API client is provided.
const MAX_BYTES = 32 * 1024 * 1024;
const extensionCodec = new ExtensionCodec();
extensionCodec.register({
  type: 1,
  decode: bytes => decode(bytes, { useBigInt64: true }),
});

export function decodeLz4Block(input, capacity) {
  if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > MAX_BYTES) {
    throw new Error('Invalid LZ4 capacity');
  }
  const output = new Uint8Array(capacity);
  let source = 0;
  let target = 0;
  const extendedLength = initial => {
    let length = initial;
    if (initial === 15) {
      let extra;
      do {
        if (source >= input.length) throw new Error('Truncated LZ4 length');
        extra = input[source++];
        length += extra;
        if (length > MAX_BYTES) throw new Error('LZ4 length exceeds limit');
      } while (extra === 255);
    }
    return length;
  };
  while (source < input.length) {
    const token = input[source++];
    const literals = extendedLength(token >>> 4);
    if (source + literals > input.length || target + literals > capacity) {
      throw new Error('Invalid LZ4 literals');
    }
    output.set(input.subarray(source, source + literals), target);
    source += literals;
    target += literals;
    if (source === input.length) break;
    if (source + 2 > input.length) throw new Error('Truncated LZ4 offset');
    const offset = input[source++] | (input[source++] << 8);
    if (!offset || offset > target) throw new Error('Invalid LZ4 offset');
    const matches = extendedLength(token & 15) + 4;
    if (target + matches > capacity) throw new Error('Invalid LZ4 match length');
    for (let i = 0; i < matches; i++) output[target + i] = output[target + i - offset];
    target += matches;
  }
  return output.subarray(0, target);
}

export function decodeMaxFrame(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (bytes.length < 10 || bytes.length > MAX_BYTES || bytes[0] !== 10) {
    throw new Error('Unsupported MAX frame header');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = (bytes[7] << 16) | (bytes[8] << 8) | bytes[9];
  if (length !== bytes.length - 10) throw new Error('MAX frame length mismatch');
  const factor = bytes[6];
  let payload = bytes.subarray(10);
  if (factor) payload = decodeLz4Block(payload, length * factor);
  return {
    command: bytes[1],
    sequence: view.getInt16(2, false),
    opcode: view.getInt16(4, false),
    payload: payload.length ? decode(payload, {
      useBigInt64: true,
      extensionCodec,
      mapKeyConverter: key => {
        if (typeof key === 'bigint') return key.toString();
        if (typeof key === 'string' || typeof key === 'number') return key;
        throw new Error('Unsupported MAX map key');
      },
      maxStrLength: MAX_BYTES,
      maxBinLength: MAX_BYTES,
      maxArrayLength: 250000,
      maxMapLength: 250000,
    }) : null,
  };
}

export function serverId(value) {
  if (typeof value === 'string' && value && value.length <= 256) return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return null;
}
