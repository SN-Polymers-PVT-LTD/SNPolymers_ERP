'use strict';

const fs = require('fs');
const path = require('path');

const MANIFESTS_DIR = path.join(__dirname, '../../tests/manifests');

function writeGeneratedManifest(filename, data) {
  const filePath = path.join(MANIFESTS_DIR, filename);
  const content =
    `// AUTO-GENERATED — do not edit. Run: npm run generate:manifests\n` +
    `module.exports = ${JSON.stringify(data, null, 2)};\n`;

  // Skip writes when only metadata would change — keeps CI `git diff` stable.
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8');
    if (existing === content) {
      return filePath;
    }
  }

  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

module.exports = { writeGeneratedManifest, MANIFESTS_DIR };
