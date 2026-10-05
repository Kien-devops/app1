'use strict';

const { createHttpService, startServer } = require('../common/http-service');

const serviceName = 'auth-service';
const healthy = () => ({ body: { status: 'healthy', service: serviceName } });

let currentSession = {
  authenticated: true,
  principal: 'demo-user',
  role: 'operator',
  mode: 'demo-only',
  sessionToken: 'k3s-demo-session-token',
  issuedAt: new Date().toISOString(),
};

const handler = createHttpService({
  name: serviceName,
  routes: {
    'GET /api/auth/health': healthy,
    'GET /api/auth/session': async () => ({
      body: currentSession,
    }),
    'POST /api/auth/login': async ({ readJson }) => {
      const body = await readJson();
      if (typeof body.username !== 'string' || body.username.trim() === '') {
        const error = new Error('username is required');
        error.statusCode = 400;
        throw error;
      }
      const username = body.username.trim();
      const token = `sess_${Buffer.from(`${username}_${Date.now()}`).toString('base64url').slice(0, 16)}`;
      currentSession = {
        authenticated: true,
        principal: username,
        role: username.toLowerCase() === 'admin' ? 'admin' : 'viewer',
        mode: 'demo-only',
        sessionToken: token,
        issuedAt: new Date().toISOString(),
      };
      return {
        body: {
          authenticated: true,
          principal: username,
          session: 'demo-session',
          sessionToken: token,
          issuedAt: currentSession.issuedAt,
          warning: 'Demo authentication only; do not use for real identities.',
        },
      };
    },
  },
});

if (require.main === module) startServer(handler, serviceName);

module.exports = { handler };

