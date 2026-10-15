#!/usr/bin/env node
// Concede, remove ou lista editores do catálogo (custom claim `role: 'editor'`).
//
//   npm run editor -- add maria@exemplo.com
//   npm run editor -- remove maria@exemplo.com
//   npm run editor -- list
//
// Autenticação: o JSON da conta de serviço do projeto (Firebase console > Configurações >
// Contas de serviço > Gerar nova chave privada), salvo na raiz do projeto. Ele está no
// .gitignore. Também pode ser indicado por GOOGLE_APPLICATION_CREDENTIALS.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROLE = 'editor';

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

// Usa o firebase-admin instalado nas functions.
const adminPath = join(ROOT, 'functions', 'node_modules', 'firebase-admin');
if (!existsSync(adminPath)) fail('Instale as dependências das functions: cd functions && npm install');
const require = createRequire(join(ROOT, 'functions', 'package.json'));
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

function findServiceAccount() {
  const fromEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (fromEnv) return resolve(fromEnv);
  const file = readdirSync(ROOT).find(
    (f) => f.endsWith('.json') && (/firebase-adminsdk/.test(f) || /^service-account/.test(f) || /-sa\.json$/.test(f)),
  );
  if (!file) {
    fail(
      'JSON da conta de serviço não encontrado na raiz do projeto.\n' +
        '  Gere em Firebase console > Configurações do projeto > Contas de serviço > Gerar nova chave privada.',
    );
  }
  return join(ROOT, file);
}

const [action, email] = process.argv.slice(2);
if (!['add', 'remove', 'list'].includes(action)) {
  console.log('Uso:\n  npm run editor -- add <email>\n  npm run editor -- remove <email>\n  npm run editor -- list');
  process.exit(action ? 1 : 0);
}
if (action !== 'list' && !email) fail('Informe o email.');

const saPath = findServiceAccount();
if (!existsSync(saPath)) fail(`Arquivo não encontrado: ${saPath}`);
initializeApp({ credential: cert(JSON.parse(readFileSync(saPath, 'utf8'))) });
const auth = getAuth();

if (action === 'list') {
  const editors = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    editors.push(...page.users.filter((u) => u.customClaims?.role === ROLE));
    pageToken = page.pageToken;
  } while (pageToken);
  if (!editors.length) console.log('Nenhum editor.');
  for (const u of editors) console.log(`- ${u.displayName ?? ''} <${u.email}>`);
  process.exit(0);
}

let user;
try {
  user = await auth.getUserByEmail(email.trim().toLowerCase());
} catch (err) {
  if (err.code === 'auth/user-not-found') fail('Nenhuma conta com esse email. A pessoa precisa entrar no app antes.');
  throw err;
}

// Preserva os outros claims (como `allowed`).
const claims = { ...(user.customClaims ?? {}) };
if (action === 'add') claims.role = ROLE;
else if (claims.role === ROLE) delete claims.role;
await auth.setCustomUserClaims(user.uid, claims);

console.log(
  action === 'add'
    ? `✔ ${user.email} agora é editor. Vale na próxima vez que o app for aberto.`
    : `✔ ${user.email} não é mais editor.`,
);
