// Migrations 0001 and 0002 were applied by hand, so remote D1 may already
// have the tables without wrangler's d1_migrations rows. Seeding those rows
// lets `wrangler d1 migrations apply` skip work that is already in place.
// A brand-new database (no lights table) is left alone so wrangler applies both.
const { execFileSync } = require('child_process');

const DATABASE = 'temple-ordinance-map';
const CREATE_TRACKING = `CREATE TABLE IF NOT EXISTS d1_migrations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;

function seedNames({ lights, updatedColumn }) {
  if (!lights) return [];
  const names = ['0001_init.sql'];
  if (updatedColumn) names.push('0002_light_updated.sql');
  return names;
}

function parseWranglerJson(text) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('wrangler did not return JSON');
  return JSON.parse(text.slice(start, end + 1));
}

function resultRows(payload) {
  const block = Array.isArray(payload) ? payload[0] : payload;
  return (block && block.results) || [];
}

function d1(command) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', DATABASE, '--remote', '--json', '--command', command],
    { encoding: 'utf8', env: process.env }
  );
  return resultRows(parseWranglerJson(out));
}

function main() {
  const lights = d1("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'lights'");
  const updated = lights.length
    ? d1("SELECT name FROM pragma_table_info('lights') WHERE name = 'updated'")
    : [];
  const names = seedNames({ lights: lights.length > 0, updatedColumn: updated.length > 0 });
  if (!names.length) {
    console.log(JSON.stringify({ event: 'd1_migration_seed', names: [] }));
    return;
  }
  d1(CREATE_TRACKING);
  for (const name of names) {
    d1("INSERT OR IGNORE INTO d1_migrations (name) VALUES ('" + name + "')");
  }
  console.log(JSON.stringify({ event: 'd1_migration_seed', names }));
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(JSON.stringify({ event: 'd1_migration_seed_error', message: error.message }));
    process.exit(1);
  }
}

module.exports = { seedNames, parseWranglerJson, resultRows };
