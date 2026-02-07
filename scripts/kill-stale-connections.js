const { Pool } = require('pg');
const p = new Pool({
  host: 'localhost',
  port: 5433,
  database: 'wvsnp_test',
  user: 'postgres',
  password: 'postgres',
});

p.query(
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'wvsnp_test' AND pid != pg_backend_pid()"
)
  .then((r) => {
    console.log('terminated', r.rowCount, 'connections');
    return p.end();
  })
  .catch((e) => {
    console.error(e.message);
    p.end();
  });
