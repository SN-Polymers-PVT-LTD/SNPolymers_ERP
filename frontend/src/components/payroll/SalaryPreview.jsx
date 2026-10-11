import React from 'react';
export default function SalaryPreview({preview,children}){
 return <section className="space-y-4"><h2 className="text-xl font-semibold">{preview.employee.employee_name} / {preview.employee.employee_code}</h2><p>{preview.status} · {preview.period_from} – {preview.period_to}</p><p>Gross after LOP: {preview.gross_after_lop??'Blocked'} · Final net: {preview.final_net_salary??'unavailable'}</p>
 {children}
 {['earnings','deductions'].map(kind=><div key={kind}><h3 className="font-bold capitalize">{kind}</h3>{!preview[kind].length?<p>No calculated {kind} lines. Statutory deductions remain unresolved.</p>:<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Line</th><th>Date / month</th><th>Amount</th><th>Source references</th></tr></thead><tbody>{preview[kind].map((l,i)=><tr key={i}><td>{l.code}</td><td>{l.date||l.salary_month}</td><td>{l.amount??'Rounding unresolved'}</td><td className="break-all">{l.source_ids.join(', ')}</td></tr>)}</tbody></table></div>}</div>)}
 <h3 className="font-bold">Calculation blockers</h3><ul>{preview.blockers.map((b,i)=><li key={i}>{b.date?`${b.date}: `:''}{b.code}{b.field?` / ${b.field}`:''}{b.responsible_team?` — ${b.responsible_team}`:''}</li>)}</ul>
 <h3 className="font-bold">Monthly reconciliation</h3><pre className="text-xs whitespace-pre-wrap">{JSON.stringify(preview.monthly_reconciliation,null,2)}</pre>
 <h3 className="font-bold">Statutory readiness and enrolment</h3><pre className="text-xs whitespace-pre-wrap">{JSON.stringify({rules:preview.statutory,enrolment:preview.enrolment},null,2)}</pre>
 <details><summary>Policy revisions, source references and configuration warnings</summary><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify({fingerprint:preview.source_fingerprint,sources:preview.source_references,warnings:preview.configuration_warnings},null,2)}</pre></details></section>;
}
