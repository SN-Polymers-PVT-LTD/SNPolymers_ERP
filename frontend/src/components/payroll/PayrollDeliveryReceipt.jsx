import React from 'react';
import {Link} from 'react-router-dom';

export default function PayrollDeliveryReceipt({receipt,role}){
 if(!receipt)return null;
 const canOpen=['accounts','admin','ho'].includes(role);
 const text=`${canOpen?'Open ':''}Accounts sheet ${receipt.sheet_number||'created'}`;
 return <p className="text-sm mt-2">{canOpen?<Link className="underline text-amber-700 dark:text-amber-300" to={`/acct-requisitions/${role==='ho'?'ho-queue/':''}sheets/${receipt.sheet_id}`}>{text}</Link>:text}{receipt.disposition==='PAYMENT_RETURN'?' · Payment details returned to Accounts':receipt.disposition==='HOLD'?' · On hold':''}</p>;
}
