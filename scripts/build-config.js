// Genera public/config.js a partir de variables de entorno.
// - En tu computadora las lee del archivo .env
// - En Cloudflare Pages las lee de Settings > Variables and Secrets
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('\n✖ Faltan variables: SUPABASE_URL y/o SUPABASE_ANON_KEY.');
  console.error('  Local: copia .env.example como .env y llénalo.');
  console.error('  Cloudflare: agrégalas en Settings > Variables and Secrets.\n');
  process.exit(1);
}
if (/service_role|sb_secret_/.test(SUPABASE_ANON_KEY)) {
  console.error('\n✖ Usaste una llave SECRETA. Usa la llave pública (anon / publishable).\n');
  process.exit(1);
}

const out = path.join(root, 'public', 'config.js');
const content =
  '// Archivo generado por scripts/build-config.js. No editar a mano.\n' +
  `window.HIXSA_CONFIG = ${JSON.stringify({ SUPABASE_URL, SUPABASE_ANON_KEY }, null, 2)};\n`;

fs.writeFileSync(out, content);
console.log('✔ public/config.js generado para', SUPABASE_URL);
