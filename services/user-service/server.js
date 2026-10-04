'use strict';

const { createHttpService, startServer } = require('../common/http-service');

const serviceName = 'user-service';
const healthy = () => ({ body: { status: 'healthy', service: serviceName } });

const handler = createHttpService({
  name: serviceName,
  routes: {
    'GET /api/users/health': healthy,
    'GET /api/users/profile': async () => ({
      body: {
        id: 'usr-demo-001',
        displayName: 'K3s Demo User',
        email: 'demo@example.invalid',
        roles: ['viewer'],
      },
    }),
  },
});

if (require.main === module) startServer(handler, serviceName);

module.exports = { handler };
