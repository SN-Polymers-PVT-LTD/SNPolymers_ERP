import { useState } from 'react';
import { Input, Select } from '../ui';
import BeneficiaryAcNoSuggestions from '../acctRequisition/BeneficiaryAcNoSuggestions';

export default function PayrollBeneficiaryField({ row, selection, onSelect, disabled }) {
 const [search, setSearch] = useState(null);
 const details = selection.details || {};
 const pick = beneficiary => {
  onSelect({
   value: beneficiary.id,
   details: {
    account: beneficiary.account_number,
    ifsc: beneficiary.ifsc,
    name: beneficiary.beneficiary_name,
    bank: beneficiary.beneficiary_bank?.bank_name || beneficiary.beneficiary_bank_name,
   },
  });
  setSearch(null);
 };
 const lookup = (field, value) => {
  setSearch({ field, value });
  if (selection.value) onSelect({ value: '', details: {} });
 };
 const bank = details.bank || '';
 return <div className="flex flex-col gap-1.5">
  <BeneficiaryAcNoSuggestions
   aria-label={`Account number for ${row.employee_name}`}
   placeholder="A/C No." size="sm" inputMode="numeric" maxLength={18}
   disabled={disabled} enabled={!selection.value}
   value={search?.field === 'account' ? search.value : details.account || ''}
   onChange={event => lookup('account', event.target.value.replace(/\D/g, ''))}
   onSelect={pick}
  />
  <Input aria-label={`IFSC for ${row.employee_name}`} placeholder="IFSC" size="sm"
   value={details.ifsc || ''} readOnly />
  <BeneficiaryAcNoSuggestions
   aria-label={`Beneficiary name for ${row.employee_name}`}
   placeholder="Beneficiary Name" size="sm" searchBy="name" primaryField="name"
   disabled={disabled} enabled={!selection.value}
   value={search?.field === 'name' ? search.value : details.name || ''}
   onChange={event => lookup('name', event.target.value)}
   onSelect={pick}
  />
  <Select aria-label={`Beneficiary bank for ${row.employee_name}`} value={bank} disabled
   options={[{ value: bank, label: bank || 'Select bank…' }]} />
 </div>;
}
