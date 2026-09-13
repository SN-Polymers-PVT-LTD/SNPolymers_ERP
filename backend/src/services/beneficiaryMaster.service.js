'use strict';

const { supabase } = require('../db/supabase');
const { validateActiveIndianBank } = require('./indianBanks.service');

class BeneficiaryValidationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Validates beneficiary_bank_id (if provided) against the Indian Banks
 * master and resolves the current bank name snapshot to store alongside it.
 * Shared by requisitions.controller.js and fundRequests.controller.js so
 * both Payment Requisition and Fund Requisition beneficiary capture stay
 * in sync with the same active/inactive bank rules.
 */
async function resolveBeneficiaryBank(bankId, fallbackBankName) {
  let resolvedBankName = fallbackBankName?.trim() || null;
  const validatedBankId = bankId || null;

  if (validatedBankId) {
    const bankCheck = await validateActiveIndianBank(validatedBankId);
    if (!bankCheck.valid) {
      if (bankCheck.reason === 'NOT_FOUND') {
        throw new BeneficiaryValidationError(422, 'Selected bank does not exist.');
      }
      if (bankCheck.reason === 'INACTIVE') {
        throw new BeneficiaryValidationError(422, 'Selected bank is currently inactive.');
      }
    }
    resolvedBankName = bankCheck.bank.bank_name;
  }

  return { validatedBankId, resolvedBankName };
}

/**
 * Upserts a beneficiary into the shared projects_beneficiary_master table
 * (the single beneficiary directory used by both Payment Requisition and
 * Fund Requisition) keyed on account number + IFSC. Best-effort: a failure
 * here must never block the requisition/fund-request it was called from.
 */
async function upsertProjectsBeneficiary({ acNo, ifsc, name, fallbackName, bankId, bankName, actorMobile }) {
  if (!acNo?.trim() || !ifsc?.trim()) return null;

  const cleanAcNo = acNo.trim();
  const cleanIfsc = ifsc.trim().toUpperCase();
  const cleanName = name?.trim() || fallbackName?.trim() || 'Payee';

  try {
    const { data: upserted, error: upsertErr } = await supabase
      .from('projects_beneficiary_master')
      .upsert({
        beneficiary_ac_no: cleanAcNo,
        beneficiary_ifsc: cleanIfsc,
        beneficiary_name: cleanName,
        beneficiary_bank_id: bankId || null,
        beneficiary_bank_name: bankName || null,
        last_used_at: new Date().toISOString(),
        created_by: actorMobile,
        updated_by: actorMobile,
        updated_at: new Date().toISOString()
      }, { onConflict: 'beneficiary_ac_no,beneficiary_ifsc' })
      .select('id')
      .maybeSingle();

    if (!upsertErr && upserted) {
      return upserted.id;
    }
  } catch (err) {
    console.warn('projects_beneficiary_master upsert warning:', err.message);
  }
  return null;
}

module.exports = { BeneficiaryValidationError, resolveBeneficiaryBank, upsertProjectsBeneficiary };
