const {categories,permanentCategories}=require('../hrEmployeeCategories');
const {covers}=require('./sources');
function schemeApplies(source,scheme,from=source.row.period_from,to=source.row.period_to){
 const assignments=(source.assignments||[]).filter(a=>a.effective_from<=to&&(!a.effective_to||a.effective_to>=from));
 const kinds=[...new Set(assignments.map(a=>a.employee_category))];
 if(kinds.length!==1||!categories.includes(kinds[0]))return null;
 const category=kinds[0];
 if(scheme==='PT')return category!=='Local Daily-Wage Workers';
 if(!permanentCategories.includes(category))return false;
 const mappings=(source.pay_applicability||[]).filter(a=>a.effective_from<=to&&(!a.effective_to||a.effective_to>=from));
 const pay=mappings.length?mappings.map(a=>(source.pay_structures||[]).find(p=>p.id===a.pay_structure_id)):(source.pay_structures||[]);
 const key=scheme==='EPF'?'epf_enrolment':'esi_enrolment';
 if(!pay.length||pay.some(p=>!p||typeof p[key]!=='boolean')||(mappings.length&&!mappings.some(a=>covers(a,from))))return null;
 const flags=[...new Set(pay.map(p=>p[key]))];return flags.length===1?flags[0]:null;
}
module.exports={schemeApplies};
