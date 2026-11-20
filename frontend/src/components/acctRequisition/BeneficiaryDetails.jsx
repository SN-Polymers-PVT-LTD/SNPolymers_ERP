export default function BeneficiaryDetails({ name, account, ifsc, bank }) {
  return (
    <div className="flex flex-col gap-1 break-words">
      <p className="text-xs font-semibold text-slate-900 dark:text-slate-200">{name || '—'}</p>
      {[['A/C', account], ['IFSC', ifsc], ['Bank', bank]].filter(([, value]) => value).map(([label, value]) => (
        <p key={label} className="text-[10px] text-slate-600 dark:text-slate-300">
          <span className="mr-1 font-bold uppercase tracking-wider">{label}</span>{value}
        </p>
      ))}
    </div>
  );
}
