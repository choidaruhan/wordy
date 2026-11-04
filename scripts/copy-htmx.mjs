import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('public', { recursive: true });
copyFileSync('node_modules/htmx.org/dist/htmx.min.js', 'public/htmx.min.js');
console.log('copied htmx.min.js → public/');
