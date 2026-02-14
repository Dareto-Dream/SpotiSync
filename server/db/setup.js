import 'dotenv/config';
import { initDatabase, setupSchema, closeDatabase } from './index.js';

async function main() {
  try {
    console.log('Setting up database...');
    initDatabase();
    await setupSchema();
    console.log('✓ Database setup complete');
    await closeDatabase();
    process.exit(0);
  } catch (error) {
    console.error('Database setup failed:', error);
    process.exit(1);
  }
}

main();
