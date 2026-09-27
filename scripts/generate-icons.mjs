// Genera los iconos de MusicSense a partir de assets/icon.svg.
// Uso: pnpm exec electron scripts/generate-icons.mjs
// Usa el propio Electron para dibujar el SVG (sin dependencias nuevas):
// - assets/icon.png (512 px) y assets/generated/icons/png/<n>x<n>.png
// - assets/generated/icons/win/icon.ico (16–256 px, imágenes PNG dentro)
// - assets/generated/icons/mac/icon.icon/Assets/SVG Image.svg
import { app, BrowserWindow } from 'electron';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const svg = readFileSync(join(root, 'assets/icon.svg'), 'utf8');
const pngDir = join(root, 'assets/generated/icons/png');
const winDir = join(root, 'assets/generated/icons/win');
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

// ICO con imágenes PNG (válido desde Windows Vista)
const buildIco = (images) => {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
};

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 1024,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  await win.loadURL('about:blank');

  const render = async (size) => {
    /** @type {string} */
    const dataUrl = String(
      await win.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = ${size};
          canvas.height = ${size};
          const context = canvas.getContext('2d');
          context.imageSmoothingQuality = 'high';
          context.drawImage(image, 0, 0, ${size}, ${size});
          resolve(canvas.toDataURL('image/png'));
        };
        image.onerror = reject;
        image.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
      })
    `),
    );
    return Buffer.from(dataUrl.split(',')[1], 'base64');
  };

  mkdirSync(pngDir, { recursive: true });
  mkdirSync(winDir, { recursive: true });
  const images = [];
  for (const size of sizes) {
    const data = await render(size);
    writeFileSync(join(pngDir, `${size}x${size}.png`), data);
    if (size <= 256) images.push({ size, data });
    console.log('png', size);
  }
  writeFileSync(join(winDir, 'icon.ico'), buildIco(images));
  copyFileSync(join(pngDir, '512x512.png'), join(root, 'assets/icon.png'));
  copyFileSync(
    join(root, 'assets/icon.svg'),
    join(root, 'assets/generated/icons/mac/icon.icon/Assets/SVG Image.svg'),
  );
  console.log('ico + icon.png listos');
  app.quit();
});
