'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { handler } = require('./server');

async function withServer(run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('reports healthy status', () => withServer(async (baseUrl) => {
  const response = await fetch(`${baseUrl}/api/auth/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'healthy', service: 'auth-service' });
}));

test('accepts a demo login without returning the supplied password', () => withServer(async (baseUrl) => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'not-logged' }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.principal, 'alice');
  assert.equal(JSON.stringify(body).includes('not-logged'), false);
}));

test('rejects a login when username is missing', () => withServer(async (baseUrl) => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'not-logged' }),
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error, 'invalid_request');
  assert.equal(body.message, 'username is required');
  assert.equal(JSON.stringify(body).includes('not-logged'), false);
}));
