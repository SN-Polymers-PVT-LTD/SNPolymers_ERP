const http = require('http');

/**
 * Issue a single HTTP request against an Express app listening on an ephemeral port.
 */
function requestApp(app, method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
      const reqHeaders = { ...headers };
      if (payload && !reqHeaders['Content-Type'] && !reqHeaders['content-type']) {
        reqHeaders['Content-Type'] = 'application/json';
      }
      if (payload && !reqHeaders['Content-Length'] && !reqHeaders['content-length']) {
        reqHeaders['Content-Length'] = Buffer.byteLength(payload);
      }
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          headers: reqHeaders
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            server.close((closeErr) => {
              if (closeErr) return reject(closeErr);
              let parsedBody = data;
              try {
                parsedBody = data ? JSON.parse(data) : null;
              } catch {
                // keep raw string
              }
              resolve({ statusCode: res.statusCode, headers: res.headers, body: parsedBody });
            });
          });
        }
      );

      req.on('error', (err) => {
        server.close(() => reject(err));
      });
      if (payload) {
        req.write(payload);
      }
      req.end();
    });

    server.on('error', reject);
  });
}

module.exports = { requestApp };
