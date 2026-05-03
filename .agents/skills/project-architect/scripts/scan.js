// Scans project tree and prints file sizes
// Run from project root: node .agents/skills/project-architect/scripts/scan.js

const fs = require('fs');
const path = require('path');

const IGNORE = ['node_modules', '.git', '.agents', 'public/favicon', 'backup'];
const ROOT = process.cwd();

function scan(dir, depth = 0) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORE.some(i => entry.name.includes(i))) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full);
    const indent = '  '.repeat(depth);
    if (entry.isDirectory()) {
      console.log(`${indent}📁 ${entry.name}/`);
      scan(full, depth + 1);
    } else {
      const size = fs.statSync(full).size;
      console.log(`${indent}📄 ${entry.name} (${size}b)`);
    }
  }
}

console.log('=== PROJECT SCAN:', ROOT, '===');
scan(ROOT);