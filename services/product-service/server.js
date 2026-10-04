'use strict';

const { createHttpService, startServer } = require('../common/http-service');

const serviceName = 'product-service';
const products = Object.freeze([
  { id: 'prd-001', name: 'K3s Starter', price: 19, currency: 'USD' },
  { id: 'prd-002', name: 'CI/CD Toolkit', price: 39, currency: 'USD' },
  { id: 'prd-003', name: 'Observability Pack', price: 29, currency: 'USD' },
]);
const healthy = () => ({ body: { status: 'healthy', service: serviceName } });

const handler = createHttpService({
  name: serviceName,
  routes: {
    'GET /api/products/health': healthy,
    'GET /api/products': async () => ({ body: { items: products, count: products.length } }),
  },
});

if (require.main === module) startServer(handler, serviceName);

module.exports = { handler };
