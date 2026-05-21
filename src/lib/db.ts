import { Pool } from 'pg';

// Create a single connection pool for the entire application
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:password@127.0.0.1:5432/plotarmour'
});
