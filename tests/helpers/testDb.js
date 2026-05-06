'use strict';

const { createDb } = require('../../src/db/database');

function createTestDb() {
  return createDb(':memory:');
}

module.exports = { createTestDb };
