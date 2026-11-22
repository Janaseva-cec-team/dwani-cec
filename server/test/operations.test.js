'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const serverDir = path.resolve(__dirname, '..');
const node = process.execPath;

test('database refuses to overwrite malformed existing JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhwani-corrupt-'));
  const dataFile = path.join(dir, 'data.json');
  fs.writeFileSync(dataFile, '{"complaints": [broken]}');
  const result = spawnSync(node, ['-e', "require('./db')"], {
    cwd: serverDir,
    env: { ...process.env, DHWANI_DATA_FILE: dataFile },
    encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unable to read Dhwani data safely/);
  assert.equal(fs.readFileSync(dataFile, 'utf8'), '{"complaints": [broken]}');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('backup command creates a valid, private JSON backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhwani-backup-'));
  const dataFile = path.join(dir, 'data.json');
  const backupDir = path.join(dir, 'backups');
  fs.writeFileSync(dataFile, JSON.stringify({ users: [], complaints: [], sessions: [], notifications: [] }));
  const result = spawnSync(node, ['scripts/backup.js'], {
    cwd: serverDir,
    env: { ...process.env, DHWANI_DATA_FILE: dataFile, DHWANI_BACKUP_DIR: backupDir },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  const names = fs.readdirSync(backupDir);
  assert.equal(names.length, 1);
  const backup = path.join(backupDir, names[0]);
  assert.deepEqual(JSON.parse(fs.readFileSync(backup, 'utf8')).complaints, []);
  if (process.platform !== 'win32') assert.equal(fs.statSync(backup).mode & 0o077, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('restore requires explicit confirmation and preserves a safety copy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhwani-restore-'));
  const dataFile = path.join(dir, 'data.json');
  const backup = path.join(dir, 'backup.json');
  fs.writeFileSync(dataFile, JSON.stringify({ users: [{ id: 'current' }], complaints: [], sessions: [], notifications: [] }));
  fs.writeFileSync(backup, JSON.stringify({ users: [{ id: 'restored' }], complaints: [], sessions: [], notifications: [] }));
  const denied = spawnSync(node, ['scripts/restore.js', backup], {
    cwd: serverDir, env: { ...process.env, DHWANI_DATA_FILE: dataFile }, encoding: 'utf8'
  });
  assert.equal(denied.status, 2);
  assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).users[0].id, 'current');
  const restored = spawnSync(node, ['scripts/restore.js', backup, '--yes'], {
    cwd: serverDir, env: { ...process.env, DHWANI_DATA_FILE: dataFile }, encoding: 'utf8'
  });
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).users[0].id, 'restored');
  assert.ok(fs.readdirSync(dir).some(name => name.includes('.pre-restore-')));
  fs.rmSync(dir, { recursive: true, force: true });
});
