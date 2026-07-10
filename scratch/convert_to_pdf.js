const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { marked } = require('marked');

const mdPath = path.join(__dirname, '../documentation/COMPREHENSIVE_PROJECT_REPORT.md');
const pdfPath = path.join(__dirname, '../documentation/COMPREHENSIVE_PROJECT_REPORT.pdf');

(async () => {
  try {
    const mdContent = fs.readFileSync(mdPath, 'utf8');
    const htmlContent = marked(mdContent);

    const fullHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Comprehensive Project & Engineering Report</title>
  <style>
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.6;
      color: #1e293b;
      margin: 0;
      padding: 20px;
      font-size: 13px;
    }
    
    h1, h2, h3, h4, h5, h6 {
      color: #0f172a;
      font-weight: 600;
      margin-top: 24px;
      margin-bottom: 12px;
      page-break-after: avoid;
    }
    
    h1 {
      font-size: 24px;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 8px;
      margin-top: 36px;
    }
    
    h2 {
      font-size: 18px;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 6px;
      margin-top: 28px;
    }
    
    h3 {
      font-size: 14px;
    }
    
    p {
      margin-top: 0;
      margin-bottom: 14px;
    }
    
    a {
      color: #2563eb;
      text-decoration: none;
    }
    
    code {
      font-family: SFMono-Regular, Consolas, "Liberation Mono", Menlo, Courier, monospace;
      background-color: #f1f5f9;
      padding: 2px 4px;
      border-radius: 4px;
      font-size: 85%;
    }
    
    pre {
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
      margin-bottom: 16px;
    }
    
    pre code {
      background-color: transparent;
      padding: 0;
      font-size: 90%;
      color: #334155;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      font-size: 11px;
    }
    
    th, td {
      border: 1px solid #cbd5e1;
      padding: 6px 8px;
      text-align: left;
    }
    
    th {
      background-color: #f1f5f9;
      font-weight: 600;
      color: #334155;
    }
    
    tr:nth-child(even) {
      background-color: #f8fafc;
    }
    
    blockquote {
      margin: 0 0 16px 0;
      padding: 8px 16px;
      border-left: 4px solid #cbd5e1;
      background-color: #f8fafc;
      color: #475569;
    }
    
    hr {
      border: 0;
      border-top: 1px solid #e2e8f0;
      margin: 30px 0;
      page-break-after: always;
    }
    
    ul, ol {
      margin-top: 0;
      margin-bottom: 14px;
      padding-left: 20px;
    }
    
    li {
      margin-bottom: 4px;
    }
  </style>
</head>
<body>
  ${htmlContent}
</body>
</html>
    `;

    console.log('Launching Puppeteer...');
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    
    console.log('Setting page content...');
    await page.setContent(fullHtml, { waitUntil: 'load' });
    
    console.log('Generating PDF...');
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      margin: {
        top: '60px',
        bottom: '60px',
        left: '50px',
        right: '50px'
      },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="font-family: system-ui, sans-serif; font-size: 8px; width: 100%; text-align: center; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 4px; margin-left: 50px; margin-right: 50px;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>'
    });

    console.log('PDF successfully generated at: ' + pdfPath);
    await browser.close();
    process.exit(0);
  } catch (error) {
    console.error('Error during conversion:', error);
    process.exit(1);
  }
})();
