function mockRes() {
  return {
    statusCode: 200,
    jsonData: null,
    headers: {},
    // Binary/streamed body (e.g. exportBulkNeft's .xlsx), as opposed to jsonData above.
    body: null,
    status: function (code) {
      this.statusCode = code;
      return this;
    },
    json: function (data) {
      this.jsonData = data;
      return this;
    },
    setHeader: function (name, value) {
      this.headers[name] = value;
      return this;
    },
    getHeader: function (name) {
      return this.headers[name];
    },
    end: function (chunk) {
      if (chunk !== undefined) this.body = chunk;
      return this;
    }
  };
}

module.exports = mockRes;
