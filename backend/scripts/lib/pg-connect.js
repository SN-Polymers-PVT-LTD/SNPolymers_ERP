'use strict';

const dns = require('dns').promises;
const { URL } = require('url');
const { Client } = require('pg');

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isSupabaseDirectHost(hostname) {
  return hostname.startsWith('db.') && hostname.endsWith('.supabase.co');
}

function isSupabasePoolerHost(hostname) {
  return hostname.includes('pooler.supabase.com');
}

/**
 * Supabase direct URLs (db.*.supabase.co) are often IPv6-only.
 * Use the Session pooler URL from Dashboard → Connect for IPv4 networks.
 */
async function createPgClient(connectionString) {
  const parsed = new URL(connectionString);
  const originalHostname = parsed.hostname;

  if (isLocalHost(originalHostname)) {
    return new Client({ connectionString });
  }

  const ssl = {
    rejectUnauthorized: true,
    servername: originalHostname
  };

  // Session / transaction pooler — IPv4
  if (isSupabasePoolerHost(originalHostname)) {
    const separator = connectionString.includes('?') ? '&' : '?';
    const uri = connectionString.includes('sslmode=')
      ? connectionString
      : `${connectionString}${separator}uselibpqcompat=true&sslmode=require`;
    return new Client({ connectionString: uri });
  }

  // Direct db.*.supabase.co — use IPv4 only when an A record exists (paid IPv4 add-on)
  if (isSupabaseDirectHost(originalHostname)) {
    try {
      const { address } = await dns.lookup(originalHostname, { family: 4 });
      parsed.hostname = address;
      return new Client({
        connectionString: parsed.toString(),
        ssl: { rejectUnauthorized: true, servername: originalHostname }
      });
    } catch {
      return new Client({ connectionString, ssl });
    }
  }

  // Other remote hosts — prefer IPv4 when available
  try {
    const { address } = await dns.lookup(originalHostname, { family: 4 });
    parsed.hostname = address;
    return new Client({
      connectionString: parsed.toString(),
      ssl: { rejectUnauthorized: true, servername: originalHostname }
    });
  } catch {
    return new Client({ connectionString, ssl });
  }
}

module.exports = { createPgClient, isSupabaseDirectHost, isSupabasePoolerHost };
