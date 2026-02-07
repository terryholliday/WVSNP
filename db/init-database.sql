-- ============================================
-- WVSNP Database Initialization
-- ============================================

-- Create database (run this separately if needed)
-- CREATE DATABASE wvsnp_gms;

-- Connect to the database
\c wvsnp_gms

-- Run the schema
\i schema.sql

-- Verify tables were created
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Show event_log structure
\d event_log

-- Ready for seeding!
SELECT 'Database initialized successfully!' as status;
