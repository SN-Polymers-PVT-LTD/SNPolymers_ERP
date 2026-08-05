const http = require('http');

/**
 * Issue a single HTTP request against an Express app listening on an ephemeral port.
 */
function requestApp(app, method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          headers
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            server.close((closeErr) => {
              if (closeErr) return reject(closeErr);
              let body = data;
              try {
                body = data ? JSON.parse(data) : null;
              } catch {
                // keep raw string
              }
              resolve({ statusCode: res.statusCode, headers: res.headers, body });
            });
          });
        }
      );

      req.on('error', (err) => {
        server.close(() => reject(err));
      });
      req.end();
    });

    server.on('error', reject);
  });
}

module.exports = { requestApp };
