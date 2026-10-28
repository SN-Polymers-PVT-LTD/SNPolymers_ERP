// Rational arithmetic preserves repeating hourly/day rates until approved rounding.
const gcd=(a,b)=>{a=a<0n?-a:a;while(b){[a,b]=[b,a%b];}return a||1n;};
function fraction(n,d=1n){if(d===0n)throw new Error('ZERO_DIVISOR');if(d<0n){n=-n;d=-d;}const g=gcd(n,d);return {n:n/g,d:d/g};}
function decimal(value){if(typeof value!=='string'||!/^\d+(\.\d+)?$/.test(value))throw new Error('EXACT_DECIMAL_REQUIRED');const [a,b='']=value.split('.');return fraction(BigInt(a+b),10n**BigInt(b.length));}
const add=(a,b)=>fraction(a.n*b.d+b.n*a.d,a.d*b.d);
const neg=a=>fraction(-a.n,a.d);
const sub=(a,b)=>add(a,neg(b));
const mul=(a,b)=>fraction(a.n*b.n,a.d*b.d);
const div=(a,b)=>fraction(a.n*b.d,a.d*b.n);
const compare=(a,b)=>a.n*b.d-b.n*a.d;
const zero=()=>fraction(0n);
const sum=values=>values.reduce(add,zero());
function round(value,rule){
 if(!rule||!['HALF_UP','HALF_EVEN','DOWN','UP'].includes(rule.method)||!Number.isInteger(rule.precision)||rule.precision<0||rule.precision>6)throw new Error('ROUNDING_POLICY_REQUIRED');
 const scale=10n**BigInt(rule.precision),sign=value.n<0n?-1n:1n,n=(value.n<0n?-value.n:value.n)*scale;
 let q=n/value.d;const remainder=n%value.d;
 if((rule.method==='UP'&&remainder>0n)||(['HALF_UP','HALF_EVEN'].includes(rule.method)&&(remainder*2n>value.d||(remainder*2n===value.d&&(rule.method==='HALF_UP'||q%2n===1n)))))q++;
 return fraction(sign*q,scale);
}
function format(value,precision=2){const scale=10n**BigInt(precision),n=value.n*scale;if(n%value.d!==0n)return null;const integer=n/value.d,abs=integer<0n?-integer:integer;return `${integer<0n?'-':''}${abs/scale}${precision?'.'+String(abs%scale).padStart(precision,'0'):''}`;}
const reference=value=>({numerator:String(value.n),denominator:String(value.d)});
function amount(value,rule){if(rule&&rule.method!=='UNRESOLVED')return format(round(value,rule),Math.max(2,rule.precision));return format(value);}
module.exports={fraction,decimal,add,sub,mul,div,compare,zero,sum,round,format,reference,amount};
