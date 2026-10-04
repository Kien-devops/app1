'use strict';

const http = require('node:http');
const { randomUUID } = require('node:crypto');

function createHttpService({ name, routes }) {
  const startedAt = Date.now();
  let requestCount = 0;

  async function readJson(req) {
    const chunks = [];
    let size = 0;

    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16 * 1024) {
        const error = new Error('request body exceeds 16 KiB');
        error.statusCode = 413;
        throw error;
      }
      chunks.push(chunk);
    }

    if (chunks.length === 0) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      const error = new Error('request body must be valid JSON');
      error.statusCode = 400;
      throw error;
    }
  }

  function sendJson(res, statusCode, body, requestId) {
    const payload = JSON.stringify(body);
    res.writeHead(statusCode, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(payload),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-request-id': requestId,
    });
    res.end(payload);
  }

  return async function handler(req, res) {
    const requestId = randomUUID();
    const started = process.hrtime.bigint();
    const url = new URL(req.url, 'http://service.local');
    const routeKey = `${req.method} ${url.pathname}`;
    let statusCode = 500;
    requestCount += 1;

    try {
      if (url.pathname === '/health') {
        statusCode = 200;
        sendJson(res, statusCode, { status: 'healthy', service: name }, requestId);
        return;
      }

      if (url.pathname === '/metrics') {
        statusCode = 200;
        const uptime = Math.floor((Date.now() - startedAt) / 1000);
        const metrics = [
          '# HELP app_requests_total Total HTTP requests handled.',
          '# TYPE app_requests_total counter',
          `app_requests_total{service="${name}"} ${requestCount}`,
          '# HELP app_uptime_seconds Process uptime in seconds.',
          '# TYPE app_uptime_seconds gauge',
          `app_uptime_seconds{service="${name}"} ${uptime}`,
          '',
        ].join('\n');
        res.writeHead(statusCode, {
          'content-type': 'text/plain; version=0.0.4; charset=utf-8',
          'content-length': Buffer.byteLength(metrics),
          'x-content-type-options': 'nosniff',
          'x-request-id': requestId,
        });
        res.end(metrics);
        return;
      }

      const route = routes[routeKey];
      if (!route) {
        statusCode = 404;
        sendJson(res, statusCode, { error: 'not_found', service: name }, requestId);
        return;
      }

      const result = await route({ req, url, readJson: () => readJson(req) });
      statusCode = result.statusCode || 200;
      sendJson(res, statusCode, result.body, requestId);
    } catch (error) {
      statusCode = error.statusCode || 500;
      sendJson(
        res,
        statusCode,
        {
          error: statusCode >= 500 ? 'internal_error' : 'invalid_request',
          message: statusCode >= 500 ? 'Unexpected service error' : error.message,
          service: name,
        },
        requestId,
      );
    } finally {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      process.stdout.write(`${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: statusCode >= 500 ? 'error' : 'info',
        service: name,
        method: req.method,
        path: url.pathname,
        statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        requestId,
      })}\n`);
    }
  };
}

function startServer(handler, serviceName) {
  const port = Number(process.env.PORT || 8080);
  const server = http.createServer(handler);

  server.listen(port, '0.0.0.0', () => {
    process.stdout.write(`${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: serviceName,
      event: 'server_started',
      port,
    })}\n`);
  });

  function shutdown(signal) {
    process.stdout.write(`${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: serviceName,
      event: 'shutdown_requested',
      signal,
    })}\n`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return server;
}

module.exports = { createHttpService, startServer };
