const fs = require('fs');
const path = require('path');

// Fast GIF89a generator for 640x320 with 50px top/bottom padding
const width = 640;
const height = 320;
const numFrames = 8;
const outPath = path.join(__dirname, 'assets', 'social-preview.gif');

fs.mkdirSync(path.dirname(outPath), { recursive: true });

const palette = [];
// 16 color palette
palette.push(15, 23, 42);   // 0: dark bg
palette.push(30, 27, 75);   // 1: mid purple
palette.push(49, 16, 66);   // 2: dark magenta
palette.push(56, 189, 248); // 3: bright cyan
palette.push(129, 140, 248);// 4: indigo accent
palette.push(192, 132, 252);// 5: purple text
palette.push(74, 222, 128); // 6: green checkmark
palette.push(248, 250, 252);// 7: white text
palette.push(51, 65, 85);   // 8: slate pill
palette.push(20, 30, 55);   // 9: dark border
palette.push(255, 255, 255);// 10: pure white
for (let i = palette.length; i < 768; i++) palette.push(0);

const header = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
  width & 0xff, (width >> 8) & 0xff,
  height & 0xff, (height >> 8) & 0xff,
  0xf3, 0, 0 // Global palette (16 colors = 2^(3+1))
]);

const paletteBuf = Buffer.from(palette.slice(0, 48)); // 16 * 3 bytes
const loopExt = Buffer.from([
  0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 0x03, 0x01, 0x00, 0x00, 0x00
]);

const frames = [];

for (let frameIdx = 0; frameIdx < numFrames; frameIdx++) {
  const pixels = new Uint8Array(width * height);
  const shift = Math.floor((frameIdx / numFrames) * 20);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      // 50px Padding top & bottom
      if (y < 50 || y >= 270) {
        pixels[idx] = 0; // Dark bg
        continue;
      }
      
      // Inside Banner Area (y: 50 to 270)
      if (x >= 40 && x <= 200 && y >= 70 && y <= 95) {
        pixels[idx] = 8; // Slate Pill
      } else if (x >= 40 && x <= 450 && y >= 115 && y <= 155) {
        pixels[idx] = ((x + shift) % 40 < 20) ? 3 : 4; // Animated Cyan/Indigo Title
      } else if (x >= 40 && x <= 350 && y >= 170 && y <= 190) {
        pixels[idx] = 7; // White Subtitle
      } else if (x >= 480 && x <= 580 && y >= 80 && y <= 240) {
        // Shield graphic
        const dx = x - 530;
        const dy = y - 160;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 35 && dist < 45) {
          pixels[idx] = ((y + shift) % 20 < 10) ? 4 : 5; // Animated Shield Outline
        } else if (dist <= 35) {
          pixels[idx] = 1; // Shield fill
        } else {
          pixels[idx] = 2;
        }
      } else {
        pixels[idx] = (x % 100 < 50) ? 0 : 1;
      }
    }
  }

  // Fast LZW compressor for 16-color palette (min code size = 4)
  const minCodeSize = 4;
  const clearCode = 16;
  const eofCode = 17;
  const lzwOut = [];
  
  let bitBuf = 0;
  let bitCnt = 0;
  let codeSize = 5;
  let nextCode = 18;
  const dict = new Map();

  function resetDict() {
    dict.clear();
    for (let i = 0; i < 16; i++) dict.set(String(i), i);
    codeSize = 5;
    nextCode = 18;
  }

  function writeBits(code, size) {
    bitBuf |= (code << bitCnt);
    bitCnt += size;
    while (bitCnt >= 8) {
      lzwOut.push(bitBuf & 0xff);
      bitBuf >>= 8;
      bitCnt -= 8;
    }
  }

  resetDict();
  writeBits(clearCode, codeSize);

  let curStr = String(pixels[0]);
  for (let i = 1; i < pixels.length; i++) {
    const nextChar = String(pixels[i]);
    const comb = curStr + ',' + nextChar;
    if (dict.has(comb)) {
      curStr = comb;
    } else {
      writeBits(dict.get(curStr), codeSize);
      if (nextCode < 4096) {
        dict.set(comb, nextCode++);
        if (nextCode === (1 << codeSize) + 1 && codeSize < 12) {
          codeSize++;
        }
      } else {
        writeBits(clearCode, codeSize);
        resetDict();
      }
      curStr = nextChar;
    }
  }
  writeBits(dict.get(curStr), codeSize);
  writeBits(eofCode, codeSize);
  if (bitCnt > 0) lzwOut.push(bitBuf & 0xff);

  const subBlocks = [];
  for (let i = 0; i < lzwOut.length; i += 255) {
    const chunk = lzwOut.slice(i, i + 255);
    subBlocks.push(chunk.length, ...chunk);
  }
  subBlocks.push(0);

  const gce = Buffer.from([0x21, 0xf9, 0x04, 0x00, 15, 0, 0x00, 0x00]); // 150ms delay
  const imgDesc = Buffer.from([0x2c, 0, 0, 0, 0, width & 0xff, (width >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff, 0x00]);
  const lzwHeader = Buffer.from([minCodeSize]);
  const lzwData = Buffer.from(subBlocks);

  frames.push(Buffer.concat([gce, imgDesc, lzwHeader, lzwData]));
}

const trailer = Buffer.from([0x3b]);
const finalGif = Buffer.concat([header, paletteBuf, loopExt, ...frames, trailer]);
fs.writeFileSync(outPath, finalGif);
console.log(`GIF generated at ${outPath}! Size: ${finalGif.length} bytes`);
