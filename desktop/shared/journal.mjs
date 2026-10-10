import initSqlJs from 'sql.js';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
export const newId = () => randomBytes(16).toString('hex');
export class Journal {
  static async open(path) {
    const SQL = await initSqlJs();
    let bytes;
    try { bytes = await readFile(path); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const self = new Journal(path, new SQL.Database(bytes));
    self.db.run('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS print_jobs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, status TEXT NOT NULL)');
    self.db.run("UPDATE print_jobs SET status='UNKNOWN' WHERE status='SUBMITTING'");
    // One active guest at a time; interrupted remote work requires operator recovery.
    for (const s of self.all()) if (['UPLOADING','PROCESSING'].includes(s.phase)) self.saveSync({...s, phase:'RECOVERY_REQUIRED'});
    await self.flush();
    return self;
  }
  constructor(path, db) { this.path = path; this.db = db; this.writes = Promise.resolve(); }
  all() { const r = this.db.exec('SELECT body FROM sessions ORDER BY rowid DESC'); return r.length ? r[0].values.map(([v]) => JSON.parse(v)) : []; }
  get(id) { return this.all().find(s => s.id === id); }
  saveSync(s) { this.db.run('INSERT OR REPLACE INTO sessions(id,body) VALUES(?,?)', [s.id, JSON.stringify(s)]); }
  async save(s) { this.saveSync(s); await this.flush(); }
  async print(id, sessionId, status) { this.db.run('INSERT OR REPLACE INTO print_jobs VALUES(?,?,?)',[id,sessionId,status]); await this.flush(); }
  prints(sessionId) { const stmt = this.db.prepare('SELECT id,status FROM print_jobs WHERE session_id=?'); stmt.bind([sessionId]); const out=[]; while(stmt.step()) out.push(stmt.getAsObject()); stmt.free(); return out; }
  flush() {
    const bytes = Buffer.from(this.db.export());
    this.writes = this.writes.then(async () => { await mkdir(dirname(this.path),{recursive:true}); await writeFile(this.path+'.tmp',bytes,{mode:0o600}); await rename(this.path+'.tmp',this.path); });
    return this.writes;
  }
  close() { this.db.close(); }
}
