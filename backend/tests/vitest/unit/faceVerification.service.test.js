import { describe, test, expect, vi, beforeEach } from 'vitest';
const {
  euclideanDistance,
  verifyDescriptor,
  getDescriptor
} = require('../../../src/services/faceVerification.service');
const { supabase } = require('../../../src/db/supabase');

describe('faceVerification.service unit tests', () => {
  function generateVector(val = 0.5, len = 128) {
    return Array.from({ length: len }, () => val);
  }

  describe('euclideanDistance', () => {
    test('returns 0.0 for identical vectors (identity)', () => {
      const v1 = generateVector(0.25);
      const v2 = generateVector(0.25);
      expect(euclideanDistance(v1, v2)).toBe(0);
    });

    test('computes exact distance for known orthogonal unit vectors', () => {
      // Vector e0 = [1, 0, 0, ...], Vector e1 = [0, 1, 0, ...]
      const e0 = generateVector(0);
      e0[0] = 1;
      const e1 = generateVector(0);
      e1[1] = 1;

      const dist = euclideanDistance(e0, e1);
      expect(dist).toBeCloseTo(Math.sqrt(2), 6);
    });

    test('satisfies symmetry property: dist(a, b) === dist(b, a)', () => {
      const a = Array.from({ length: 128 }, (_, i) => Math.sin(i));
      const b = Array.from({ length: 128 }, (_, i) => Math.cos(i));

      expect(euclideanDistance(a, b)).toBeCloseTo(euclideanDistance(b, a), 10);
    });

    test('satisfies triangle inequality: dist(a, c) <= dist(a, b) + dist(b, c)', () => {
      const a = Array.from({ length: 128 }, (_, i) => Math.sin(i));
      const b = Array.from({ length: 128 }, (_, i) => Math.cos(i));
      const c = Array.from({ length: 128 }, (_, i) => Math.tan(i % 1.5));

      const dAC = euclideanDistance(a, c);
      const dAB = euclideanDistance(a, b);
      const dBC = euclideanDistance(b, c);

      expect(dAC).toBeLessThanOrEqual(dAB + dBC + 1e-9);
    });

    test('detects near-identical vectors below default match threshold 0.6', () => {
      const a = generateVector(0.1);
      const b = generateVector(0.1);
      b[0] += 0.05; // tiny perturbation
      const dist = euclideanDistance(a, b);
      expect(dist).toBeLessThan(0.6);
    });

    test('detects distant vectors above default match threshold 0.6', () => {
      const a = generateVector(0.1);
      const b = generateVector(0.8);
      const dist = euclideanDistance(a, b);
      expect(dist).toBeGreaterThan(0.6);
    });

    test('throws Error if first vector length is not 128', () => {
      const short = generateVector(0.5, 127);
      const standard = generateVector(0.5, 128);
      expect(() => euclideanDistance(short, standard)).toThrow(/float arrays of length 128/);
    });

    test('throws Error if second vector length is not 128', () => {
      const long = generateVector(0.5, 129);
      const standard = generateVector(0.5, 128);
      expect(() => euclideanDistance(standard, long)).toThrow(/float arrays of length 128/);
    });

    test('throws Error if inputs are not arrays', () => {
      const standard = generateVector(0.5, 128);
      expect(() => euclideanDistance(null, standard)).toThrow(/float arrays of length 128/);
      expect(() => euclideanDistance(standard, undefined)).toThrow(/float arrays of length 128/);
      expect(() => euclideanDistance({}, standard)).toThrow(/float arrays of length 128/);
    });
  });

  describe('verifyDescriptor', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    test('returns match: true when Euclidean distance is <= threshold', async () => {
      const enrolled = generateVector(0.5);
      const submitted = generateVector(0.5);
      submitted[0] += 0.02; // very close

      vi.spyOn(supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { descriptor: enrolled },
              error: null
            })
          })
        })
      });

      const result = await verifyDescriptor('user-uuid-1', submitted, 0.6);
      expect(result.match).toBe(true);
      expect(result.distance).toBeLessThan(0.6);
    });

    test('returns match: false when Euclidean distance is > threshold', async () => {
      const enrolled = generateVector(0.1);
      const submitted = generateVector(0.9);

      vi.spyOn(supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { descriptor: enrolled },
              error: null
            })
          })
        })
      });

      const result = await verifyDescriptor('user-uuid-1', submitted, 0.6);
      expect(result.match).toBe(false);
      expect(result.distance).toBeGreaterThan(0.6);
    });

    test('returns NOT_ENROLLED reason when user has no stored descriptor', async () => {
      vi.spyOn(supabase, 'from').mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: null
            })
          })
        })
      });

      const submitted = generateVector(0.5);
      const result = await verifyDescriptor('unregistered-user-id', submitted, 0.6);
      expect(result.match).toBe(false);
      expect(result.distance).toBeNull();
      expect(result.reason).toBe('NOT_ENROLLED');
    });
  });
});
