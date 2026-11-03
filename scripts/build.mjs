// Build completo para Cloudflare Pages:
//   dist/            ← formulario público (copia de public/)
//   dist/config.js   ← URL y llave pública de Supabase (desde variables de entorno)
//   dist/admin/      ← panel React compilado con Vite
import { cpSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { build } from 'vite';

rmSync('dist', { recursive: true, force: true });
cpSync('public', 'dist', { recursive: true, filter: (src) => !src.endsWith('config.js') });
execFileSync(process.execPath, ['scripts/build-config.cjs', '--out=dist'], { stdio: 'inherit' });
await build({ configFile: 'panel/vite.config.js', logLevel: 'warn' });
console.log('✔ Build listo en dist/ (formulario en /, panel en /admin/)');
