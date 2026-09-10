import fs from 'fs';
import path from 'path';

const srcPath = 'C:\\Users\\hp\\.gemini\\antigravity\\brain\\e982d66b-3e91-445c-a8bf-0a1b9960ea3e\\media__1789052445568.jpg';
const publicDir = 'c:\\Users\\hp\\Documents\\QuickR- Vendors Friendly Mac\\frontend\\public';

const buf = fs.readFileSync(srcPath);

fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), buf);
fs.writeFileSync(path.join(publicDir, 'maskable-icon-512x512.png'), buf);
fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), buf);
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), buf);
fs.writeFileSync(path.join(publicDir, 'favicon.png'), buf);

console.log('App icons copied successfully!');
