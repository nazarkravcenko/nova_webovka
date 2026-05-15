import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

export const config = {
  rootDir,
  dataDir: path.join(rootDir, 'data'),
  publicDir: path.join(rootDir, 'public'),
  uploadDir: path.join(rootDir, 'public', 'uploads'),
  dbPath: path.join(rootDir, 'data', 'kalianko.sqlite'),
  port: Number(process.env.PORT || 3000),
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex'),
  adminEmail: process.env.ADMIN_EMAIL || 'admin@kalianko.local',
  adminPassword: process.env.ADMIN_PASSWORD || 'ChangeMe123!'
};

export function requireEnvHardening() {
  if (!process.env.SESSION_SECRET) {
    console.warn('[security] SESSION_SECRET není nastavený. Používá se náhodný vývojový secret.');
  }
}
