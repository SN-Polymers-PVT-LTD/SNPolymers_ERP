import React from 'react';
import {useParams} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {useAuth} from '../../components/AuthContext';
import {Button} from '../../components/ui';
import {getOfficialPayslip} from '../../api/payrollReportsApi';
import PayrollPayslip from '../../components/payroll/PayrollPayslip';
export default function PayrollOfficialPayslip(){
 const {rowId}=useParams(),{user}=useAuth();
 const query=useQuery({queryKey:['official-payroll-payslip',user.id,rowId],queryFn:async()=>(await getOfficialPayslip(rowId)).data.payslip});
 if(query.isPending)return <p role="status">Loading Locked payslip…</p>;
 if(query.isError)return <div role="alert">{query.error?.response?.data?.message||query.error.message}<Button onClick={()=>query.refetch()}>Retry payslip</Button></div>;
 return <div className="p-4"><style>{'@media print {.payroll-report-controls {display:none!important}}'}</style><div className="payroll-report-controls"><Button onClick={()=>window.print()}>Print official payslip</Button></div><PayrollPayslip payslip={query.data}/></div>;
}
