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

test('returns the demo profile', () => withServer(async (baseUrl) => {
  const response = await fetch(`${baseUrl}/api/users/profile`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.id, 'usr-demo-001');
  assert.deepEqual(body.roles, ['viewer']);
}));

test('reports healthy status', () => withServer(async (baseUrl) => {
  const response = await fetch(`${baseUrl}/api/users/health`);
  assert.deepEqual(await response.json(), { status: 'healthy', service: 'user-service' });
}));
