const fs = require('fs');
const path = require('path');

// Simple codemod script to bootstrap Vitest migration from legacy milestone tests
function convertFile(srcRelativePath) {
  const srcPath = path.resolve(__dirname, srcRelativePath);
  if (!fs.existsSync(srcPath)) {
    console.error(`Source file not found: ${srcPath}`);
    return;
  }

  let content = fs.readFileSync(srcPath, 'utf8');

  // 1. Adjust require paths (moving from tests/milestones/ or tests/hardening/ to tests/vitest/.../ shifts them one level deeper)
  content = content.replace(/require\(['"]\.\.\/\.\.\/src\/(.*?)['"]\)/g, "require('../../../src/$1')");
  content = content.replace(/require\(['"]\.\.\/helpers\/(.*?)['"]\)/g, "require('../../helpers/$1')");

  // 2. Add vitest import at the top
  const header = `import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';\nconst crypto = require('crypto');\n`;
  content = header + content;

  // Determine output path
  const filename = path.basename(srcPath);
  const isHardening = srcRelativePath.includes('hardening');
  const destDir = path.resolve(__dirname, 'vitest', isHardening ? 'hardening' : 'milestones');
  
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const destFilename = filename.replace(/^test_/, '').replace(/\.js$/, '.test.js');
  const destPath = path.join(destDir, destFilename);

  fs.writeFileSync(destPath, content, 'utf8');
  console.log(`Successfully bootstrapped: ${destPath}`);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: node convert_to_vitest.js <relative-path-to-test-file>');
} else {
  convertFile(args[0]);
}
