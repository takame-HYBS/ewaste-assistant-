import { pool } from './pool.js';
import { initDatabase } from './init.js';

initDatabase();
console.log('Database ready.');
await pool.end();
