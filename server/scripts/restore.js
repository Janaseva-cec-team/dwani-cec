'use strict';

const fs = require('fs');
const path = require('path');

const backup = process.argv[2] && path.resolve(process.argv[2]);
const confirmed = process.argv.includes('--yes');
const target = path.resolve(process.env.DHWANI_DATA_FILE || path.join(__dirname, '..', 'data.json'));

function validateData(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object.');
  for (const key of ['users', 'complaints', 'sessions', 'notifications']) {
    if (parsed[key] !== undefined && !Array.isArray(parsed[key])) throw new Error(`Invalid ${key} collection.`);
  }
  return parsed;
}

if (!backup || !confirmed) {
  console.error('Usage: node scripts/restore.js <backup-file> --yes');
  console.error('Restoring replaces the current JSON data file. A safety copy is created first.');
  process.exit(2);
}

try {
  if (!fs.existsSync(backup)) throw new Error('Backup file does not exist.');
  validateData(backup);
  if (fs.existsSync(target)) {
    const safety = `${target}.pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
    fs.copyFileSync(target, safety);
    fs.chmodSync(safety, 0o600);
    console.log(`Safety copy: ${safety}`);
  }
  const temp = `${target}.${process.pid}.restore.tmp`;
  fs.copyFileSync(backup, temp);
  fs.chmodSync(temp, 0o600);
  validateData(temp);
  const previous = `${target}.${process.pid}.previous.tmp`;
  let movedCurrent = false;
  try {
    if (fs.existsSync(target)) {
      fs.renameSync(target, previous);
      movedCurrent = true;
    }
    fs.renameSync(temp, target);
    if (movedCurrent && fs.existsSync(previous)) fs.unlinkSync(previous);
  } catch (error) {
    if (movedCurrent && !fs.existsSync(target) && fs.existsSync(previous)) {
      fs.renameSync(previous, target);
    }
    throw error;
  }
  console.log(JSON.stringify({ ok: true, restoredFrom: backup, target }, null, 2));
} catch (error) {
  console.error(`Restore failed: ${error.message}`);
  process.exitCode = 1;
}
