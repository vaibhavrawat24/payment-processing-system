'use strict';

const Database = require('better-sqlite3');
const config = require('../config');
const { runMigrations } = require('./migrate');

let instance = null;

function createDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  runMigrations(db);
  return db;
}

function getDb() {
  if (!instance) {
    instance = createDb(config.db.path);
  }
  return instance;
}

function closeDb() {
  if (instance) {
    instance.close();
    instance = null;
  }
}

module.exports = { getDb, closeDb, createDb };
