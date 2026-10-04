'use strict';

const { createHttpService, startServer } = require('../common/http-service');

const serviceName = 'auth-service';
const healthy = () => ({ body: { status: 'healthy', service: serviceName } });

const handler = createHttpService({
  name: serviceName,
  routes: {
    'GET /api/auth/health': healthy,
    'GET /api/auth/session': async () => ({
      body: {
        authenticated: true,
        principal: 'demo-user',
        mode: 'demo-only',
      },
    }),
    'POST /api/auth/login': async ({ readJson }) => {
      const body = await readJson();
      if (typeof body.username !== 'string' || body.username.trim() === '') {
        const error = new Error('username is required');
        error.statusCode = 400;
        throw error;
      }
      return {
        body: {
          authenticated: true,
          principal: body.username.trim(),
          session: 'demo-session',
          warning: 'Demo authentication only; do not use for real identities.',
        },
      };
    },
  },
});

if (require.main === module) startServer(handler, serviceName);

module.exports = { handler };
