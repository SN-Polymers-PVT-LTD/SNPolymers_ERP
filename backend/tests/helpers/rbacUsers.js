const crypto = require('crypto');
const setupUsers = require('./setupUsers');
const { supabase } = require('../../src/db/supabase');

async function seedRbacUsers() {
  const id = crypto.randomUUID().replace(/\D/g, '').substring(0, 8);
  const users = {
    je: `9100${id}`,
    zo: `9200${id}`,
    ho: `9300${id}`,
    admin: `9400${id}`,
    accounts: `9500${id}`
  };

  await setupUsers([
    {
      mobile_number: users.je,
      role: 'je',
      is_active: true,
      display_name: `RBAC JE ${id}`,
      permissions: {}
    },
    {
      mobile_number: users.zo,
      role: 'zo',
      is_active: true,
      display_name: `RBAC ZO ${id}`,
      permissions: {}
    },
    {
      mobile_number: users.ho,
      role: 'ho',
      is_active: true,
      display_name: `RBAC HO ${id}`,
      permissions: {}
    },
    {
      mobile_number: users.admin,
      role: 'admin',
      is_active: true,
      display_name: `RBAC Admin ${id}`,
      permissions: {}
    },
    {
      mobile_number: users.accounts,
      role: 'accounts',
      is_active: true,
      display_name: `RBAC Accounts ${id}`,
      permissions: {}
    }
  ]);

  return { id, users };
}

function userForRole(ctx, role) {
  const mobile = ctx.users[role];
  if (!mobile) {
    throw new Error(`Unknown RBAC role: ${role}`);
  }
  return { role, mobile_number: mobile };
}

async function cleanupRbacUsers(ctx) {
  if (!ctx?.users) return;
  await supabase.from('authorised_users').delete().in('mobile_number', Object.values(ctx.users));
}

module.exports = {
  seedRbacUsers,
  userForRole,
  cleanupRbacUsers
};
