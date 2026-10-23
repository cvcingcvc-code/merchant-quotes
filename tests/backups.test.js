import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BackupManager, MAX_BACKUP_BYTES } from '../src/backups.js';

function fixture(run) {
  const root = fs.mkdtempSync(join(tmpdir(), 'merchant-backups-'));
  try { return run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
const backup = value => ({ format: 'merchant-quotes', schemaVersion: 1, exportedAt: '2026-10-22T00:00:00.000Z', value });

test('日备份按北京时间生成，已有当日文件不覆盖且不再次读取 Store', () => fixture(root => {
  let calls = 0;
  const manager = new BackupManager({ backup: () => backup(++calls) }, { directory: root, now: () => new Date('2026-10-21T16:01:00Z') });
  const first = manager.createDaily();
  assert.equal(first.name, 'auto-2026-10-22.json');
  assert.equal(first.created, true); assert.equal(first.type, 'daily');
  assert.equal(fs.statSync(join(root, first.name)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(manager.read(first.name)).value, 1);
  assert.equal(manager.createDaily().created, false);
  assert.equal(calls, 1);
  assert.equal(manager.status().latestDaily.name, first.name);
  assert.match(manager.status().latest.savedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(manager.status().lastError, '');
}));

test('跨日按数量保留日备份，恢复前与配置前副本及无关文件保持原样', () => fixture(root => {
  let day = 20;
  const manager = new BackupManager({ backup: () => backup(day) }, { directory: root, retentionDays: 2, now: () => new Date(`2026-10-${day}T00:00:00Z`) });
  const protectedNames = ['before-restore-1792627200000-abcdef12.json', 'before-setup-1792627200000-1234abcd.json', 'customer-notes.txt'];
  for (const name of protectedNames) fs.writeFileSync(join(root, name), 'keep this file');
  for (day = 20; day <= 22; day++) manager.createDaily();
  assert.deepEqual(fs.readdirSync(root).filter(name => name.startsWith('auto-')).sort(), ['auto-2026-10-21.json', 'auto-2026-10-22.json']);
  for (const name of protectedNames) assert.equal(fs.readFileSync(join(root, name), 'utf8'), 'keep this file');
  assert.deepEqual(manager.list().map(entry => entry.type).sort(), ['before-restore', 'before-setup', 'daily', 'daily']);
  day = 19; manager.createDaily();
  assert.deepEqual(fs.readdirSync(root).filter(name => name.startsWith('auto-')).sort(), ['auto-2026-10-19.json', 'auto-2026-10-22.json']);
}));

test('拒绝路径穿越、非法日期、符号链接及目录，列表只返回受控普通文件', () => fixture(root => {
  const directory = join(root, 'backups');
  const manager = new BackupManager({ backup: () => backup(1) }, { directory, now: () => new Date('2026-10-22T00:00:00Z') });
  const outside = join(root, 'outside.json'); fs.writeFileSync(outside, 'private outside data');
  fs.symlinkSync(outside, join(directory, 'auto-2026-10-21.json'));
  fs.mkdirSync(join(directory, 'auto-2026-10-20.json'));
  fs.writeFileSync(join(directory, 'auto-2026-02-30.json'), '{}');
  for (const name of ['../outside.json', '..\\outside.json', '/tmp/outside.json', '%2e%2e%2foutside.json', 'auto-2026-02-30.json', 'auto-2026-10-21.json', 'auto-2026-10-20.json']) {
    assert.throws(() => manager.read(name), error => error.status === 400);
  }
  assert.throws(() => manager.read('auto-2026-10-19.json'), error => error.status === 404);
  assert.deepEqual(manager.list(), []);
  manager.createDaily();
  assert.deepEqual(manager.list().map(entry => entry.name), ['auto-2026-10-22.json']);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'private outside data');
}));

test('生成与读取均限制 8 MB，生成失败不留下可见备份或临时文件', () => fixture(root => {
  const manager = new BackupManager({ backup: () => ({ data: '中'.repeat(Math.ceil(MAX_BACKUP_BYTES / 3)) }) }, { directory: root, now: () => new Date('2026-10-22T00:00:00Z') });
  assert.throws(() => manager.createDaily(), error => error.status === 413);
  assert.deepEqual(fs.readdirSync(root), []);
  const large = join(root, 'before-restore-1792627200000-abcdef12.json');
  const fd = fs.openSync(large, 'w'); fs.ftruncateSync(fd, MAX_BACKUP_BYTES + 1); fs.closeSync(fd);
  assert.throws(() => manager.read('before-restore-1792627200000-abcdef12.json'), error => error.status === 413);
}));

test('原子发布失败清理临时文件，safeDaily 记录错误并可恢复', () => fixture(root => {
  const manager = new BackupManager({ backup: () => backup(1) }, { directory: root, now: () => new Date('2026-10-22T00:00:00Z') });
  const publication = mock.method(fs, 'linkSync', () => { throw Object.assign(new Error('disk unavailable'), { code: 'ENOSPC' }); });
  try {
    assert.equal(manager.safeDaily(), null);
    assert.ok(manager.status().lastError);
    assert.equal(manager.status().latest, null);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally { publication.mock.restore(); }
  assert.equal(manager.safeDaily().created, true);
  assert.equal(manager.status().lastError, '');
  assert.equal(manager.list().length, 1);
}));

test('竞争发布同日日文件时保持已发布内容且清理本次临时文件', () => fixture(root => {
  const manager = new BackupManager({ backup: () => backup('attempted overwrite') }, { directory: root, now: () => new Date('2026-10-22T00:00:00Z') });
  const link = fs.linkSync;
  const publication = mock.method(fs, 'linkSync', (source, destination) => {
    fs.writeFileSync(destination, JSON.stringify(backup('already published')));
    return link(source, destination);
  });
  try {
    assert.equal(manager.createDaily().created, false);
    assert.equal(JSON.parse(manager.read('auto-2026-10-22.json')).value, 'already published');
    assert.deepEqual(fs.readdirSync(root), ['auto-2026-10-22.json']);
  } finally { publication.mock.restore(); }
}));

test('备份目录不可用时仍可构造服务并报告失败，不改动阻塞文件', () => fixture(root => {
  const directory = join(root, 'not-a-directory');
  fs.writeFileSync(directory, 'keep existing file');
  const manager = new BackupManager({ backup: () => backup(1) }, { directory });
  assert.ok(manager.status().lastError);
  assert.equal(manager.safeDaily(), null);
  assert.equal(fs.readFileSync(directory, 'utf8'), 'keep existing file');
}));
