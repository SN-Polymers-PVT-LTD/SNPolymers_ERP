import React from 'react';
import SalaryPreview from './SalaryPreview';
export default function PayrollPayslip({payslip}){
 return <section className="space-y-3 border border-amber-500 p-4"><h2 className="text-xl font-bold">S. N. POLYMERS PVT. LTD.</h2><p className="font-bold text-amber-400">{payslip.watermark}</p><p>{payslip.department} / {payslip.group_code} · {payslip.cycle} · Calculation revision {payslip.revision}</p><p>Review: {payslip.review_status} · Payment: {payslip.payment_status}. {payslip.official?'Immutable Locked financial snapshot. Statutory settlement is separate.':'Saved source evidence has not been revalidated.'}</p>{payslip.source_error&&<p role="alert">Current sources unavailable: {payslip.source_error.message}</p>}<SalaryPreview preview={payslip.calculation}/><p>{payslip.official?'Locked':'Generated'}: {payslip.locked_at||payslip.generated_at} · Employee row: {payslip.row_id}</p></section>;
}
