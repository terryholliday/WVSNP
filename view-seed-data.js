require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function viewSeedData() {
  try {
    console.log('=== WVSNP GMS Seed Data Summary ===\n');
    
    // Grants
    const grants = await pool.query(`
      SELECT grant_id, bucket_type, awarded_cents, 
             available_cents, encumbered_cents, liquidated_cents
      FROM grant_balances_projection
      ORDER BY bucket_type
      LIMIT 10
    `);
    console.log('📊 GRANTS (first 10):');
    grants.rows.forEach(g => {
      console.log(`  ${g.bucket_type}: $${g.awarded_cents / 100} awarded, $${g.available_cents / 100} available, $${g.liquidated_cents / 100} liquidated`);
    });
    
    // Vouchers
    const vouchers = await pool.query(`
      SELECT voucher_id, voucher_code, status, issued_at
      FROM vouchers_projection
      ORDER BY issued_at DESC
      LIMIT 10
    `);
    console.log('\n🎫 VOUCHERS (latest 10):');
    vouchers.rows.forEach(v => {
      console.log(`  ${v.voucher_code} | ${v.status} | ${v.issued_at.toISOString().split('T')[0]}`);
    });
    
    // Claims by status
    const claimStats = await pool.query(`
      SELECT status, COUNT(*) as count, SUM(submitted_amount_cents) as total_cents
      FROM claims_projection
      GROUP BY status
      ORDER BY status
    `);
    console.log('\n📋 CLAIMS BY STATUS:');
    claimStats.rows.forEach(s => {
      console.log(`  ${s.status}: ${s.count} claims, $${s.total_cents / 100} total`);
    });
    
    // Clinics
    const clinics = await pool.query(`
      SELECT clinic_id, clinic_name, status, license_number
      FROM vet_clinics_projection
      ORDER BY clinic_name
      LIMIT 10
    `);
    console.log('\n🏥 VET CLINICS (first 10):');
    clinics.rows.forEach(c => {
      console.log(`  ${c.clinic_name} | ${c.status} | License: ${c.license_number || 'N/A'}`);
    });
    
    // Invoices
    const invoices = await pool.query(`
      SELECT invoice_id, clinic_id, invoice_period_start, invoice_period_end, 
             total_amount_cents, status, jsonb_array_length(claim_ids) as claim_count
      FROM invoices_projection
      ORDER BY invoice_period_start DESC
      LIMIT 10
    `);
    console.log('\n💰 INVOICES (latest 10):');
    invoices.rows.forEach(i => {
      console.log(`  ${i.invoice_period_start.toISOString().split('T')[0]} to ${i.invoice_period_end.toISOString().split('T')[0]} | ${i.claim_count} claims | $${i.total_amount_cents / 100} | ${i.status}`);
    });
    
    console.log('\n✅ Seed data is present and accessible!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

viewSeedData();
