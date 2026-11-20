(() => {
  // node_modules/@msgpack/msgpack/dist.esm/utils/utf8.mjs
  var sharedTextEncoder = new TextEncoder();
  var CHUNK_SIZE = 4096;
  function utf8DecodeJs(bytes, inputOffset, byteLength) {
    let offset = inputOffset;
    const end = offset + byteLength;
    const units = [];
    let result = "";
    while (offset < end) {
      const byte1 = bytes[offset++];
      if ((byte1 & 128) === 0) {
        units.push(byte1);
      } else if ((byte1 & 224) === 192) {
        const byte2 = bytes[offset++] & 63;
        units.push((byte1 & 31) << 6 | byte2);
      } else if ((byte1 & 240) === 224) {
        const byte2 = bytes[offset++] & 63;
        const byte3 = bytes[offset++] & 63;
        units.push((byte1 & 31) << 12 | byte2 << 6 | byte3);
      } else if ((byte1 & 248) === 240) {
        const byte2 = bytes[offset++] & 63;
        const byte3 = bytes[offset++] & 63;
        const byte4 = bytes[offset++] & 63;
        let unit = (byte1 & 7) << 18 | byte2 << 12 | byte3 << 6 | byte4;
        if (unit > 65535) {
          unit -= 65536;
          units.push(unit >>> 10 & 1023 | 55296);
          unit = 56320 | unit & 1023;
        }
        units.push(unit);
      } else {
        units.push(byte1);
      }
      if (units.length >= CHUNK_SIZE) {
        result += String.fromCharCode(...units);
        units.length = 0;
      }
    }
    if (units.length > 0) {
      result += String.fromCharCode(...units);
    }
    return result;
  }
  var sharedTextDecoder = new TextDecoder();
  var TEXT_DECODER_THRESHOLD = 200;
  function utf8DecodeTD(bytes, inputOffset, byteLength) {
    const stringBytes = bytes.subarray(inputOffset, inputOffset + byteLength);
    return sharedTextDecoder.decode(stringBytes);
  }
  function utf8Decode(bytes, inputOffset, byteLength) {
    if (byteLength > TEXT_DECODER_THRESHOLD) {
      return utf8DecodeTD(bytes, inputOffset, byteLength);
    } else {
      return utf8DecodeJs(bytes, inputOffset, byteLength);
    }
  }

  // node_modules/@msgpack/msgpack/dist.esm/ExtData.mjs
  var ExtData = class {
    type;
    data;
    constructor(type, data) {
      this.type = type;
      this.data = data;
    }
  };

  // node_modules/@msgpack/msgpack/dist.esm/DecodeError.mjs
  var DecodeError = class _DecodeError extends Error {
    constructor(message) {
      super(message);
      const proto = Object.create(_DecodeError.prototype);
      Object.setPrototypeOf(this, proto);
      Object.defineProperty(this, "name", {
        configurable: true,
        enumerable: false,
        value: _DecodeError.name
      });
    }
  };

  // node_modules/@msgpack/msgpack/dist.esm/utils/int.mjs
  var UINT32_MAX = 4294967295;
  function setInt64(view2, offset, value) {
    const high = Math.floor(value / 4294967296);
    const low = value;
    view2.setUint32(offset, high);
    view2.setUint32(offset + 4, low);
  }
  function getInt64(view2, offset) {
    const high = view2.getInt32(offset);
    const low = view2.getUint32(offset + 4);
    return high * 4294967296 + low;
  }
  function getUint64(view2, offset) {
    const high = view2.getUint32(offset);
    const low = view2.getUint32(offset + 4);
    return high * 4294967296 + low;
  }

  // node_modules/@msgpack/msgpack/dist.esm/timestamp.mjs
  var EXT_TIMESTAMP = -1;
  var TIMESTAMP32_MAX_SEC = 4294967296 - 1;
  var TIMESTAMP64_MAX_SEC = 17179869184 - 1;
  function encodeTimeSpecToTimestamp({ sec, nsec }) {
    if (sec >= 0 && nsec >= 0 && sec <= TIMESTAMP64_MAX_SEC) {
      if (nsec === 0 && sec <= TIMESTAMP32_MAX_SEC) {
        const rv = new Uint8Array(4);
        const view2 = new DataView(rv.buffer);
        view2.setUint32(0, sec);
        return rv;
      } else {
        const secHigh = sec / 4294967296;
        const secLow = sec & 4294967295;
        const rv = new Uint8Array(8);
        const view2 = new DataView(rv.buffer);
        view2.setUint32(0, nsec << 2 | secHigh & 3);
        view2.setUint32(4, secLow);
        return rv;
      }
    } else {
      const rv = new Uint8Array(12);
      const view2 = new DataView(rv.buffer);
      view2.setUint32(0, nsec);
      setInt64(view2, 4, sec);
      return rv;
    }
  }
  function encodeDateToTimeSpec(date) {
    const msec = date.getTime();
    const sec = Math.floor(msec / 1e3);
    const nsec = (msec - sec * 1e3) * 1e6;
    const nsecInSec = Math.floor(nsec / 1e9);
    return {
      sec: sec + nsecInSec,
      nsec: nsec - nsecInSec * 1e9
    };
  }
  function encodeTimestampExtension(object) {
    if (object instanceof Date) {
      const timeSpec = encodeDateToTimeSpec(object);
      return encodeTimeSpecToTimestamp(timeSpec);
    } else {
      return null;
    }
  }
  function decodeTimestampToTimeSpec(data) {
    const view2 = new DataView(data.buffer, data.byteOffset, data.byteLength);
    switch (data.byteLength) {
      case 4: {
        const sec = view2.getUint32(0);
        const nsec = 0;
        return { sec, nsec };
      }
      case 8: {
        const nsec30AndSecHigh2 = view2.getUint32(0);
        const secLow32 = view2.getUint32(4);
        const sec = (nsec30AndSecHigh2 & 3) * 4294967296 + secLow32;
        const nsec = nsec30AndSecHigh2 >>> 2;
        return { sec, nsec };
      }
      case 12: {
        const sec = getInt64(view2, 4);
        const nsec = view2.getUint32(0);
        return { sec, nsec };
      }
      default:
        throw new DecodeError(`Unrecognized data size for timestamp (expected 4, 8, or 12): ${data.length}`);
    }
  }
  function decodeTimestampExtension(data) {
    const timeSpec = decodeTimestampToTimeSpec(data);
    return new Date(timeSpec.sec * 1e3 + timeSpec.nsec / 1e6);
  }
  var timestampExtension = {
    type: EXT_TIMESTAMP,
    encode: encodeTimestampExtension,
    decode: decodeTimestampExtension
  };

  // node_modules/@msgpack/msgpack/dist.esm/ExtensionCodec.mjs
  var ExtensionCodec = class _ExtensionCodec {
    static defaultCodec = new _ExtensionCodec();
    // ensures ExtensionCodecType<X> matches ExtensionCodec<X>
    // this will make type errors a lot more clear
    // eslint-disable-next-line @typescript-eslint/naming-convention
    __brand;
    // built-in extensions
    builtInEncoders = [];
    builtInDecoders = [];
    // custom extensions
    encoders = [];
    decoders = [];
    constructor() {
      this.register(timestampExtension);
    }
    register({ type, encode, decode: decode2 }) {
      if (type >= 0) {
        this.encoders[type] = encode;
        this.decoders[type] = decode2;
      } else {
        const index = -1 - type;
        this.builtInEncoders[index] = encode;
        this.builtInDecoders[index] = decode2;
      }
    }
    tryToEncode(object, context) {
      for (let i = 0; i < this.builtInEncoders.length; i++) {
        const encodeExt = this.builtInEncoders[i];
        if (encodeExt != null) {
          const data = encodeExt(object, context);
          if (data != null) {
            const type = -1 - i;
            return new ExtData(type, data);
          }
        }
      }
      for (let i = 0; i < this.encoders.length; i++) {
        const encodeExt = this.encoders[i];
        if (encodeExt != null) {
          const data = encodeExt(object, context);
          if (data != null) {
            const type = i;
            return new ExtData(type, data);
          }
        }
      }
      if (object instanceof ExtData) {
        return object;
      }
      return null;
    }
    decode(data, type, context) {
      const decodeExt = type < 0 ? this.builtInDecoders[-1 - type] : this.decoders[type];
      if (decodeExt) {
        return decodeExt(data, type, context);
      } else {
        return new ExtData(type, data);
      }
    }
  };

  // node_modules/@msgpack/msgpack/dist.esm/utils/typedArrays.mjs
  function isArrayBufferLike(buffer) {
    return buffer instanceof ArrayBuffer || typeof SharedArrayBuffer !== "undefined" && buffer instanceof SharedArrayBuffer;
  }
  function ensureUint8Array(buffer) {
    if (buffer instanceof Uint8Array) {
      return buffer;
    } else if (ArrayBuffer.isView(buffer)) {
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else if (isArrayBufferLike(buffer)) {
      return new Uint8Array(buffer);
    } else {
      return Uint8Array.from(buffer);
    }
  }

  // node_modules/@msgpack/msgpack/dist.esm/utils/prettyByte.mjs
  function prettyByte(byte) {
    return `${byte < 0 ? "-" : ""}0x${Math.abs(byte).toString(16).padStart(2, "0")}`;
  }

  // node_modules/@msgpack/msgpack/dist.esm/CachedKeyDecoder.mjs
  var DEFAULT_MAX_KEY_LENGTH = 16;
  var DEFAULT_MAX_LENGTH_PER_KEY = 16;
  var CachedKeyDecoder = class {
    hit = 0;
    miss = 0;
    caches;
    maxKeyLength;
    maxLengthPerKey;
    constructor(maxKeyLength = DEFAULT_MAX_KEY_LENGTH, maxLengthPerKey = DEFAULT_MAX_LENGTH_PER_KEY) {
      this.maxKeyLength = maxKeyLength;
      this.maxLengthPerKey = maxLengthPerKey;
      this.caches = [];
      for (let i = 0; i < this.maxKeyLength; i++) {
        this.caches.push([]);
      }
    }
    canBeCached(byteLength) {
      return byteLength > 0 && byteLength <= this.maxKeyLength;
    }
    find(bytes, inputOffset, byteLength) {
      const records = this.caches[byteLength - 1];
      FIND_CHUNK: for (const record of records) {
        const recordBytes = record.bytes;
        for (let j = 0; j < byteLength; j++) {
          if (recordBytes[j] !== bytes[inputOffset + j]) {
            continue FIND_CHUNK;
          }
        }
        return record.str;
      }
      return null;
    }
    store(bytes, value) {
      const records = this.caches[bytes.length - 1];
      const record = { bytes, str: value };
      if (records.length >= this.maxLengthPerKey) {
        records[Math.random() * records.length | 0] = record;
      } else {
        records.push(record);
      }
    }
    decode(bytes, inputOffset, byteLength) {
      const cachedValue = this.find(bytes, inputOffset, byteLength);
      if (cachedValue != null) {
        this.hit++;
        return cachedValue;
      }
      this.miss++;
      const str = utf8DecodeJs(bytes, inputOffset, byteLength);
      const slicedCopyOfBytes = Uint8Array.prototype.slice.call(bytes, inputOffset, inputOffset + byteLength);
      this.store(slicedCopyOfBytes, str);
      return str;
    }
  };

  // node_modules/@msgpack/msgpack/dist.esm/Decoder.mjs
  var STATE_ARRAY = "array";
  var STATE_MAP_KEY = "map_key";
  var STATE_MAP_VALUE = "map_value";
  var mapKeyConverter = (key) => {
    if (typeof key === "string" || typeof key === "number") {
      return key;
    }
    throw new DecodeError("The type of key must be string or number but " + typeof key);
  };
  var StackPool = class {
    stack = [];
    stackHeadPosition = -1;
    get length() {
      return this.stackHeadPosition + 1;
    }
    top() {
      return this.stack[this.stackHeadPosition];
    }
    pushArrayState(size) {
      const state = this.getUninitializedStateFromPool();
      state.type = STATE_ARRAY;
      state.position = 0;
      state.size = size;
      state.array = new Array(size);
    }
    pushMapState(size) {
      const state = this.getUninitializedStateFromPool();
      state.type = STATE_MAP_KEY;
      state.readCount = 0;
      state.size = size;
      state.map = {};
    }
    getUninitializedStateFromPool() {
      this.stackHeadPosition++;
      if (this.stackHeadPosition === this.stack.length) {
        const partialState = {
          type: void 0,
          size: 0,
          array: void 0,
          position: 0,
          readCount: 0,
          map: void 0,
          key: null
        };
        this.stack.push(partialState);
      }
      return this.stack[this.stackHeadPosition];
    }
    release(state) {
      const topStackState = this.stack[this.stackHeadPosition];
      if (topStackState !== state) {
        throw new Error("Invalid stack state. Released state is not on top of the stack.");
      }
      if (state.type === STATE_ARRAY) {
        const partialState = state;
        partialState.size = 0;
        partialState.array = void 0;
        partialState.position = 0;
        partialState.type = void 0;
      }
      if (state.type === STATE_MAP_KEY || state.type === STATE_MAP_VALUE) {
        const partialState = state;
        partialState.size = 0;
        partialState.map = void 0;
        partialState.readCount = 0;
        partialState.type = void 0;
      }
      this.stackHeadPosition--;
    }
    reset() {
      this.stack.length = 0;
      this.stackHeadPosition = -1;
    }
  };
  var HEAD_BYTE_REQUIRED = -1;
  var EMPTY_VIEW = new DataView(new ArrayBuffer(0));
  var EMPTY_BYTES = new Uint8Array(EMPTY_VIEW.buffer);
  try {
    EMPTY_VIEW.getInt8(0);
  } catch (e) {
    if (!(e instanceof RangeError)) {
      throw new Error("This module is not supported in the current JavaScript engine because DataView does not throw RangeError on out-of-bounds access");
    }
  }
  var MORE_DATA = new RangeError("Insufficient data");
  var sharedCachedKeyDecoder = new CachedKeyDecoder();
  var Decoder = class _Decoder {
    extensionCodec;
    context;
    useBigInt64;
    rawStrings;
    maxStrLength;
    maxBinLength;
    maxArrayLength;
    maxMapLength;
    maxExtLength;
    keyDecoder;
    mapKeyConverter;
    totalPos = 0;
    pos = 0;
    view = EMPTY_VIEW;
    bytes = EMPTY_BYTES;
    headByte = HEAD_BYTE_REQUIRED;
    stack = new StackPool();
    entered = false;
    constructor(options) {
      this.extensionCodec = options?.extensionCodec ?? ExtensionCodec.defaultCodec;
      this.context = options?.context;
      this.useBigInt64 = options?.useBigInt64 ?? false;
      this.rawStrings = options?.rawStrings ?? false;
      this.maxStrLength = options?.maxStrLength ?? UINT32_MAX;
      this.maxBinLength = options?.maxBinLength ?? UINT32_MAX;
      this.maxArrayLength = options?.maxArrayLength ?? UINT32_MAX;
      this.maxMapLength = options?.maxMapLength ?? UINT32_MAX;
      this.maxExtLength = options?.maxExtLength ?? UINT32_MAX;
      this.keyDecoder = options?.keyDecoder !== void 0 ? options.keyDecoder : sharedCachedKeyDecoder;
      this.mapKeyConverter = options?.mapKeyConverter ?? mapKeyConverter;
    }
    clone() {
      return new _Decoder({
        extensionCodec: this.extensionCodec,
        context: this.context,
        useBigInt64: this.useBigInt64,
        rawStrings: this.rawStrings,
        maxStrLength: this.maxStrLength,
        maxBinLength: this.maxBinLength,
        maxArrayLength: this.maxArrayLength,
        maxMapLength: this.maxMapLength,
        maxExtLength: this.maxExtLength,
        keyDecoder: this.keyDecoder
      });
    }
    reinitializeState() {
      this.totalPos = 0;
      this.headByte = HEAD_BYTE_REQUIRED;
      this.stack.reset();
    }
    setBuffer(buffer) {
      const bytes = ensureUint8Array(buffer);
      this.bytes = bytes;
      this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      this.pos = 0;
    }
    appendBuffer(buffer) {
      if (this.headByte === HEAD_BYTE_REQUIRED && !this.hasRemaining(1)) {
        this.setBuffer(buffer);
      } else {
        const remainingData = this.bytes.subarray(this.pos);
        const newData = ensureUint8Array(buffer);
        const newBuffer = new Uint8Array(remainingData.length + newData.length);
        newBuffer.set(remainingData);
        newBuffer.set(newData, remainingData.length);
        this.setBuffer(newBuffer);
      }
    }
    hasRemaining(size) {
      return this.view.byteLength - this.pos >= size;
    }
    createExtraByteError(posToShow) {
      const { view: view2, pos } = this;
      return new RangeError(`Extra ${view2.byteLength - pos} of ${view2.byteLength} byte(s) found at buffer[${posToShow}]`);
    }
    /**
     * @throws {@link DecodeError}
     * @throws {@link RangeError}
     */
    decode(buffer) {
      if (this.entered) {
        const instance = this.clone();
        return instance.decode(buffer);
      }
      try {
        this.entered = true;
        this.reinitializeState();
        this.setBuffer(buffer);
        const object = this.doDecodeSync();
        if (this.hasRemaining(1)) {
          throw this.createExtraByteError(this.pos);
        }
        return object;
      } finally {
        this.entered = false;
      }
    }
    *decodeMulti(buffer) {
      if (this.entered) {
        const instance = this.clone();
        yield* instance.decodeMulti(buffer);
        return;
      }
      try {
        this.entered = true;
        this.reinitializeState();
        this.setBuffer(buffer);
        while (this.hasRemaining(1)) {
          yield this.doDecodeSync();
        }
      } finally {
        this.entered = false;
      }
    }
    async decodeAsync(stream) {
      if (this.entered) {
        const instance = this.clone();
        return instance.decodeAsync(stream);
      }
      try {
        this.entered = true;
        let decoded = false;
        let object;
        for await (const buffer of stream) {
          if (decoded) {
            this.entered = false;
            throw this.createExtraByteError(this.totalPos);
          }
          this.appendBuffer(buffer);
          try {
            object = this.doDecodeSync();
            decoded = true;
          } catch (e) {
            if (!(e instanceof RangeError)) {
              throw e;
            }
          }
          this.totalPos += this.pos;
        }
        if (decoded) {
          if (this.hasRemaining(1)) {
            throw this.createExtraByteError(this.totalPos);
          }
          return object;
        }
        const { headByte, pos, totalPos } = this;
        throw new RangeError(`Insufficient data in parsing ${prettyByte(headByte)} at ${totalPos} (${pos} in the current buffer)`);
      } finally {
        this.entered = false;
      }
    }
    decodeArrayStream(stream) {
      return this.decodeMultiAsync(stream, true);
    }
    decodeStream(stream) {
      return this.decodeMultiAsync(stream, false);
    }
    async *decodeMultiAsync(stream, isArray) {
      if (this.entered) {
        const instance = this.clone();
        yield* instance.decodeMultiAsync(stream, isArray);
        return;
      }
      try {
        this.entered = true;
        let isArrayHeaderRequired = isArray;
        let arrayItemsLeft = -1;
        for await (const buffer of stream) {
          if (isArray && arrayItemsLeft === 0) {
            throw this.createExtraByteError(this.totalPos);
          }
          this.appendBuffer(buffer);
          if (isArrayHeaderRequired) {
            arrayItemsLeft = this.readArraySize();
            isArrayHeaderRequired = false;
            this.complete();
          }
          try {
            while (true) {
              yield this.doDecodeSync();
              if (--arrayItemsLeft === 0) {
                break;
              }
            }
          } catch (e) {
            if (!(e instanceof RangeError)) {
              throw e;
            }
          }
          this.totalPos += this.pos;
        }
      } finally {
        this.entered = false;
      }
    }
    doDecodeSync() {
      DECODE: while (true) {
        const headByte = this.readHeadByte();
        let object;
        if (headByte >= 224) {
          object = headByte - 256;
        } else if (headByte < 192) {
          if (headByte < 128) {
            object = headByte;
          } else if (headByte < 144) {
            const size = headByte - 128;
            if (size !== 0) {
              this.pushMapState(size);
              this.complete();
              continue DECODE;
            } else {
              object = {};
            }
          } else if (headByte < 160) {
            const size = headByte - 144;
            if (size !== 0) {
              this.pushArrayState(size);
              this.complete();
              continue DECODE;
            } else {
              object = [];
            }
          } else {
            const byteLength = headByte - 160;
            object = this.decodeString(byteLength, 0);
          }
        } else if (headByte === 192) {
          object = null;
        } else if (headByte === 194) {
          object = false;
        } else if (headByte === 195) {
          object = true;
        } else if (headByte === 202) {
          object = this.readF32();
        } else if (headByte === 203) {
          object = this.readF64();
        } else if (headByte === 204) {
          object = this.readU8();
        } else if (headByte === 205) {
          object = this.readU16();
        } else if (headByte === 206) {
          object = this.readU32();
        } else if (headByte === 207) {
          if (this.useBigInt64) {
            object = this.readU64AsBigInt();
          } else {
            object = this.readU64();
          }
        } else if (headByte === 208) {
          object = this.readI8();
        } else if (headByte === 209) {
          object = this.readI16();
        } else if (headByte === 210) {
          object = this.readI32();
        } else if (headByte === 211) {
          if (this.useBigInt64) {
            object = this.readI64AsBigInt();
          } else {
            object = this.readI64();
          }
        } else if (headByte === 217) {
          const byteLength = this.lookU8();
          object = this.decodeString(byteLength, 1);
        } else if (headByte === 218) {
          const byteLength = this.lookU16();
          object = this.decodeString(byteLength, 2);
        } else if (headByte === 219) {
          const byteLength = this.lookU32();
          object = this.decodeString(byteLength, 4);
        } else if (headByte === 220) {
          const size = this.readU16();
          if (size !== 0) {
            this.pushArrayState(size);
            this.complete();
            continue DECODE;
          } else {
            object = [];
          }
        } else if (headByte === 221) {
          const size = this.readU32();
          if (size !== 0) {
            this.pushArrayState(size);
            this.complete();
            continue DECODE;
          } else {
            object = [];
          }
        } else if (headByte === 222) {
          const size = this.readU16();
          if (size !== 0) {
            this.pushMapState(size);
            this.complete();
            continue DECODE;
          } else {
            object = {};
          }
        } else if (headByte === 223) {
          const size = this.readU32();
          if (size !== 0) {
            this.pushMapState(size);
            this.complete();
            continue DECODE;
          } else {
            object = {};
          }
        } else if (headByte === 196) {
          const size = this.lookU8();
          object = this.decodeBinary(size, 1);
        } else if (headByte === 197) {
          const size = this.lookU16();
          object = this.decodeBinary(size, 2);
        } else if (headByte === 198) {
          const size = this.lookU32();
          object = this.decodeBinary(size, 4);
        } else if (headByte === 212) {
          object = this.decodeExtension(1, 0);
        } else if (headByte === 213) {
          object = this.decodeExtension(2, 0);
        } else if (headByte === 214) {
          object = this.decodeExtension(4, 0);
        } else if (headByte === 215) {
          object = this.decodeExtension(8, 0);
        } else if (headByte === 216) {
          object = this.decodeExtension(16, 0);
        } else if (headByte === 199) {
          const size = this.lookU8();
          object = this.decodeExtension(size, 1);
        } else if (headByte === 200) {
          const size = this.lookU16();
          object = this.decodeExtension(size, 2);
        } else if (headByte === 201) {
          const size = this.lookU32();
          object = this.decodeExtension(size, 4);
        } else {
          throw new DecodeError(`Unrecognized type byte: ${prettyByte(headByte)}`);
        }
        this.complete();
        const stack = this.stack;
        while (stack.length > 0) {
          const state = stack.top();
          if (state.type === STATE_ARRAY) {
            state.array[state.position] = object;
            state.position++;
            if (state.position === state.size) {
              object = state.array;
              stack.release(state);
            } else {
              continue DECODE;
            }
          } else if (state.type === STATE_MAP_KEY) {
            if (object === "__proto__") {
              throw new DecodeError("The key __proto__ is not allowed");
            }
            state.key = this.mapKeyConverter(object);
            state.type = STATE_MAP_VALUE;
            continue DECODE;
          } else {
            state.map[state.key] = object;
            state.readCount++;
            if (state.readCount === state.size) {
              object = state.map;
              stack.release(state);
            } else {
              state.key = null;
              state.type = STATE_MAP_KEY;
              continue DECODE;
            }
          }
        }
        return object;
      }
    }
    readHeadByte() {
      if (this.headByte === HEAD_BYTE_REQUIRED) {
        this.headByte = this.readU8();
      }
      return this.headByte;
    }
    complete() {
      this.headByte = HEAD_BYTE_REQUIRED;
    }
    readArraySize() {
      const headByte = this.readHeadByte();
      switch (headByte) {
        case 220:
          return this.readU16();
        case 221:
          return this.readU32();
        default: {
          if (headByte < 160) {
            return headByte - 144;
          } else {
            throw new DecodeError(`Unrecognized array type byte: ${prettyByte(headByte)}`);
          }
        }
      }
    }
    pushMapState(size) {
      if (size > this.maxMapLength) {
        throw new DecodeError(`Max length exceeded: map length (${size}) > maxMapLengthLength (${this.maxMapLength})`);
      }
      this.stack.pushMapState(size);
    }
    pushArrayState(size) {
      if (size > this.maxArrayLength) {
        throw new DecodeError(`Max length exceeded: array length (${size}) > maxArrayLength (${this.maxArrayLength})`);
      }
      this.stack.pushArrayState(size);
    }
    decodeString(byteLength, headerOffset) {
      if (!this.rawStrings || this.stateIsMapKey()) {
        return this.decodeUtf8String(byteLength, headerOffset);
      }
      return this.decodeBinary(byteLength, headerOffset);
    }
    /**
     * @throws {@link RangeError}
     */
    decodeUtf8String(byteLength, headerOffset) {
      if (byteLength > this.maxStrLength) {
        throw new DecodeError(`Max length exceeded: UTF-8 byte length (${byteLength}) > maxStrLength (${this.maxStrLength})`);
      }
      if (this.bytes.byteLength < this.pos + headerOffset + byteLength) {
        throw MORE_DATA;
      }
      const offset = this.pos + headerOffset;
      let object;
      if (this.stateIsMapKey() && this.keyDecoder?.canBeCached(byteLength)) {
        object = this.keyDecoder.decode(this.bytes, offset, byteLength);
      } else {
        object = utf8Decode(this.bytes, offset, byteLength);
      }
      this.pos += headerOffset + byteLength;
      return object;
    }
    stateIsMapKey() {
      if (this.stack.length > 0) {
        const state = this.stack.top();
        return state.type === STATE_MAP_KEY;
      }
      return false;
    }
    /**
     * @throws {@link RangeError}
     */
    decodeBinary(byteLength, headOffset) {
      if (byteLength > this.maxBinLength) {
        throw new DecodeError(`Max length exceeded: bin length (${byteLength}) > maxBinLength (${this.maxBinLength})`);
      }
      if (!this.hasRemaining(byteLength + headOffset)) {
        throw MORE_DATA;
      }
      const offset = this.pos + headOffset;
      const object = this.bytes.subarray(offset, offset + byteLength);
      this.pos += headOffset + byteLength;
      return object;
    }
    decodeExtension(size, headOffset) {
      if (size > this.maxExtLength) {
        throw new DecodeError(`Max length exceeded: ext length (${size}) > maxExtLength (${this.maxExtLength})`);
      }
      const extType = this.view.getInt8(this.pos + headOffset);
      const data = this.decodeBinary(
        size,
        headOffset + 1
        /* extType */
      );
      return this.extensionCodec.decode(data, extType, this.context);
    }
    lookU8() {
      return this.view.getUint8(this.pos);
    }
    lookU16() {
      return this.view.getUint16(this.pos);
    }
    lookU32() {
      return this.view.getUint32(this.pos);
    }
    readU8() {
      const value = this.view.getUint8(this.pos);
      this.pos++;
      return value;
    }
    readI8() {
      const value = this.view.getInt8(this.pos);
      this.pos++;
      return value;
    }
    readU16() {
      const value = this.view.getUint16(this.pos);
      this.pos += 2;
      return value;
    }
    readI16() {
      const value = this.view.getInt16(this.pos);
      this.pos += 2;
      return value;
    }
    readU32() {
      const value = this.view.getUint32(this.pos);
      this.pos += 4;
      return value;
    }
    readI32() {
      const value = this.view.getInt32(this.pos);
      this.pos += 4;
      return value;
    }
    readU64() {
      const value = getUint64(this.view, this.pos);
      this.pos += 8;
      return value;
    }
    readI64() {
      const value = getInt64(this.view, this.pos);
      this.pos += 8;
      return value;
    }
    readU64AsBigInt() {
      const value = this.view.getBigUint64(this.pos);
      this.pos += 8;
      return value;
    }
    readI64AsBigInt() {
      const value = this.view.getBigInt64(this.pos);
      this.pos += 8;
      return value;
    }
    readF32() {
      const value = this.view.getFloat32(this.pos);
      this.pos += 4;
      return value;
    }
    readF64() {
      const value = this.view.getFloat64(this.pos);
      this.pos += 8;
      return value;
    }
  };

  // node_modules/@msgpack/msgpack/dist.esm/decode.mjs
  function decode(buffer, options) {
    const decoder = new Decoder(options);
    return decoder.decode(buffer);
  }

  // src/max-codec.js
  var MAX_BYTES = 32 * 1024 * 1024;
  var extensionCodec = new ExtensionCodec();
  extensionCodec.register({
    type: 1,
    decode: (bytes) => decode(bytes, { useBigInt64: true })
  });
  function decodeLz4Block(input, capacity) {
    if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > MAX_BYTES) {
      throw new Error("Invalid LZ4 capacity");
    }
    const output = new Uint8Array(capacity);
    let source = 0;
    let target = 0;
    const extendedLength = (initial) => {
      let length = initial;
      if (initial === 15) {
        let extra;
        do {
          if (source >= input.length) throw new Error("Truncated LZ4 length");
          extra = input[source++];
          length += extra;
          if (length > MAX_BYTES) throw new Error("LZ4 length exceeds limit");
        } while (extra === 255);
      }
      return length;
    };
    while (source < input.length) {
      const token = input[source++];
      const literals = extendedLength(token >>> 4);
      if (source + literals > input.length || target + literals > capacity) {
        throw new Error("Invalid LZ4 literals");
      }
      output.set(input.subarray(source, source + literals), target);
      source += literals;
      target += literals;
      if (source === input.length) break;
      if (source + 2 > input.length) throw new Error("Truncated LZ4 offset");
      const offset = input[source++] | input[source++] << 8;
      if (!offset || offset > target) throw new Error("Invalid LZ4 offset");
      const matches = extendedLength(token & 15) + 4;
      if (target + matches > capacity) throw new Error("Invalid LZ4 match length");
      for (let i = 0; i < matches; i++) output[target + i] = output[target + i - offset];
      target += matches;
    }
    return output.subarray(0, target);
  }
  function decodeMaxFrame(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    if (bytes.length < 10 || bytes.length > MAX_BYTES || bytes[0] !== 10) {
      throw new Error("Unsupported MAX frame header");
    }
    const view2 = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const length = bytes[7] << 16 | bytes[8] << 8 | bytes[9];
    if (length !== bytes.length - 10) throw new Error("MAX frame length mismatch");
    const factor = bytes[6];
    let payload = bytes.subarray(10);
    if (factor) payload = decodeLz4Block(payload, length * factor);
    return {
      command: bytes[1],
      sequence: view2.getInt16(2, false),
      opcode: view2.getInt16(4, false),
      payload: payload.length ? decode(payload, {
        useBigInt64: true,
        extensionCodec,
        mapKeyConverter: (key) => {
          if (typeof key === "bigint") return key.toString();
          if (typeof key === "string" || typeof key === "number") return key;
          throw new Error("Unsupported MAX map key");
        },
        maxStrLength: MAX_BYTES,
        maxBinLength: MAX_BYTES,
        maxArrayLength: 25e4,
        maxMapLength: 25e4
      }) : null
    };
  }
  function serverId(value) {
    if (typeof value === "string" && value && value.length <= 256) return value;
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
    return null;
  }

  // src/max-chat-route.js
  function maxChatIdFromPath(pathname) {
    return /^\/(-?[1-9]\d{0,19})(?:\/|$)/.exec(pathname)?.[1] ?? null;
  }

  // src/max-profile.js
  var modulePath = /^\/_app\/immutable\/chunks\/[A-Za-z0-9_-]{1,64}\.js$/;
  var exportName = /^[A-Za-z_$][A-Za-z0-9_$]{0,31}$/;
  var reservedExports = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
  function parseMaxProfile(value) {
    if (value?.schema !== 1 || typeof value.revision !== "string" || !/^[A-Za-z0-9._-]{1,48}$/.test(value.revision) || !Array.isArray(value.models) || value.models.length < 1 || value.models.length > 8) return null;
    const models = [];
    for (const model2 of value.models) {
      if (typeof model2?.module !== "string" || !modulePath.test(model2.module)) return null;
      const names = [model2.chat, model2.router, model2.viewer];
      if (!names.every((name) => typeof name === "string" && exportName.test(name) && !reservedExports.has(name))) return null;
      models.push({ module: model2.module, chat: model2.chat, router: model2.router, viewer: model2.viewer });
    }
    return { schema: 1, revision: value.revision, models };
  }

  // max-compat.json
  var max_compat_default = {
    schema: 1,
    revision: "2026-11-13.1",
    models: [
      { module: "/_app/immutable/chunks/uj-hx3bp.js", chat: "xc", router: "pi", viewer: "vc" },
      { module: "/_app/immutable/chunks/Df-WhMUd.js", chat: "yc", router: "fi", viewer: "gc" },
      { module: "/_app/immutable/chunks/Bi8ePAXH.js", chat: "yc", router: "fi", viewer: "gc" },
      { module: "/_app/immutable/chunks/DPMqYNCb.js", chat: "bc", router: "fi", viewer: "_c" }
    ]
  };

  // src/max-bridge.js
  var BRIDGE = "__MAXTRACKER_V3__";
  var model;
  var hubProfile = null;
  var selectedProfile;
  var connecting;
  var nextConnectionAt = 0;
  var lastSignature = "";
  var currentChat = null;
  var replyBeingDismissed = null;
  var bindingCounter = 0;
  var lastStatus = "";
  var rows = /* @__PURE__ */ new WeakMap();
  var counts = { frames: 0, decoded: 0, errors: 0, ids: 0 };
  var emit = (type, data = {}) => window.postMessage({ source: BRIDGE, version: 3, type, ...data }, location.origin);
  var status = (ok, detail) => {
    const key = `${ok}:${detail}`;
    if (key !== lastStatus) {
      lastStatus = key;
      emit("DIAGNOSTIC", { ok, detail });
    }
  };
  function chatInfo(chat, chatId) {
    return {
      chatId,
      chatTitle: chat.title || chat.$.title || (chatId === "0" ? "\u0418\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0435" : ""),
      canTrack: chatId !== "0" && ["CHAT", "CHANNEL"].includes(chat.$.type)
    };
  }
  function messageInfo(chat, message) {
    if (!message?.$ || !serverId(message.$.id)) return null;
    const chatId = serverId(chat.$.id);
    const messageId = serverId(message.$.id);
    if (!chatId || !messageId || serverId(message.id) !== messageId) return null;
    const authorId = serverId(message.$.sender) || "";
    let authorName = "";
    try {
      authorName = message.sender?.fullName || "";
    } catch {
    }
    return {
      ...chatInfo(chat, chatId),
      messageId,
      authorId,
      authorName,
      requestText: message.text?.plain || "",
      requestTime: Number(message.time) || 0,
      hasAttachment: !!message.$.attaches?.length,
      isOut: message.isOut === true
    };
  }
  function modelFromExports(loaded, spec) {
    const getter = Object.getOwnPropertyDescriptor(loaded[spec.chat]?.prototype || {}, "chat")?.get;
    const router = loaded[spec.router];
    const viewer = loaded[spec.viewer];
    if (!getter || typeof router?.openChat !== "function" || !("main" in router) || typeof viewer?.get !== "function") return null;
    const getterSource = Function.prototype.toString.call(getter);
    if (!/^get\s+chat\s*\(\s*\)\s*\{\s*return\s+[\w$]+\.chats\.get\(this\.chatId\)\s*;?\s*\}$/.test(getterSource)) return null;
    const main = router.main;
    if (main?.kind === "chat") {
      const chat = getter.call({ chatId: main.chatId });
      const id = serverId(main.chatId);
      if (!id || serverId(chat?.id) !== id || serverId(chat?.$?.id) !== id || !Array.isArray(chat.messages) || !Array.isArray(chat.pendingQueue?.messages) || !chat.draft) return null;
    }
    return { router, viewer, getChat: getter, spec: JSON.stringify(spec) };
  }
  function connectModel() {
    if (connecting) return connecting;
    if (Date.now() < nextConnectionAt) return;
    const profile = hubProfile;
    nextConnectionAt = Date.now() + 1e3;
    connecting = (async () => {
      const resources = new Set(performance.getEntriesByType("resource").map((entry) => entry.name));
      const candidates = [...profile?.models || [], ...max_compat_default.models];
      for (const spec of candidates) {
        const url = new URL(spec.module, location.origin).href;
        if (!resources.has(url)) continue;
        if (model?.spec === JSON.stringify(spec)) {
          selectedProfile = profile;
          return;
        }
        try {
          const loaded = await import(
            /* @vite-ignore */
            url
          );
          if (profile !== hubProfile) return;
          const candidate = modelFromExports(loaded, spec);
          if (!candidate) continue;
          model = candidate;
          selectedProfile = profile;
          lastSignature = "";
          status(true, "\u0421\u0435\u0440\u0432\u0435\u0440\u043D\u0430\u044F \u043C\u043E\u0434\u0435\u043B\u044C MAX \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0430");
          return;
        } catch {
        }
      }
      if (model) selectedProfile = profile;
    })().finally(() => {
      connecting = null;
      if (profile !== hubProfile) nextConnectionAt = 0;
    });
    return connecting;
  }
  function view() {
    if (!model || selectedProfile !== hubProfile) void connectModel();
    currentChat = null;
    if (!model) return;
    const main = model.router.main;
    if (main?.kind !== "chat") {
      currentChat = null;
      if (lastSignature !== "no-chat") {
        lastSignature = "no-chat";
        emit("VIEW", { chatId: null, reply: null, bindings: [] });
      }
      return;
    }
    try {
      const chat = model.getChat.call({ chatId: main.chatId });
      const chatId = serverId(chat.$.id);
      if (!chatId || serverId(chat.id) !== chatId || serverId(main.chatId) !== chatId) return;
      const openedChat = chatInfo(chat, chatId);
      const roots = [...document.querySelectorAll(".history[data-scale]")].filter((root) => root.getClientRects().length > 0);
      if (chat.isOpened !== true || roots.length !== 1) {
        currentChat = null;
        const signature2 = JSON.stringify(["transition", chatId, openedChat]);
        if (lastSignature !== signature2) {
          lastSignature = signature2;
          for (const row of document.querySelectorAll("[data-maxtracker-locator]")) row.removeAttribute("data-maxtracker-locator");
          emit("VIEW", { chatId, openedChat, reply: null, bindings: [] });
        }
        return;
      }
      currentChat = chat;
      const items = [...chat.messages, ...chat.pendingQueue.messages];
      const bindings = [];
      for (const row of roots[0].querySelectorAll("[data-index]")) {
        if (row.closest(".history[data-scale]") !== roots[0]) continue;
        const wrapper = row.querySelector(".messageWrapper");
        if (!wrapper || row.closest("[data-maxtracker-ui]")) continue;
        const index = Number(row.getAttribute("data-index"));
        if (!Number.isInteger(index) || index < 0) continue;
        const info = messageInfo(chat, items[index]);
        if (!info) {
          row.removeAttribute("data-maxtracker-locator");
          continue;
        }
        let binding = rows.get(row);
        if (!binding || binding.chatId !== info.chatId || binding.messageId !== info.messageId) {
          binding = { chatId: info.chatId, messageId: info.messageId, locator: `mta-${++bindingCounter}` };
          rows.set(row, binding);
          row.setAttribute("data-maxtracker-locator", binding.locator);
        }
        if (row.getAttribute("data-maxtracker-locator") !== binding.locator) row.setAttribute("data-maxtracker-locator", binding.locator);
        bindings.push({ ...info, locator: binding.locator });
      }
      const replyId = serverId(chat.draft?.replyTo);
      const replyModel = replyId ? chat.messages.find((m) => serverId(m.id) === replyId) : null;
      const reply = replyModel ? messageInfo(chat, replyModel) : null;
      const dismissedReply = replyBeingDismissed?.chatId === chatId && replyBeingDismissed.messageId !== replyId ? replyBeingDismissed : null;
      if (dismissedReply) replyBeingDismissed = null;
      const signature = JSON.stringify([openedChat, replyId, bindings]);
      if (signature !== lastSignature || dismissedReply) {
        lastSignature = signature;
        emit("VIEW", { chatId, openedChat, reply, replyId, bindings, dismissedReply });
      }
    } catch {
      status(false, "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0442\u043E\u0447\u043D\u043E \u0441\u0432\u044F\u0437\u0430\u0442\u044C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F \u0441 \u043C\u043E\u0434\u0435\u043B\u044C\u044E MAX");
    }
  }
  async function rawBytes(data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    return null;
  }
  function capture(data, requestContexts, incoming) {
    return rawBytes(data).then((bytes) => {
      if (!bytes) return;
      const f = decodeMaxFrame(bytes);
      const p = f.payload;
      if (!incoming) {
        if (f.opcode === 49) requestContexts.set(f.sequence, serverId(p?.chatId));
        return;
      }
      counts.frames++;
      counts.decoded++;
      const chatId = serverId(p?.chatId) || (f.opcode === 49 ? requestContexts.get(f.sequence) : null);
      if (chatId && (p?.messages || p?.message)) {
        const messages = Array.isArray(p.messages) ? p.messages : [p.message];
        const identities = messages.filter((m) => serverId(m?.id)).map((m) => ({ chatId, messageId: serverId(m.id) }));
        counts.ids += identities.length;
        emit("SERVER_IDS", { identities });
      }
      if (f.opcode === 64 && chatId && p?.message?.link?.type === "REPLY") {
        let viewerId;
        try {
          viewerId = serverId(model?.viewer.get().contactId);
        } catch {
          return;
        }
        const message = p.message;
        if (!viewerId || serverId(message.sender) !== viewerId) return;
        const target = serverId(message.link.message?.id);
        const sentId = serverId(message.id);
        if (target && sentId) emit("SENT_REPLY", {
          chatId,
          messageId: target,
          sentMessageId: sentId,
          replyText: typeof message.text === "string" ? message.text : message.text?.plain || ""
        });
      }
    });
  }
  var NativeWebSocket = window.WebSocket;
  window.WebSocket = new Proxy(NativeWebSocket, {
    construct(target, args, newTarget) {
      const socket = Reflect.construct(target, args, newTarget);
      let host;
      try {
        host = new URL(String(args[0]), location.href).hostname;
      } catch {
        return socket;
      }
      if (host !== "api.oneme.ru") return socket;
      const contexts = /* @__PURE__ */ new Map();
      let incoming = Promise.resolve();
      socket.addEventListener("message", (event) => {
        incoming = incoming.then(() => capture(event.data, contexts, true)).catch(() => {
          counts.errors++;
        });
      });
      const send = socket.send;
      socket.send = function(data) {
        void capture(data, contexts, false).catch(() => {
        });
        return Reflect.apply(send, this, arguments);
      };
      return socket;
    }
  });
  var delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  document.addEventListener("click", (event) => {
    if (!event.isTrusted) return;
    const element = event.target instanceof Element ? event.target : null;
    const button = element?.closest("button");
    if (!button?.closest('[data-testid="composer"]')) return;
    const isClose = button.classList.contains("close") || /закрыть|отменить ответ/i.test(`${button.getAttribute("aria-label") || ""} ${button.title || ""}`) || button.querySelector('use[href*="cross"],use[href*="close"],use[href*="cancel"]');
    if (!isClose) return;
    view();
    const target = { chatId: serverId(currentChat?.$.id), messageId: serverId(currentChat?.draft?.replyTo) };
    if (!target.chatId || !target.messageId) return;
    replyBeingDismissed = target;
    setTimeout(() => {
      if (replyBeingDismissed !== target) return;
      view();
      if (replyBeingDismissed === target) replyBeingDismissed = null;
    }, 0);
  }, true);
  async function clearReply(expected) {
    if (expected) {
      view();
      if (serverId(currentChat?.id) !== expected.chatId || serverId(currentChat?.draft?.replyTo) !== expected.messageId) return;
    }
    const composer = document.querySelector('[data-testid="composer"]');
    if (!composer) return;
    const button = [...composer.querySelectorAll("button")].find((b) => /закрыть|отменить ответ/i.test(`${b.getAttribute("aria-label") || ""} ${b.title || ""}`) || b.querySelector('use[href*="close"], use[href*="cancel"], use[href*="cross"]'));
    if (button) button.click();
    else {
      const editor = composer.querySelector('[role="textbox"]');
      editor?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
    }
    await delay(0);
    view();
  }
  async function openTarget(data) {
    if (!model || !data.target?.chatId || !data.target?.messageId) throw Error("\u041C\u043E\u0434\u0435\u043B\u044C MAX \u0435\u0449\u0435 \u043D\u0435 \u0433\u043E\u0442\u043E\u0432\u0430");
    const target = data.target;
    const chatId = BigInt(target.chatId);
    const messageId = BigInt(target.messageId);
    await model.router.openChat(chatId, { id: messageId, time: target.requestTime }, { highlight: false });
    for (let i = 0; i < 60; i++) {
      view();
      const row = [...document.querySelectorAll(".history [data-index]")].find((el) => {
        const binding = rows.get(el);
        return binding?.chatId === target.chatId && binding.messageId === target.messageId && el.getAttribute("data-maxtracker-locator") === binding.locator;
      });
      if (row) {
        row.scrollIntoView({ block: "center" });
        if (data.resume) {
          row.querySelector(".block")?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
          await delay(100);
          if (serverId(currentChat?.draft?.replyTo) !== target.messageId) throw Error("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \xAB\u041E\u0442\u0432\u0435\u0442\u0438\u0442\u044C\xBB \u043D\u0430 \u0432\u044B\u0434\u0435\u043B\u0435\u043D\u043D\u043E\u043C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0438");
        }
        return;
      }
      await delay(100);
    }
    throw Error("\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u043F\u043E\u043A\u0430 \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u043E \u0438\u043B\u0438 \u0447\u0430\u0442 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D");
  }
  async function resolveReply(expected) {
    const deadline = performance.now() + 1400;
    let routeId = expected?.chatId || null;
    do {
      if (!model || selectedProfile !== hubProfile) await connectModel();
      view();
      const main = model?.router.main;
      const currentRoute = main?.kind === "chat" ? serverId(main.chatId) : null;
      if (routeId && currentRoute && currentRoute !== routeId) return null;
      routeId ||= currentRoute;
      const replyId = serverId(currentChat?.draft?.replyTo);
      if (replyId && (!expected || replyId === expected.messageId)) {
        const message = currentChat.messages.find((item) => serverId(item.id) === replyId);
        const reply = message && messageInfo(currentChat, message);
        if (reply && reply.chatId === routeId) return reply;
      }
      await delay(50);
    } while (performance.now() < deadline);
    if (!model) throw Error("\u042D\u0442\u0430 \u0441\u0431\u043E\u0440\u043A\u0430 MAX \u0442\u0440\u0435\u0431\u0443\u0435\u0442 \u043F\u0440\u043E\u0444\u0438\u043B\u044F \u0441\u043E\u0432\u043C\u0435\u0441\u0442\u0438\u043C\u043E\u0441\u0442\u0438. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u043A \u0445\u0430\u0431\u0443.");
    return null;
  }
  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== BRIDGE || event.data.version !== 3) return;
    const data = event.data;
    if (data.type === "MAX_PROFILE") {
      const profile = data.profile === null ? null : parseMaxProfile(data.profile);
      if (data.profile !== null && !profile) return;
      if (JSON.stringify(profile) === JSON.stringify(hubProfile)) return;
      hubProfile = profile;
      nextConnectionAt = 0;
      void connectModel();
      return;
    }
    if (data.type === "READY") {
      lastSignature = "";
      view();
      emit("DIAGNOSTIC_STATS", { counts: { ...counts } });
    }
    if (data.type !== "ACTION" || typeof data.requestId !== "string") return;
    try {
      if (data.action === "CLEAR_REPLY") await clearReply(data.target);
      else if (data.action === "OPEN_TARGET") await openTarget(data);
      else if (data.action === "CHECK_OPEN_CHAT") {
        const main = model?.router.main;
        const modelChatId = main?.kind === "chat" ? serverId(main.chatId) : null;
        const pathChatId = maxChatIdFromPath(location.pathname);
        if (!modelChatId && !pathChatId || modelChatId && modelChatId !== data.chatId || pathChatId && pathChatId !== data.chatId) {
          throw Error("\u0427\u0430\u0442 \u0441\u043C\u0435\u043D\u0438\u043B\u0441\u044F. \u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0435\u0433\u043E \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443 \u0435\u0449\u0451 \u0440\u0430\u0437.");
        }
      } else if (data.action === "RESOLVE_REPLY") {
        const reply = await resolveReply(data.expected);
        emit("ACTION_RESULT", { requestId: data.requestId, ok: true, reply });
        return;
      } else throw Error("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435");
      emit("ACTION_RESULT", { requestId: data.requestId, ok: true });
    } catch (error) {
      emit("ACTION_RESULT", { requestId: data.requestId, ok: false, error: error.message });
    }
  });
  setInterval(view, 150);
  setTimeout(() => {
    if (!model) status(false, "\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0447\u0430\u0442. \u0415\u0441\u043B\u0438 \u0432\u0435\u0440\u0441\u0438\u044F MAX \u0438\u0437\u043C\u0435\u043D\u0438\u043B\u0430\u0441\u044C, \u043F\u043E\u0442\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u043E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0430\u0434\u0430\u043F\u0442\u0435\u0440.");
  }, 15e3);
  view();
})();
