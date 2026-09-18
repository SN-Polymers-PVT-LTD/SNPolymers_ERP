import { describe, expect, test } from 'vitest';
const fs = require('fs');
const path = require('path');
const { createPgClient } = require('../../../scripts/lib/pg-connect');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');

describe('Supabase import files verification', () => {
  test('seed scripts execute cleanly and idempotently against live schema', async () => {
    await requireLocalSupabase();
    const client = await createPgClient('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    await client.connect();

    try {
      const baseDir = path.resolve(__dirname, '../../../../');
      const subSqlPath = path.join(baseDir, 'supabase', 'imports', 'seed_subcontract_work_master.sql');
      const matSqlPath = path.join(baseDir, 'supabase', 'imports', 'seed_material_master.sql');
      const subCsvPath = path.join(baseDir, 'supabase', 'imports', 'subcontract_work_master_import_ready.csv');
      const matCsvPath = path.join(baseDir, 'supabase', 'imports', 'material_master_import_ready.csv');

      expect(fs.existsSync(subSqlPath)).toBe(true);
      expect(fs.existsSync(matSqlPath)).toBe(true);
      expect(fs.existsSync(subCsvPath)).toBe(true);
      expect(fs.existsSync(matCsvPath)).toBe(true);

      // 1. Verify Subcontract Work Master Seed Script
      const subSql = fs.readFileSync(subSqlPath, 'utf8');
      await client.query(subSql);

      const { rows: subRows } = await client.query(
        "SELECT count(*)::int AS count FROM public.subcontract_work_master WHERE created_by = '+919883321834'"
      );
      expect(subRows[0].count).toBe(106);

      // Run again to verify idempotency (ON CONFLICT DO UPDATE)
      await client.query(subSql);
      const { rows: subRowsAfter } = await client.query(
        "SELECT count(*)::int AS count FROM public.subcontract_work_master WHERE created_by = '+919883321834'"
      );
      expect(subRowsAfter[0].count).toBe(106);

      // 2. Verify Material Master Seed Script
      const matSql = fs.readFileSync(matSqlPath, 'utf8');
      await client.query(matSql);

      const { rows: matRows } = await client.query(
        "SELECT count(*)::int AS count FROM public.material_master WHERE created_by = '+919883321834'"
      );
      expect(matRows[0].count).toBe(2063);

      // Run again to verify idempotency (WHERE NOT EXISTS)
      await client.query(matSql);
      const { rows: matRowsAfter } = await client.query(
        "SELECT count(*)::int AS count FROM public.material_master WHERE created_by = '+919883321834'"
      );
      expect(matRowsAfter[0].count).toBe(2063);

      // 3. Verify Beneficiaries Seed Script
      const benSqlPath = path.join(baseDir, 'supabase', 'imports', 'seed_beneficiaries.sql');
      expect(fs.existsSync(benSqlPath)).toBe(true);
      const benSql = fs.readFileSync(benSqlPath, 'utf8');
      await client.query(benSql);

      const { rows: bmRows } = await client.query(
        "SELECT count(*)::int AS count FROM public.beneficiary_master WHERE created_by = '+919883321834'"
      );
      expect(bmRows[0].count).toBe(30);

      const { rows: pbmRows } = await client.query(
        "SELECT count(*)::int AS count FROM public.projects_beneficiary_master WHERE created_by = '+919883321834'"
      );
      expect(pbmRows[0].count).toBe(30);

      // Run again to verify idempotency
      await client.query(benSql);
      const { rows: bmRowsAfter } = await client.query(
        "SELECT count(*)::int AS count FROM public.beneficiary_master WHERE created_by = '+919883321834'"
      );
      expect(bmRowsAfter[0].count).toBe(30);

      // 4. Verify Debit Banks Seed Script
      const debitSqlPath = path.join(baseDir, 'supabase', 'imports', 'seed_debit_banks.sql');
      expect(fs.existsSync(debitSqlPath)).toBe(true);
      const debitSql = fs.readFileSync(debitSqlPath, 'utf8');
      await client.query(debitSql);

      const { rows: bbmRows } = await client.query(
        "SELECT bank_name FROM public.bank_balance_master WHERE created_by = '+919883321834'"
      );
      const bankNames = bbmRows.map(r => r.bank_name);
      expect(bankNames).toHaveLength(6);
      expect(bankNames).toContain('SNP CANARA CC');
      expect(bankNames).toContain('SNP CANARA CA');
      expect(bankNames).toContain('SNP CANARA ESPO');
      expect(bankNames).not.toContain('Credit');

      // Run again to verify idempotency
      await client.query(debitSql);

      // Clean up seeded test rows (Accounts master tables have a database trigger prohibiting hard deletes)
      await client.query("DELETE FROM public.subcontract_work_master WHERE created_by = '+919883321834'");
      await client.query("DELETE FROM public.material_master WHERE created_by = '+919883321834'");
      await client.query("DELETE FROM public.projects_beneficiary_master WHERE created_by = '+919883321834'");
    } finally {
      await client.end();
    }
  });
});
