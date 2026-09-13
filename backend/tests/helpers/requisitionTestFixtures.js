async function getActiveTestBankId(supabase) {
  const { data, error } = await supabase
    .from('indian_bank_master')
    .select('id')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw error || new Error('No active Indian bank is available for requisition fixtures.');
  }
  return data.id;
}

function validRequisitionBeneficiary(bankId, overrides = {}) {
  return {
    beneficiary_name: 'Test Beneficiary',
    beneficiary_ac_no: '9876543210',
    beneficiary_ifsc: 'SBIN0001234',
    beneficiary_bank_id: bankId,
    ...overrides
  };
}

module.exports = { getActiveTestBankId, validRequisitionBeneficiary };
