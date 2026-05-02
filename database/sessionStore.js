const session = require('express-session');
const { all, get, run } = require('./init');

class SQLiteSessionStore extends session.Store {
  // Clean up expired sessions every 30 minutes
  constructor() {
    super();
    setInterval(() => {
      try {
        run(`DELETE FROM sessions WHERE expires_at < datetime('now')`);
      } catch (e) { /* ignore */ }
    }, 30 * 60 * 1000);
  }

  get(sid, cb) {
    try {
      const row = get(`SELECT data FROM sessions WHERE sid = ? AND expires_at > datetime('now')`, [sid]);
      if (!row) return cb(null, null);
      cb(null, JSON.parse(row.data));
    } catch (e) { cb(e); }
  }

  set(sid, sessionData, cb) {
    try {
      const maxAge = sessionData.cookie?.maxAge || 7 * 24 * 60 * 60 * 1000;
      const expiresAt = new Date(Date.now() + maxAge).toISOString().replace('T', ' ').slice(0, 19);
      run(
        `INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`,
        [sid, JSON.stringify(sessionData), expiresAt]
      );
      cb(null);
    } catch (e) { cb(e); }
  }

  destroy(sid, cb) {
    try {
      run(`DELETE FROM sessions WHERE sid = ?`, [sid]);
      cb(null);
    } catch (e) { cb(e); }
  }
}

module.exports = SQLiteSessionStore;
