'use strict';

const fs = require('fs');
const path = require('path');

const MANIFESTS_DIR = path.join(__dirname, '../../tests/manifests');

function writeGeneratedManifest(filename, data) {
  const filePath = path.join(MANIFESTS_DIR, filename);
  const payload = {
    generatedAt: new Date().toISOString(),
    ...data
  };
  const content =
    `// AUTO-GENERATED — do not edit. Run: npm run generate:manifests\n` +
    `module.exports = ${JSON.stringify(payload, null, 2)};\n`;
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

module.exports = { writeGeneratedManifest, MANIFESTS_DIR };
