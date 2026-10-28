const {calculatePreview}=require('./preview');
// Read-only comparison: never stores a new calculation or changes review state.
function sourceCheck(review,calculate=calculatePreview){
 const row=review.row,latest=review.revisions.at(-1)?.calculation_snapshot;
 const base={row_id:row.id,current_version:row.current_version,review_revision:row.review_revision,review_version:row.review_version,source_fingerprint:latest?.source_fingerprint||null};
 if(row.status==='LOCKED')return {...base,status:'CURRENT',reasons:[]};
 if(!review.source)return {...base,status:'UNAVAILABLE',reasons:['Current payroll sources could not be verified.']};
 if(!latest)return {...base,status:'UNCALCULATED',reasons:['No saved calculation.']};
 const current=calculate(review.source);
 if(current.source_fingerprint===latest.source_fingerprint)return {...base,status:'CURRENT',current_source_fingerprint:current.source_fingerprint,reasons:[]};
 const before=latest.source_references||{},after=current.source_references||{},reasons=[];
 const changed=keys=>keys.some(key=>JSON.stringify(before[key])!==JSON.stringify(after[key]));
 if(changed(['history','assignments','pay_applicability']))reasons.push('Salary or employment dates changed.');
 if(changed(['policies']))reasons.push('Salary calculation policy changed.');
 if(changed(['statutory_profile_history','statutory_profiles','statutory_rule_links'])||JSON.stringify(latest.enrolment)!==JSON.stringify(current.enrolment))reasons.push('Deduction rules or enrolment changed.');
 if(changed(['attendance','leave']))reasons.push('Attendance or leave changed.');
 return {...base,status:'CHANGED',current_source_fingerprint:current.source_fingerprint,reasons:reasons.length?reasons:['Payroll inputs or calculation rules changed.']};
}
module.exports={sourceCheck};
