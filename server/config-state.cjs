const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

let electron = null;
try {
  electron = require('electron');
} catch (_) {
  // Running in pure Node mode without Electron
}

const ROOT_DIR = path.resolve(__dirname, '..');
const BRAIN_DIR = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
const AGENTAPI_BAT = path.join(os.homedir(), '.gemini', 'antigravity', 'bin', 'agentapi.bat');
const PORT = 17890;

// Watchdog & Control State
const runtimeState = {
  selectedConvId: 'auto' // 'auto' or specific UUID
};

const watchdogHistory = new Map(); // convId -> { wakeupCount, lastWakeupTime }
const manuallyStoppedConvs = new Map(); // convId -> { stepIndex, stoppedAtMs }

// Generate a valid 32x32 RGBA PNG buffer in pure Node.js for the Windows System Tray icon
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xff];
  }
  return (c ^ -1) >>> 0;
}

function makePngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createTrayPngBuffer(ringColor = [34, 211, 238], dotColor = [16, 185, 129]) {
  const width = 32;
  const height = 32;
  const rawData = Buffer.alloc(height * (1 + width * 4));

  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    rawData[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const dx = x - 15.5;
      const dy = y - 15.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const px = rowStart + 1 + x * 4;

      if (dist <= 14.0 && dist >= 9.0) {
        rawData[px] = ringColor[0];
        rawData[px + 1] = ringColor[1];
        rawData[px + 2] = ringColor[2];
        rawData[px + 3] = 255;
      } else if (dist < 9.0) {
        if (dist <= 4.2) {
          rawData[px] = dotColor[0];
          rawData[px + 1] = dotColor[1];
          rawData[px + 2] = dotColor[2];
          rawData[px + 3] = 255;
        } else {
          rawData[px] = 13;
          rawData[px + 1] = 19;
          rawData[px + 2] = 34;
          rawData[px + 3] = 245;
        }
      } else {
        rawData[px] = 0;
        rawData[px + 1] = 0;
        rawData[px + 2] = 0;
        rawData[px + 3] = 0;
      }
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const compressed = zlib.deflateSync(rawData);
  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0))
  ]);
}

module.exports = {
  electron,
  ROOT_DIR,
  BRAIN_DIR,
  AGENTAPI_BAT,
  PORT,
  runtimeState,
  watchdogHistory,
  manuallyStoppedConvs,
  createTrayPngBuffer
};
