'use strict';

const createApp = require('./app');
const config = require('./config');
const logger = require('./utils/logger');

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(
    { event: 'server.started', port: config.port, env: config.env },
    `Payment processor listening on port ${config.port}`
  );
});

function shutdown(signal) {
  logger.info({ event: 'server.shutdown', signal }, 'Shutting down gracefully');
  app.retryQueue.stop();
  server.close(() => {
    logger.info({ event: 'server.closed' }, 'Server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
