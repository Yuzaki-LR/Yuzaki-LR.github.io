const HEX=/^#[0-9a-f]{6}$/i;
const CHINESE_FIELDS={
  'text/background':'正文/背景','text/surface':'正文/表面',
  'accent link/background':'链接/背景','accent link/surface':'链接/表面',
  'focus/background':'焦点/背景','focus/surface':'焦点/表面',
};

function fail(message){throw new Error(message);}
export function relativeLuminance(color){
  if(!HEX.test(color??''))fail('colour must be a six-digit hexadecimal value');
  const rgb=[1,3,5].map(offset=>Number.parseInt(color.slice(offset,offset+2),16)/255);
  return rgb.map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4).reduce((total,value,index)=>total+value*[0.2126,0.7152,0.0722][index],0);
}
export function contrastRatio(first,second){const [high,low]=[relativeLuminance(first),relativeLuminance(second)].sort((a,b)=>b-a);return(high+0.05)/(low+0.05);}
export function validateThemeContrast(theme){
  const focus=theme.focus??theme.accent;
  const checks=[['text/background',theme.text,theme.background,4.5],['text/surface',theme.text,theme.surface,4.5],['accent link/background',theme.accent,theme.background,4.5],['accent link/surface',theme.accent,theme.surface,4.5],['focus/background',focus,theme.background,3],['focus/surface',focus,theme.surface,3]];
  const results=checks.map(([field,first,second,required])=>({field,required,actual:contrastRatio(first,second)}));
  const failed=results.find(entry=>entry.actual<entry.required);if(failed)fail(`${CHINESE_FIELDS[failed.field]}: required ${failed.required}:1, actual ${failed.actual.toFixed(2)}:1`);
  return{valid:true,checks:results};
}
