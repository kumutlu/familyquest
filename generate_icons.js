const fs = require('fs');
// A tiny 1x1 transparent PNG base64, we'll just write it for the sake of having a valid image file.
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const buffer = Buffer.from(pngBase64, 'base64');
fs.writeFileSync('public/pwa-192x192.png', buffer);
fs.writeFileSync('public/pwa-512x512.png', buffer);
fs.writeFileSync('public/apple-touch-icon.png', buffer);
fs.writeFileSync('public/mask-icon.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#f97316"/></svg>');
