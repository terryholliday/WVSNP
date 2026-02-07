/**
 * Database Setup Script
 * Creates database and initializes schema
 */

import { config } from 'dotenv';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load environment variables from .env file
config();

async function setupDatabase() {
  console.log('🔧 WVSNP Database Setup\n');

  // Use DATABASE_URL if provided (for Supabase or other hosted Postgres)
  if (process.env.DATABASE_URL) {
    console.log('📡 Using DATABASE_URL connection string\n');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    
    try {
      console.log('📋 Initializing schema...');
      
      // Read schema file
      const schemaPath = join(__dirname, '../../db/schema.sql');
      const schema = readFileSync(schemaPath, 'utf-8');

      // Execute schema as a full script to preserve PL/pgSQL dollar-quoted blocks
      // (Splitting on semicolons breaks $$...$$ function bodies)
      await pool.query(schema);
      
      console.log('   ✓ Schema initialized\n');

      // Verify tables
      const tables = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name
      `);

      console.log('📊 Tables created:');
      tables.rows.forEach((row) => {
        console.log(`   • ${row.table_name}`);
      });

      console.log('\n✅ Database setup complete!\n');
      console.log('Next step: Run "npm run seed:demo" to populate with demo data\n');

    } catch (error: any) {
      console.error('❌ Setup failed:', error.message);
      throw error;
    } finally {
      await pool.end();
    }
    return;
  }

  // Local PostgreSQL setup
  const password = process.env.POSTGRES_PASSWORD || 'postgres';
  
  const adminPool = new Pool({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: password,
    database: 'postgres',
  });

  try {
    console.log('📦 Creating database wvsnp_gms...');
    
    // Check if database exists
    const checkDb = await adminPool.query(
      "SELECT 1 FROM pg_database WHERE datname = 'wvsnp_gms'"
    );

    if (checkDb.rows.length === 0) {
      await adminPool.query('CREATE DATABASE wvsnp_gms');
      console.log('   ✓ Database created\n');
    } else {
      console.log('   ℹ Database already exists\n');
    }
  } catch (error: any) {
    if (error.code === '42P04') {
      console.log('   ℹ Database already exists\n');
    } else {
      throw error;
    }
  } finally {
    await adminPool.end();
  }

  // Now connect to wvsnp_gms and create schema
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: password,
    database: 'wvsnp_gms',
  });

  try {
    console.log('📋 Initializing schema...');
    
    // Read schema file
    const schemaPath = join(__dirname, '../../db/schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');

    // Execute schema
    await pool.query(schema);
    console.log('   ✓ Schema initialized\n');

    // Verify tables
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);

    console.log('📊 Tables created:');
    tables.rows.forEach((row) => {
      console.log(`   • ${row.table_name}`);
    });

    console.log('\n✅ Database setup complete!\n');
    console.log('Next step: Run "npm run seed:demo" to populate with demo data\n');

  } catch (error: any) {
    console.error('❌ Setup failed:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

setupDatabase()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
