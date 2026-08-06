const mockRes = require('./mockRes');

function mockResWithCookies() {
  const res = mockRes();
  res.cookies = {};
  res.clearedCookies = [];

  res.cookie = function (name, value) {
    this.cookies[name] = value;
    return this;
  };

  res.clearCookie = function (name) {
    delete this.cookies[name];
    this.clearedCookies.push(name);
    return this;
  };

  return res;
}

module.exports = mockResWithCookies;
