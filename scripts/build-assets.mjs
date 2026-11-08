import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const master = resolve(root, 'resources/logo-evren.png');

if (!existsSync(master)) {
  console.error(`Kaynak logo bulunamadı: ${master}`);
  process.exit(1);
}

// 1. Çoklu çözünürlük ICO oluşturucu (standart PNG paketleyici)
function createIco(images) {
  const num = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Rezerve
  header.writeUInt16LE(1, 2); // 1 = ICO türü
  header.writeUInt16LE(num, 4); // Resim sayısı

  let offset = 6 + num * 16;
  const dirEntries = [];
  for (const { width, height, buf } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(width >= 256 ? 0 : width, 0);
    entry.writeUInt8(height >= 256 ? 0 : height, 1);
    entry.writeUInt8(0, 2); // Renk paleti
    entry.writeUInt8(0, 3); // Rezerve
    entry.writeUInt16LE(1, 4); // Renk düzlemleri
    entry.writeUInt16LE(32, 6); // Piksel başına bit
    entry.writeUInt32LE(buf.length, 8); // Bayt boyutu
    entry.writeUInt32LE(offset, 12); // Dosya başından ofset
    dirEntries.push(entry);
    offset += buf.length;
  }

  return Buffer.concat([header, ...dirEntries, ...images.map((i) => i.buf)]);
}

// 2. Hedef PNG dosyaları ve çözünürlükleri
const targets = [
  { path: 'resources/icon-1024.png', size: 1024 },
  { path: 'resources/logo.png', size: 900 },
  { path: 'resources/logo-dark.png', size: 900 },
  { path: 'resources/logo-safe.png', size: 900 },
  { path: 'resources/icon-512.png', size: 512 },
  { path: 'resources/icon-256.png', size: 256 },
  { path: 'resources/icon.png', size: 128 },
  { path: 'resources/favicon-180.png', size: 180 },
  { path: 'resources/favicon-64.png', size: 64 },
  { path: 'resources/favicon-48.png', size: 48 },
  { path: 'resources/favicon-32.png', size: 32 },
  { path: 'resources/favicon-16.png', size: 16 },
  { path: 'webview-ui/public/favicon_180x180.png', size: 180 },
  { path: 'webview-ui/public/favicon_32x32.png', size: 32 },
  { path: 'webview-ui/public/favicon_16x16.png', size: 16 }
];

console.log('Kaynak amblemden türetiliyor: resources/logo-evren.png');
for (const target of targets) {
  const outPath = resolve(root, target.path);
  execFileSync('sips', ['-z', String(target.size), String(target.size), master, '--out', outPath], {
    stdio: 'ignore'
  });
  console.log(`  ✓ ${target.path} (${target.size}x${target.size})`);
}

// 3. Çoklu favicon.ico dosyalarını oluştur (16, 32, 48)
const icoImages = [16, 32, 48].map((size) => ({
  width: size,
  height: size,
  buf: readFileSync(resolve(root, `resources/favicon-${size}.png`))
}));

const icoBuffer = createIco(icoImages);
writeFileSync(resolve(root, 'resources/favicon.ico'), icoBuffer);
writeFileSync(resolve(root, 'webview-ui/public/favicon.ico'), icoBuffer);
console.log('  ✓ resources/favicon.ico ve webview-ui/public/favicon.ico üretildi.');

// 4. Gereksiz dev kopyaları temizle (1800 ve 2700 piksellik 12.6 MB mükerrer dosyalar)
const redundantFiles = [
  'resources/logo-dark-1800.png',
  'resources/logo-light-1800.png',
  'resources/logo-safe-1800.png',
  'resources/logo-dark-2700.png',
  'resources/logo-light-2700.png'
];

for (const rel of redundantFiles) {
  const p = resolve(root, rel);
  if (existsSync(p)) {
    rmSync(p, { force: true });
    console.log(`  ✗ Temizlendi: ${rel}`);
  }
}

console.log('Marka görsel varlıkları başarıyla yenilendi ve temizlendi.');
