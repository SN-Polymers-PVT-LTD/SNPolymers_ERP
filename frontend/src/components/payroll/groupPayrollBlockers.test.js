import {test,expect} from 'vitest';
import {groupPayrollBlockers} from './groupPayrollBlockers';
test('groups repeated dates but preserves distinct references and fields',()=>{
 const groups=groupPayrollBlockers([{code:'MISSING_PAY_SOURCE',date:'2026-08-01'},{code:'MISSING_PAY_SOURCE',date:'2026-08-03'},{code:'MISSING_PAY_SOURCE',date:'2026-08-03'},{code:'X',reference:'a'},{code:'X',reference:'b'},{code:'X',reference:'a',field:'employee_rate'}]);expect(groups).toHaveLength(4);expect(groups[0]).toEqual({code:'MISSING_PAY_SOURCE',count:3,dates:['2026-08-01','2026-08-03']});
});
