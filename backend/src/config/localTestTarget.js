// Only fixed local targets are supported. Never accept remote .env URLs here.
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
function getLocalTestTarget(profile = process.env.LOCAL_SUPABASE_TEST_PROFILE || 'shared') {
  if (!['shared', 'payroll'].includes(profile)) throw new Error('Unsupported local Supabase test profile.');
  const isolated = profile === 'payroll';
  return {
    profile, projectId: isolated ? 'SNPolymersPayrollTests' : 'SNPolymers',
    apiUrl: isolated ? 'http://127.0.0.1:55421' : 'http://127.0.0.1:54321',
    dbUri: isolated ? 'postgresql://postgres:postgres@127.0.0.1:55422/postgres' : 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    serviceRoleKey
  };
}
module.exports = { getLocalTestTarget };
