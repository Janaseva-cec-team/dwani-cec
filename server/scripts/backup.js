'use strict';

const fs = require('fs');
const path = require('path');

const source = path.resolve(process.env.DHWANI_DATA_FILE || path.join(__dirname, '..', 'data.json'));
const backupDir = path.resolve(process.env.DHWANI_BACKUP_DIR || path.join(__dirname, '..', 'backups'));

function validateData(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object.');
  for (const key of ['users', 'complaints', 'sessions', 'notifications']) {
    if (parsed[key] !== undefined && !Array.isArray(parsed[key])) throw new Error(`Invalid ${key} collection.`);
  }
  return parsed;
}

try {
  validateData(source);
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(backupDir, `dhwani-${stamp}.json`);
  const temp = `${target}.tmp`;
  fs.copyFileSync(source, temp);
  fs.chmodSync(temp, 0o600);
  // Validate the copied backup before publishing it.
  validateData(temp);
  fs.renameSync(temp, target);
  console.log(JSON.stringify({ ok: true, backup: target, bytes: fs.statSync(target).size }, null, 2));
} catch (error) {
  console.error(`Backup failed: ${error.message}`);
  process.exitCode = 1;
}
