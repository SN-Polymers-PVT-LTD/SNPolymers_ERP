import {describe,test,expect} from 'vitest';
const {safeCell,excelReport,printableSummary}=require('../../../src/domain/payroll/reports');
const ExcelJS=require('exceljs');const schema=require('../../../src/validation/payrollReports.schema');
const makeReport=(rows=[])=>({rows,summaries:[{department:'Head Office',status:'CALCULATED',row_count:rows.length,gross_known_rows:rows.length,known_gross_total:'9007199254740993.01',gross_total:'9007199254740993.01',known_lop_total:'0.00'}],generated_at:'2091-10-01',filters:{search:'<script>alert(1)</script>'},amount_basis:'SAVED_DIAGNOSTIC_NOT_LIABILITY',total:rows.length});
const row={id:'row',employee_code:'=HYPERLINK("bad")',employee_name:' +malicious',employee_category:'HO Staff',department:'Head Office',earnings_total:'9007199254740993.01',gross_after_lop:'9007199254740993.01',lop:'0.00',net_salary:null,status:'CALCULATED',earnings:[],deductions:[],blockers:[],monthly_reconciliation:[],source_references:{}};
describe('payroll report/export contracts',()=>{
 test.each(['=X','+X','-X','@X',' \t=HYPERLINK("bad")','\r\n@bad'])('protects spreadsheet text %j',value=>{expect(safeCell(value)).toBe("'"+value);});
 test('round-trips exact large money strings and makes incomplete statutory amounts explicit',async()=>{
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await excelReport(makeReport([row])));
  const sheet=workbook.getWorksheet('Salary Register');expect(sheet.getCell('B3').value).toBe("'=HYPERLINK(\"bad\")");expect(sheet.getCell('C3').value).toBe("' +malicious");expect(sheet.getCell('J3').value).toBe('9007199254740993.01');expect(sheet.getCell('M3').value).toBe('Unavailable');expect(sheet.getCell('P3').value).toBe('Unavailable');expect(sheet.getCell('J3').type).toBe(ExcelJS.ValueType.String);expect(workbook.getWorksheet('Department Summary')).toBeTruthy();
 });
 test('exports empty headers and large selections without dropping employee rows; department preset uses only summaries',async()=>{
  const empty=new ExcelJS.Workbook();await empty.xlsx.load(await excelReport(makeReport()));expect(empty.getWorksheet('Salary Register').rowCount).toBe(2);
  const large=new ExcelJS.Workbook();await large.xlsx.load(await excelReport(makeReport(Array.from({length:1001},(_,i)=>({...row,id:`row-${i}`})))));expect(large.getWorksheet('Salary Register').rowCount).toBe(1003);
  const summary=new ExcelJS.Workbook();await summary.xlsx.load(await excelReport(makeReport([row]),'departments'));expect(summary.getWorksheet('Salary Register')).toBeUndefined();expect(summary.getWorksheet('Department Summary').getCell('E3').value).toBe('9007199254740993.01');
 });
 test('rejects oversized component detail before constructing a workbook',async()=>{
  await expect(excelReport(makeReport([{...row,earnings:Array(100001).fill({code:'BASE',amount:'1.00'})}]))).rejects.toMatchObject({code:'PAYROLL_EXPORT_DETAILS_TOO_LARGE'});
 });
 test('exports agreed components as evidence without adding them to salary totals',async()=>{
  const r={...row,monthly_reconciliation:[{salary_month:'2091-10-01',contract_diagnostics:[{pay_structure_id:'pay-1',pay_basis:'Special package',agreed_amount:'30000.00',components:{BASIC:'10000.00',STAFF_WELFARE:'2000.00'}}]}]},book=new ExcelJS.Workbook();await book.xlsx.load(await excelReport(makeReport([r])));
  const components=book.getWorksheet('Salary Components');expect(components.getCell('G3').value).toBe('CONTRACT_EVIDENCE_NOT_ADDITIONAL_EARNINGS');expect(components.getCell('H3').value).toBe('BASIC');expect(components.getCell('J3').value).toBe('10000.00');expect(book.getWorksheet('Salary Register').getCell('J3').value).toBe(row.earnings_total);
 });
 test('splits long source evidence into ordered Excel cells without truncation',async()=>{
  const source_references={evidence:'x'.repeat(40000)},book=new ExcelJS.Workbook();await book.xlsx.load(await excelReport(makeReport([{...row,source_references}])));
  const sheet=book.getWorksheet('Source Evidence');const parts=[];sheet.eachRow((r,i)=>{if(i>2&&r.getCell(2).value==='source_references')parts.push(r.getCell(4).value);});expect(parts).toHaveLength(2);expect(parts.join('')).toBe(JSON.stringify(source_references));expect(parts.every(p=>p.length<=30000)).toBe(true);
 });
 test('printable summary escapes untrusted names/filter text and labels diagnostic totals',()=>{
  const html=printableSummary(makeReport([{...row,employee_name:'<script>bad()</script>'}]));expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');expect(html).toContain('not approved liabilities');expect(html).toContain('Unavailable');
 });
 test('department-only printable HTML omits employee identities and individual amounts while register HTML retains them',()=>{
  const rows=[{...row,employee_name:'Synthetic Alice',gross_after_lop:'12345.67',net_salary:'11234.56'},{...row,employee_name:'Synthetic Bob',gross_after_lop:'23456.78',net_salary:'21345.67'}];
  const report=makeReport(rows);report.summaries=[{department:'Head Office',status:'CALCULATED',row_count:2,gross_known_rows:2,known_gross_total:'35802.45',gross_total:'35802.45',known_lop_total:'0.00'}];
  const summary=printableSummary(report,'departments'),detailed=printableSummary(report,'register');
  expect(summary).toContain('Head Office');expect(summary).toContain('35802.45');expect(summary).not.toContain('<th>Employee Name</th>');
  for(const employee of rows)for(const value of [employee.employee_name,employee.gross_after_lop,employee.net_salary]){expect(summary).not.toContain(value);expect(detailed).toContain(value);}
  expect(detailed).toContain('<th>Employee Name</th>');
 });
 test('validates filters, periods, export bounds, and payslip modes without client monetary inputs',()=>{
  expect(schema.register.query.safeParse({from:'2091-11-01',to:'2091-10-01'}).success).toBe(false);
  for(const query of [{net:'100'},{limit:10001},{sort:'net_salary'},{from:'2026-02-30'}])expect(schema.register.query.safeParse(query).success).toBe(false);
  expect(schema.export.query.safeParse({page:2}).success).toBe(false);expect(schema.payslip.query.safeParse({mode:'official'}).success).toBe(true);
 });
});
