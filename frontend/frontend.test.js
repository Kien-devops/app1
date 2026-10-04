'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = __dirname;

test('frontend uses same-origin API paths only', () => {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(source, /'\/api\/auth\/health'/);
  assert.match(source, /'\/api\/users\/profile'/);
  assert.match(source, /'\/api\/products'/);
  assert.doesNotMatch(source, /192\.168\.30\.|\.svc\.cluster\.local|http:\/\//);
});

test('nginx exposes an internal health endpoint and security headers', () => {
  const config = fs.readFileSync(path.join(root, 'nginx.conf'), 'utf8');
  assert.match(config, /location = \/health/);
  assert.match(config, /Content-Security-Policy/);
  assert.match(config, /listen 8080/);
});
