import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const {
  fetchSchemaTables,
  fetchIndexes
} = require('../../../scripts/lib/manifest-queries');
const { createPgClient } = require('../../../scripts/lib/pg-connect');

describe('faceVerificationSchema — Phase 1 schema, constraints & triggers', () => {
  let client;

  beforeAll(async () => {
    const dbUri = process.env.SUPABASE_TEST_DB_URI;
    client = await createPgClient(dbUri);
    await client.connect();
  });

  afterAll(async () => {
    if (client) {
      await client.end();
    }
  });

  // Helper to generate a 128-d float array
  function generateVector(len = 128) {
    return Array.from({ length: len }, (_, i) => Number((Math.sin(i + 1) * 0.5).toFixed(6)));
  }

  // ── Schema Manifest & Metadata Invariants ─────────────────────────────────

  test('Test 1: face_descriptors table exists with exact column definitions', async () => {
    const tables = await fetchSchemaTables(['face_descriptors']);
    const cols = tables.face_descriptors.columns;

    expect(cols.id).toBeDefined();
    expect(cols.id.type).toBe('uuid');
    expect(cols.id.nullable).toBe(false);

    expect(cols.user_id).toBeDefined();
    expect(cols.user_id.type).toBe('uuid');
    expect(cols.user_id.nullable).toBe(false);

    expect(cols.descriptor).toBeDefined();
    expect(cols.descriptor.type).toBe('ARRAY');
    expect(cols.descriptor.udtName).toBe('_float8');
    expect(cols.descriptor.nullable).toBe(false);

    expect(cols.enrolled_at).toBeDefined();
    expect(cols.enrolled_at.type).toBe('timestamp with time zone');
    expect(cols.enrolled_at.nullable).toBe(false);

    expect(cols.updated_at).toBeDefined();
    expect(cols.updated_at.type).toBe('timestamp with time zone');
    expect(cols.updated_at.nullable).toBe(false);

    expect(cols.consented_at).toBeDefined();
    expect(cols.consented_at.type).toBe('timestamp with time zone');
    expect(cols.consented_at.nullable).toBe(false);
  });

  test('Test 2: sessions table contains face verification telemetry columns', async () => {
    const tables = await fetchSchemaTables(['sessions']);
    const cols = tables.sessions.columns;

    expect(cols.last_face_verified_at).toBeDefined();
    expect(cols.last_face_verified_at.type).toBe('timestamp with time zone');
    expect(cols.last_face_verified_at.nullable).toBe(true);

    expect(cols.face_locked).toBeDefined();
    expect(cols.face_locked.type).toBe('boolean');
    expect(cols.face_locked.nullable).toBe(false);

    expect(cols.face_verification_misses).toBeDefined();
    expect(cols.face_verification_misses.type).toBe('smallint');
    expect(cols.face_verification_misses.nullable).toBe(false);
  });

  test('Test 3: backing UNIQUE index uq_face_descriptors_user_id exists', async () => {
    const indexes = await fetchIndexes(['uq_face_descriptors_user_id']);
    expect(indexes.uq_face_descriptors_user_id).toBeDefined();
    expect(indexes.uq_face_descriptors_user_id.table).toBe('face_descriptors');
    expect(indexes.uq_face_descriptors_user_id.definition).toMatch(/USING btree \(user_id\)/);
  });

  // ── Dimension Constraint Enforcement (chk_face_descriptor_128d) ───────────

  test('Test 4: valid 128-element float descriptor inserts cleanly', async () => {
    const mobile = `9900${crypto.randomUUID().replace(/\D/g, '').substring(0, 6)}`;
    const { rows: [user] } = await client.query(
      `INSERT INTO public.authorised_users (mobile_number, display_name, role)
       VALUES ($1, 'Test Face User', 'accounts')
       RETURNING id`,
      [mobile]
    );

    const descriptor = generateVector(128);
    const { rows: [fd] } = await client.query(
      `INSERT INTO public.face_descriptors (user_id, descriptor, consented_at)
       VALUES ($1, $2, now())
       RETURNING id, user_id, array_length(descriptor, 1) AS len`,
      [user.id, descriptor]
    );

    expect(fd.id).toBeDefined();
    expect(fd.user_id).toBe(user.id);
    expect(Number(fd.len)).toBe(128);

    // Clean up
    await client.query(`DELETE FROM public.authorised_users WHERE id = $1`, [user.id]);
  });

  test('Test 5: 127-element descriptor rejected by chk_face_descriptor_128d', async () => {
    const mobile = `9900${crypto.randomUUID().replace(/\D/g, '').substring(0, 6)}`;
    const { rows: [user] } = await client.query(
      `INSERT INTO public.authorised_users (mobile_number, display_name, role)
       VALUES ($1, 'Test Short Vector', 'accounts')
       RETURNING id`,
      [mobile]
    );

    const shortDescriptor = generateVector(127);
    await expect(
      client.query(
        `INSERT INTO public.face_descriptors (user_id, descriptor, consented_at)
         VALUES ($1, $2, now())`,
        [user.id, shortDescriptor]
      )
    ).rejects.toThrow(/chk_face_descriptor_128d/);

    await client.query(`DELETE FROM public.authorised_users WHERE id = $1`, [user.id]);
  });

  test('Test 6: 129-element descriptor rejected by chk_face_descriptor_128d', async () => {
    const mobile = `9900${crypto.randomUUID().replace(/\D/g, '').substring(0, 6)}`;
    const { rows: [user] } = await client.query(
      `INSERT INTO public.authorised_users (mobile_number, display_name, role)
       VALUES ($1, 'Test Long Vector', 'accounts')
       RETURNING id`,
      [mobile]
    );

    const longDescriptor = generateVector(129);
    await expect(
      client.query(
        `INSERT INTO public.face_descriptors (user_id, descriptor, consented_at)
         VALUES ($1, $2, now())`,
        [user.id, longDescriptor]
      )
    ).rejects.toThrow(/chk_face_descriptor_128d/);

    await client.query(`DELETE FROM public.authorised_users WHERE id = $1`, [user.id]);
  });

  test('Test 7: empty float array rejected by chk_face_descriptor_128d', async () => {
    const mobile = `9900${crypto.randomUUID().replace(/\D/g, '').substring(0, 6)}`;
    const { rows: [user] } = await client.query(
      `INSERT INTO public.authorised_users (mobile_number, display_name, role)
       VALUES ($1, 'Test Empty Array', 'accounts')
       RETURNING id`,
      [mobile]
    );

    await expect(
      client.query(
        `INSERT INTO public.face_descriptors (user_id, descriptor, consented_at)
         VALUES ($1, '{}'::double precision[], now())`,
        [user.id]
      )
    ).rejects.toThrow(/chk_face_descriptor_128d/);

    await client.query(`DELETE FROM public.authorised_users WHERE id = $1`, [user.id]);
  });

  // ── Relational Invariants (Unique & Cascade) ──────────────────────────────

  test('Test 8: duplicate insert on same user_id rejected by uq_face_descriptors_user_id', async () => {
    const mobile = `9900${crypto.randomUUID().replace(/\D/g, '').substring(0, 6)}`;
    const { rows: [user] } = await client.query(
      `INSERT INTO public.authorised_users (mobile_number, display_name, role)
       VALUES ($1, 'Test Dup User', 'accounts')
       RETURNING id`,
      [mobile]
    );

    const desc1 = generateVector(128);
    await client.query(
      `INSERT INTO public.face_descriptors (user_id, descriptor, consented_at)
       VALUES ($1, $2, now())`,
      [user.id, desc1]
    );

    const desc2 = generateVector(128);
    await expect(
      client.query(
        `INSERT INTO public.face_descriptors (user_id, descriptor, consented_at)
         VALUES ($1, $2, now())`,
        [user.id, desc2]
      )
    ).rejects.toThrow(/uq_face_descriptors_user_id/);

    await client.query(`DELETE FROM public.authorised_users WHERE id = $1`, [user.id]);
  });

  test('Test 9: ON CONFLICT upsert overwrites descriptor cleanly', async () => {
    const mobile = `9900${crypto.randomUUID().replace(/\D/g, '').substring(0, 6)}`;
    const { rows: [user] } = await client.query(
      `INSERT INTO public.authorised_users (mobile_number, display_name, role)
       VALUES ($1, 'Test Upsert User', 'accounts')
       RETURNING id`,
      [mobile]
    );

    const desc1 = generateVector(128);
    await client.query(
      `INSERT INTO public.face_descriptors (user_id, descriptor, consented_at)
       VALUES ($1, $2, now())`,
      [user.id, desc1]
    );

    const desc2 = Array.from({ length: 128 }, () => 0.999);
    await client.query(
      `INSERT INTO public.face_descriptors (user_id, descriptor, consented_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE
       SET descriptor = EXCLUDED.descriptor, updated_at = now()`,
      [user.id, desc2]
    );

    const { rows: fds } = await client.query(
      `SELECT descriptor FROM public.face_descriptors WHERE user_id = $1`,
      [user.id]
    );

    expect(fds.length).toBe(1);
    expect(fds[0].descriptor[0]).toBe(0.999);

    await client.query(`DELETE FROM public.authorised_users WHERE id = $1`, [user.id]);
  });

  test('Test 10: deleting user cascades to delete face_descriptors row', async () => {
    const mobile = `9900${crypto.randomUUID().replace(/\D/g, '').substring(0, 6)}`;
    const { rows: [user] } = await client.query(
      `INSERT INTO public.authorised_users (mobile_number, display_name, role)
       VALUES ($1, 'Test Cascade User', 'accounts')
       RETURNING id`,
      [mobile]
    );

    const desc = generateVector(128);
    await client.query(
      `INSERT INTO public.face_descriptors (user_id, descriptor, consented_at)
       VALUES ($1, $2, now())`,
      [user.id, desc]
    );

    // Verify row exists
    const { rows: before } = await client.query(
      `SELECT id FROM public.face_descriptors WHERE user_id = $1`,
      [user.id]
    );
    expect(before.length).toBe(1);

    // Delete user
    await client.query(`DELETE FROM public.authorised_users WHERE id = $1`, [user.id]);

    // Verify cascaded deletion of face_descriptors
    const { rows: after } = await client.query(
      `SELECT id FROM public.face_descriptors WHERE user_id = $1`,
      [user.id]
    );
    expect(after.length).toBe(0);
  });

  // ── Sessions & Trigger Invariants ─────────────────────────────────────────

  test('Test 11: negative face_verification_misses rejected by chk_sessions_face_misses_non_negative', async () => {
    const mobile = `9900${crypto.randomUUID().replace(/\D/g, '').substring(0, 6)}`;
    const { rows: [user] } = await client.query(
      `INSERT INTO public.authorised_users (mobile_number, display_name, role)
       VALUES ($1, 'Test Session Invariant', 'accounts')
       RETURNING id`,
      [mobile]
    );

    const { rows: [session] } = await client.query(
      `INSERT INTO public.sessions (user_id, face_verification_misses)
       VALUES ($1, 0)
       RETURNING id`,
      [user.id]
    );

    await expect(
      client.query(
        `UPDATE public.sessions SET face_verification_misses = -1 WHERE id = $1`,
        [session.id]
      )
    ).rejects.toThrow(/chk_sessions_face_misses_non_negative/);

    await client.query(`DELETE FROM public.sessions WHERE id = $1`, [session.id]);
    await client.query(`DELETE FROM public.authorised_users WHERE id = $1`, [user.id]);
  });

  test('Test 12: trg_face_descriptor_updated_at automatically updates updated_at timestamp', async () => {
    const mobile = `9900${crypto.randomUUID().replace(/\D/g, '').substring(0, 6)}`;
    const { rows: [user] } = await client.query(
      `INSERT INTO public.authorised_users (mobile_number, display_name, role)
       VALUES ($1, 'Test Trigger User', 'accounts')
       RETURNING id`,
      [mobile]
    );

    const desc1 = generateVector(128);
    // Explicitly seed older updated_at to ensure detectable diff
    const { rows: [inserted] } = await client.query(
      `INSERT INTO public.face_descriptors (user_id, descriptor, updated_at, consented_at)
       VALUES ($1, $2, now() - INTERVAL '10 seconds', now())
       RETURNING id, updated_at`,
      [user.id, desc1]
    );

    const desc2 = generateVector(128);
    const { rows: [updated] } = await client.query(
      `UPDATE public.face_descriptors
       SET descriptor = $2
       WHERE id = $1
       RETURNING id, updated_at`,
      [inserted.id, desc2]
    );

    expect(new Date(updated.updated_at).getTime()).toBeGreaterThan(
      new Date(inserted.updated_at).getTime()
    );

    await client.query(`DELETE FROM public.authorised_users WHERE id = $1`, [user.id]);
  });
});
