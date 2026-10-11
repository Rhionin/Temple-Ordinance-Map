// Entry point so `node --test test/` runs every suite. Node 21+ executes a
// directory argument as a file; test/package.json "main" points here.
const fs = require('fs');
for (const file of fs.readdirSync(__dirname).filter(name => name.endsWith('.test.js')).sort()) {
  require('./' + file);
}
