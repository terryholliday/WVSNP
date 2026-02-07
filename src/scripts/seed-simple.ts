/**
 * Simplified WVSNP Demo Data Seeder
 */

import { config } from 'dotenv';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/wvsnp_gms',
});

async function seedSimpleData() {
  console.log('🌱 Starting simplified WVSNP demo data seed...\n');

  const grantCycleId = randomUUID();
  const systemActorId = randomUUID(); // System actor UUID
  const cycleStartDate = new Date('2024-07-01');

  // Create Grant Cycle
  console.log('📅 Creating grant cycle...');
  await pool.query(
    `INSERT INTO event_log (
      event_id, event_type, aggregate_id, aggregate_type,
      event_data, occurred_at, ingested_at, grant_cycle_id, correlation_id, causation_id,
      actor_id, actor_type
    ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW(), $7, $8, $9, $10, $11)`,
    [
      randomUUID(),
      'GRANT_CYCLE_CREATED',
      grantCycleId,
      'GRANT_CYCLE',
      JSON.stringify({
        grantCycleId,
        name: 'FY2025 WVSNP Grant Cycle',
        fiscalYear: 2025,
        startDate: cycleStartDate.toISOString(),
        endDate: '2025-06-30',
        status: 'ACTIVE',
      }),
      cycleStartDate,
      grantCycleId,
      randomUUID(),
      null,
      systemActorId,
      'SYSTEM',
    ]
  );

  console.log('✅ Grant cycle created');
  console.log('\n🎉 Seeding complete!\n');
  console.log('Next step: Start the API with "npm run dev"\n');

  await pool.end();
}

seedSimpleData()
  .then(() => process.exit(0))
  .catch((error: any) => {
    console.error('❌ Seeding failed:', error.message);
    process.exit(1);
  });
