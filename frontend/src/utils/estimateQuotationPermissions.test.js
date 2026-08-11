import { describe, it, expect } from 'vitest';
import {
  canUploadQuotation,
  canDeleteQuotation,
  canFlagQuotation
} from './estimateQuotationPermissions';

describe('estimateQuotationPermissions helper tests', () => {
  const userJE = { role: 'je', mobile_number: '+919999999999' };
  const userZO = { role: 'zo', mobile_number: '+918888888888' };
  const userHO = { role: 'ho', mobile_number: '+917777777777' };
  const userAdmin = { role: 'admin', mobile_number: '+916666666666' };

  const estimateDraft = { created_by: '+919999999999', estimate_status: 'Draft' };
  const estimateUnderReview = { created_by: '+919999999999', estimate_status: 'Under ZO Review' };
  const estimateReopened = { created_by: '+919999999999', estimate_status: 'Estimate Reopened' };

  const quotationUnlocked = { is_locked: false, uploaded_by: '+919999999999' };
  const quotationLocked = { is_locked: true, uploaded_by: '+919999999999' };

  describe('canUploadQuotation', () => {
    it('returns true for creator JE in editable status (Draft)', () => {
      expect(canUploadQuotation(estimateDraft, userJE)).toBe(true);
    });

    it('returns true for creator JE in editable status (Reopened)', () => {
      expect(canUploadQuotation(estimateReopened, userJE)).toBe(true);
    });

    it('returns false for JE who is not the creator', () => {
      expect(canUploadQuotation(estimateDraft, { ...userJE, mobile_number: '+911234567890' })).toBe(false);
    });

    it('returns false for JE when estimate is under review', () => {
      expect(canUploadQuotation(estimateUnderReview, userJE)).toBe(false);
    });

    it('returns true for admin in any status', () => {
      expect(canUploadQuotation(estimateUnderReview, userAdmin)).toBe(true);
    });

    it('returns false for ZO and HO', () => {
      expect(canUploadQuotation(estimateDraft, userZO)).toBe(false);
      expect(canUploadQuotation(estimateDraft, userHO)).toBe(false);
    });
  });

  describe('canDeleteQuotation', () => {
    it('returns true for creator JE when quotation is unlocked and estimate is Draft', () => {
      expect(canDeleteQuotation(quotationUnlocked, estimateDraft, userJE)).toBe(true);
    });

    it('returns false for JE when quotation is locked', () => {
      expect(canDeleteQuotation(quotationLocked, estimateDraft, userJE)).toBe(false);
    });

    it('returns false for admin when quotation is locked', () => {
      expect(canDeleteQuotation(quotationLocked, estimateDraft, userAdmin)).toBe(false);
    });

    it('returns true for admin when quotation is unlocked and estimate is under review', () => {
      expect(canDeleteQuotation(quotationUnlocked, estimateUnderReview, userAdmin)).toBe(true);
    });

    it('returns false for non-owner JEs', () => {
      expect(canDeleteQuotation(quotationUnlocked, estimateDraft, { ...userJE, mobile_number: '+911234567890' })).toBe(false);
    });
  });

  describe('canFlagQuotation', () => {
    it('returns true for zo, ho, and admin when estimate is under review and quotation is unlocked', () => {
      expect(canFlagQuotation(quotationUnlocked, estimateUnderReview, userZO)).toBe(true);
      expect(canFlagQuotation(quotationUnlocked, { estimate_status: 'Under HO Review' }, userHO)).toBe(true);
      expect(canFlagQuotation(quotationUnlocked, estimateUnderReview, userAdmin)).toBe(true);
    });

    it('returns false when estimate is not under review (e.g. Draft, Final Approved)', () => {
      expect(canFlagQuotation(quotationUnlocked, estimateDraft, userZO)).toBe(false);
      expect(canFlagQuotation(quotationUnlocked, { estimate_status: 'Final Approved' }, userZO)).toBe(false);
    });

    it('returns false for locked quotations even if estimate is under review', () => {
      expect(canFlagQuotation(quotationLocked, estimateUnderReview, userZO)).toBe(false);
    });

    it('returns false for JEs', () => {
      expect(canFlagQuotation(quotationUnlocked, estimateUnderReview, userJE)).toBe(false);
    });
  });
});
