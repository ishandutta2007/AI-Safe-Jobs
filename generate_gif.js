const fs = require('fs');
const path = require('path');

// Minimal pure JS GIF Encoder (GIF89a)
function createGifEncoder(width, height) {
  const frames = [];

  function addFrame(rgbaBuffer, delay = 10) {
    // Quantize 32-bit RGBA to 256-color palette (simple uniform quantization)
    const palette = [];
    const colorMap = new Map();
    const indexedPixels = new Uint8Array(width * height);

    // Reserved background/black
    palette.push(0, 0, 0);
    colorMap.set('0,0,0', 0);

    for (let i = 0; i < width * height; i++) {
      const r = rgbaBuffer[i * 4];
      const g = rgbaBuffer[i * 4 + 1];
      const b = rgbaBuffer[i * 4 + 2];
      
      // Quantize 8-bit to 3-bit R/G, 2-bit B (256 colors)
      const qr = (r >> 5) << 5;
      const qg = (g >> 5) << 5;
      const qb = (b >> 6) << 6;
      const key = `${qr},${qg},${qb}`;

      let idx = colorMap.get(key);
      if (idx === undefined) {
        if (palette.length < 256 * 3) {
          idx = palette.length / 3;
          palette.push(qr, qg, qb);
          colorMap.set(key, idx);
        } else {
          idx = 0; // Fallback
        }
      }
      indexedPixels[i] = idx;
    }

    // Pad palette to 256 colors (768 bytes)
    while (palette.length < 768) {
      palette.push(0);
    }

    frames.push({ indexedPixels, palette, delay });
  }

  function LZWEncode(pixels, minCodeSize) {
    const out = [];
    const clearCode = 1 << minCodeSize;
    const eofCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let nextCode = eofCode + 1;

    // Dictionary maps string of byte indices to code
    let dict = new Map();
    function resetDict() {
      dict.clear();
      for (let i = 0; i < clearCode; i++) {
        dict.set(String(i), i);
      }
      codeSize = minCodeSize + 1;
      nextCode = eofCode + 1;
    }

    resetDict();

    let bitBuf = 0;
    let bitCnt = 0;
    function writeBits(code, size) {
      bitBuf |= (code << bitCnt);
      bitCnt += size;
      while (bitCnt >= 8) {
        out.push(bitBuf & 0xff);
        bitBuf >>= 8;
        bitCnt -= 8;
      }
    }

    writeBits(clearCode, codeSize);

    let currentStr = String(pixels[0]);
    for (let i = 1; i < pixels.length; i++) {
      const nextChar = String(pixels[i]);
      const combined = currentStr + ',' + nextChar;
      if (dict.has(combined)) {
        currentStr = combined;
      } else {
        writeBits(dict.get(currentStr), codeSize);
        if (nextCode < 4096) {
          dict.set(combined, nextCode++);
          if (nextCode === (1 << codeSize) + 1 && codeSize < 12) {
            codeSize++;
          }
        } else {
          writeBits(clearCode, codeSize);
          resetDict();
        }
        currentStr = nextChar;
      }
    }
    writeBits(dict.get(currentStr), codeSize);
    writeBits(eofCode, codeSize);
    if (bitCnt > 0) {
      out.push(bitBuf & 0xff);
    }

    // Package into GIF sub-blocks (max 255 bytes per sub-block)
    const subBlocks = [];
    for (let i = 0; i < out.length; i += 255) {
      const chunk = out.slice(i, i + 255);
      subBlocks.push(chunk.length, ...chunk);
    }
    subBlocks.push(0); // Terminating block
    return subBlocks;
  }

  function getBuffer() {
    const bytes = [];
    // GIF89a Header
    bytes.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // GIF89a
    // Logical Screen Descriptor
    bytes.push(width & 0xff, (width >> 8) & 0xff);
    bytes.push(height & 0xff, (height >> 8) & 0xff);
    bytes.push(0xf7, 0, 0); // Global Palette flag, 256 colors

    // Global Color Table (use frame 0 palette)
    bytes.push(...frames[0].palette);

    // Netscape Application Extension for Looping
    bytes.push(0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 0x03, 0x01, 0x00, 0x00, 0x00);

    // Add Frames
    for (const frame of frames) {
      // Graphics Control Extension
      bytes.push(0x21, 0xf9, 0x04, 0x00, frame.delay & 0xff, (frame.delay >> 8) & 0xff, 0x00, 0x00);
      // Image Descriptor
      bytes.push(0x2c, 0, 0, 0, 0, width & 0xff, (width >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff, 0x00);
      // LZW Minimum Code Size
      bytes.push(8);
      // LZW Data
      const lzwData = LZWEncode(frame.indexedPixels, 8);
      bytes.push(...lzwData);
    }

    bytes.push(0x3b); // GIF Trailer
    return Buffer.from(bytes);
  }

  return { addFrame, getBuffer };
}

// Generate 640x320 GIF frames with 50px top & bottom padding
// Content height: 320 - 100 = 220px (y: 50 to 270)
const WIDTH = 640;
const HEIGHT = 320;
const encoder = createGifEncoder(WIDTH, HEIGHT);

const NUM_FRAMES = 12;

for (let frameIdx = 0; frameIdx < NUM_FRAMES; frameIdx++) {
  const buf = new Uint8Array(WIDTH * HEIGHT * 4);
  const t = frameIdx / NUM_FRAMES;

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const idx = (y * WIDTH + x) * 4;

      // Top & Bottom 50px Padding Area (Dark Slate Background)
      if (y < 50 || y >= 270) {
        buf[idx] = 15;     // R
        buf[idx + 1] = 23; // G
        buf[idx + 2] = 42; // B
        buf[idx + 3] = 255;
        continue;
      }

      // Banner Content Area (y: 50 to 270)
      const relY = y - 50; // 0 to 220
      const normY = relY / 220;
      const normX = x / WIDTH;

      // Dynamic Gradient Background (#0f172a to #1e1b4b to #311042)
      let r = 15 + normX * 30 + Math.sin(t * Math.PI * 2) * 10;
      let g = 23 + normY * 15;
      let b = 42 + normX * 40 + normY * 30;

      // Draw Glowing Shield Outline in right section (x ~ 480 to 580, y ~ 80 to 240)
      const shieldCenterX = 520 + Math.sin(t * Math.PI * 2) * 5;
      const shieldCenterY = 160 + Math.cos(t * Math.PI * 2) * 5;
      const dx = x - shieldCenterX;
      const dy = y - shieldCenterY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 40 && dist < 55) {
        // Shield Ring Glow
        r = 129 + Math.sin(t * Math.PI * 2 + normX) * 40;
        g = 140;
        b = 248;
      }

      // Draw Text Banner Silhouette / Title Box (Left side x: 40 to 400, y: 110 to 190)
      if (x >= 50 && x <= 420 && y >= 110 && y <= 180) {
        if (y >= 110 && y <= 120) {
          // Pill Header
          if (x >= 50 && x <= 220) {
            r = 56; g = 189; b = 248; // Bright cyan
          }
        } else if (y >= 135 && y <= 170) {
          // Title Text "AI-SAFE JOBS" Accent
          const charPulse = Math.sin(t * Math.PI * 2 + x * 0.05);
          r = 129 + charPulse * 30;
          g = 140 + charPulse * 30;
          b = 248;
        }
      }

      buf[idx] = Math.min(255, Math.max(0, Math.round(r)));
      buf[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      buf[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      buf[idx + 3] = 255;
    }
  }

  encoder.addFrame(buf, 15); // ~150ms per frame
}

const gifBuffer = encoder.getBuffer();
const outPath = path.join(__dirname, 'assets', 'social-preview.gif');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, gifBuffer);

console.log(`Generated ${outPath} successfully! Size: ${gifBuffer.length} bytes`);
