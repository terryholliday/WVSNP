require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function testConnection() {
  try {
    console.log('Testing database connection...\n');
    
    // Test 1: Event log count
    const events = await pool.query('SELECT COUNT(*) as count FROM event_log');
    console.log('✓ Total events:', events.rows[0].count);
    
    // Test 2: Vouchers count
    const vouchers = await pool.query('SELECT COUNT(*) as count FROM vouchers_projection');
    console.log('✓ Total vouchers:', vouchers.rows[0].count);
    
    // Test 3: Claims by status
    const submitted = await pool.query("SELECT COUNT(*) as count FROM claims_projection WHERE status = 'SUBMITTED'");
    console.log('✓ SUBMITTED claims:', submitted.rows[0].count);
    
    const approved = await pool.query("SELECT COUNT(*) as count FROM claims_projection WHERE status = 'APPROVED'");
    console.log('✓ APPROVED claims:', approved.rows[0].count);
    
    // Test 4: Sample claim data
    const sampleClaims = await pool.query(`
      SELECT c.claim_id, c.status, c.submitted_amount_cents, vc.clinic_name
      FROM claims_projection c
      JOIN vet_clinics_projection vc ON vc.clinic_id = c.clinic_id
      LIMIT 3
    `);
    
    console.log('\n✓ Sample claims:');
    sampleClaims.rows.forEach(claim => {
      console.log(`  - ${claim.claim_id.substring(0, 8)}... | ${claim.status} | $${claim.submitted_amount_cents / 100} | ${claim.clinic_name}`);
    });
    
    console.log('\n✅ Database connection successful! Seed data is present.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

testConnection();
