export function groupPayrollBlockers(blockers=[]){
 const groups=new Map();
 for(const b of blockers){const key=JSON.stringify([b.code,b.kind,b.reference??null,b.field??null]);if(!groups.has(key))groups.set(key,{code:b.code,dates:new Set(),count:0});const g=groups.get(key);g.count++;if(b.date)g.dates.add(b.date);}
 return [...groups.values()].map(g=>({...g,dates:[...g.dates].sort()}));
}
