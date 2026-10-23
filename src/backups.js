import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

export const MAX_BACKUP_BYTES = 8 * 1024 * 1024;
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});
const automaticName = /^auto-(\d{4}-\d{2}-\d{2})\.json$/;
const safetyName = /^before-(restore|setup)-\d{10,17}-[0-9a-f]{8}\.json$/;

function backupError(status, message) {
  return Object.assign(new Error(message), { status });
}

function typeOfName(name) {
  if (typeof name !== 'string') return null;
  const automatic = automaticName.exec(name);
  if (automatic) {
    const parsed = new Date(`${automatic[1]}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === automatic[1] ? 'daily' : null;
  }
  const safety = safetyName.exec(name);
  return safety ? `before-${safety[1]}` : null;
}

/**
 * One local JSON snapshot per Beijing calendar day while the app is running.
 * The caller owns scheduling; this class never starts timers or restores data.
 */
export class BackupManager {
  constructor(store, { directory, now = () => new Date(), retentionDays = 14 } = {}) {
    if (!store || typeof store.backup !== 'function') throw new TypeError('备份需要可读取数据的 Store');
    if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('请指定本地备份目录');
    if (typeof now !== 'function') throw new TypeError('备份时间来源无效');
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) throw new TypeError('日备份保留数量应为 1～365');
    this.store = store;
    this.directory = resolve(directory);
    this.now = now;
    this.retentionDays = retentionDays;
    this.lastError = '';
    try { this.ensureDirectory(); }
    catch (error) { this.lastError = error.status ? error.message : '自动备份未完成，请检查备份目录权限与可用磁盘空间'; }
  }

  ensureDirectory() {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(this.directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw backupError(400, '备份目录必须是本地普通目录');
  }

  entry(name) {
    const type = typeOfName(name);
    if (!type) throw backupError(400, '备份文件名无效');
    let stat;
    try { stat = fs.lstatSync(join(this.directory, name)); }
    catch (error) {
      if (error.code === 'ENOENT') throw backupError(404, '备份文件不存在');
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) throw backupError(400, '只允许访问普通备份文件');
    return { name, savedAt: stat.mtime.toISOString(), bytes: stat.size, type };
  }

  list() {
    this.ensureDirectory();
    const entries = [];
    for (const file of fs.readdirSync(this.directory, { withFileTypes: true })) {
      if (!file.isFile() || !typeOfName(file.name)) continue;
      try { entries.push(this.entry(file.name)); }
      catch (error) { if (![400, 404].includes(error.status)) throw error; }
    }
    return entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt) || b.name.localeCompare(a.name));
  }

  read(name) {
    this.ensureDirectory();
    const before = this.entry(name);
    if (before.bytes > MAX_BACKUP_BYTES) throw backupError(413, '备份超过 8 MB，不能通过此入口下载恢复');
    let fd;
    try {
      const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
      fd = fs.openSync(join(this.directory, name), flags);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile()) throw backupError(400, '只允许访问普通备份文件');
      // O_NOFOLLOW is not available on every supported desktop platform.
      // Recheck the path against the opened descriptor before reading content.
      const current = fs.lstatSync(join(this.directory, name));
      if (current.isSymbolicLink() || !current.isFile() || current.dev !== stat.dev || current.ino !== stat.ino) {
        throw backupError(400, '备份文件已发生变化，请刷新后重试');
      }
      if (stat.size > MAX_BACKUP_BYTES) throw backupError(413, '备份超过 8 MB，不能通过此入口下载恢复');
      // Bound bytes read even if a local process grows the file after fstat.
      const data = Buffer.allocUnsafe(MAX_BACKUP_BYTES + 1);
      let length = 0;
      while (length < data.length) {
        const count = fs.readSync(fd, data, length, data.length - length, null);
        if (!count) break;
        length += count;
      }
      if (length > MAX_BACKUP_BYTES) throw backupError(413, '备份超过 8 MB，不能通过此入口下载恢复');
      return data.subarray(0, length);
    } catch (error) {
      if (error.code === 'ENOENT') throw backupError(404, '备份文件不存在');
      if (error.code === 'ELOOP') throw backupError(400, '只允许访问普通备份文件');
      throw error;
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }

  createDaily() {
    this.ensureDirectory();
    const instant = this.now();
    if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) throw backupError(500, '无法确定备份日期');
    const name = `auto-${dateFormatter.format(instant)}.json`;
    try {
      const existing = this.entry(name);
      if (existing.bytes > MAX_BACKUP_BYTES) throw backupError(413, '已有日备份超过 8 MB，请先导出并妥善保存');
      this.prune(name);
      return { ...existing, created: false };
    } catch (error) { if (error.status !== 404) throw error; }

    const json = JSON.stringify(this.store.backup(), null, 2);
    if (typeof json !== 'string') throw backupError(500, '无法生成有效的备份内容');
    if (Buffer.byteLength(json, 'utf8') > MAX_BACKUP_BYTES) throw backupError(413, '数据超过 8 MB，自动备份未生成，请联系交付方迁移数据');
    const temporary = join(this.directory, `.${name}-${randomUUID()}.tmp`);
    let fd;
    try {
      fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
      fs.writeFileSync(fd, json, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      // Publishing a completed file by hard link is atomic and, unlike rename,
      // cannot overwrite another process's already-published daily snapshot.
      try { fs.linkSync(temporary, join(this.directory, name)); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = this.entry(name);
        if (existing.bytes > MAX_BACKUP_BYTES) throw backupError(413, '已有日备份超过 8 MB，请先导出并妥善保存');
        this.prune(name);
        return { ...existing, created: false };
      }
      const result = this.entry(name);
      this.prune(name);
      return { ...result, created: true };
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }

  prune(currentName) {
    const automatic = this.list().filter(entry => entry.type === 'daily').sort((a, b) => b.name.localeCompare(a.name));
    // Preserve today's file even if the computer's clock moved backwards.
    const keep = new Set([currentName]);
    for (const entry of automatic) if (keep.size < this.retentionDays) keep.add(entry.name);
    for (const entry of automatic) {
      if (keep.has(entry.name)) continue;
      try {
        const stat = fs.lstatSync(join(this.directory, entry.name));
        if (stat.isFile() && !stat.isSymbolicLink()) fs.unlinkSync(join(this.directory, entry.name));
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }

  safeDaily() {
    try {
      const result = this.createDaily();
      this.lastError = '';
      return result;
    } catch (error) {
      this.lastError = error.status ? error.message : '自动备份未完成，请检查备份目录权限与可用磁盘空间';
      return null;
    }
  }

  status() {
    let entries = [];
    try { entries = this.list(); }
    catch { this.lastError ||= '无法读取本地备份，请检查备份目录权限与可用磁盘空间'; }
    return { lastError: this.lastError, latest: entries[0] || null,
      latestDaily: entries.filter(entry => entry.type === 'daily').sort((a, b) => b.name.localeCompare(a.name))[0] || null,
      retentionDays: this.retentionDays };
  }
}
