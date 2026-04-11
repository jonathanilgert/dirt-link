const { run } = require('../database/init');

// Middleware: log every API request to the audit_log table
function auditLog(req, res, next) {
  const start = Date.now();

  // Capture the original end to log after response
  const originalEnd = res.end;
  res.end = function (...args) {
    const duration = Date.now() - start;

    try {
      run(
        `INSERT INTO audit_log (api_key_id, api_key_name, method, path, status_code, duration_ms, request_body, ip_address, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          req.apiKey?.id || null,
          req.apiKey?.name || null,
          req.method,
          req.originalUrl,
          res.statusCode,
          duration,
          req.body ? JSON.stringify(req.body).substring(0, 10000) : null,
          req.ip
        ]
      );
    } catch (e) {
      console.error('Audit log write failed:', e.message);
    }

    originalEnd.apply(res, args);
  };

  next();
}

module.exports = { auditLog };
