import fs from 'fs';
import * as gap from './formulas/gap.js';
import * as wind from './formulas/wind.js';
import * as heat from './formulas/heat.js';
const R='reference/';
const grabFn=(src,name)=>{const i=src.indexOf('function '+name+'(');let d=0,j=i+src.slice(i).search(/\)\s*\{/);j=src.indexOf('{',j);for(let k=j;k<src.length;k++){if(src[k]=='{')d++;else if(src[k]=='}'){d--;if(!d)return src.slice(i,k+1);}}};
const grabConst=(src,name)=>{const p='const '+name+' = ';const i=src.indexOf(p);const j=src.indexOf('\n}',i);return src.slice(i+p.length,j+2);};
let bad=0; const chk=(l,a,b)=>{const ok=Math.abs(a-b)<1e-9||(isNaN(a)&&isNaN(b)); if(!ok){bad++;console.log('MISMATCH',l,a,b);} };
// GAP original
const g=fs.readFileSync(R+'gap-app-main/scripts.js','utf8');
const G=new Function(`const blackGam=${grabConst(g,'blackGam')};${grabFn(g,'calcDeltaEC')};${grabFn(g,'lookupSpeed')};${grabFn(g,'getEquivFlatSpeed')};
return {fwd:(v,gr)=>{const c=lookupSpeed(v,'energy_j_kg_m')+calcDeltaEC(gr);return getEquivFlatSpeed(c*v)},
rev:(v,gr)=>{const d=calcDeltaEC(gr);const t=lookupSpeed(v,'energy_j_kg_s');let vg=t/(lookupSpeed(v,'energy_j_kg_m')+d);for(let i=0;i<10;i++){vg=t/(lookupSpeed(vg,'energy_j_kg_m')+d)}return vg}}`)();
for(const v of [2.5,3.4,3.83,4.5,5.5]) for(const gr of [-0.15,-0.06,-0.02,0,0.03,0.08,0.2]){chk('gapF',gap.gapFromHillSpeed(v,gr),G.fwd(v,gr));chk('gapR',gap.hillSpeedFromFlatEffort(v,gr),G.rev(v,gr));}
// Wind original: eval functions with globals
const w=fs.readFileSync(R+'wind-calculator-main/scripts.js','utf8');
const fns=['getBodySurfaceArea','getAp','calcTreadMetCost','calcAirPct','calcDragForce','calcCalmAirTotalMetCost','doWindCalcs','getVectorMag','getRelativeWindAngle','lookupSpeedFromCost','windProfilePowerLaw','makeGrid','getAngleComps'].map(n=>grabFn(w,n)).join('\n');
const W=new Function(`const GRID_MAX_M_S=12,GRID_STEP=0.01,IS_ELITE=1,WIND_REFERENCE_HEIGHT=10,CHEST_HEIGHT=1.5,GRAVITY=9.80665,DRAG_COEFFICIENT=0.8,AIR_DENSITY=1.225,AP_RATIO=0.266,DA_SILVA_SLOPE=6.13;
let runner_weight_kg=68,runner_Ap,input_m_s,effort_mode,true_wind_fwd_comp,true_wind_lat_comp,output_speed_ms,alpha_exp=0.3;${fns}
return (v,wms,ang,eff)=>{runner_Ap=getAp(getBodySurfaceArea(runner_weight_kg));input_m_s=v;effort_mode=eff;const t=windProfilePowerLaw(wms,alpha_exp);const c=getAngleComps(ang);true_wind_fwd_comp=c.fwd_comp*t;true_wind_lat_comp=c.lat_comp*t;doWindCalcs();return output_speed_ms}`)();
for(const v of [2.8,3.83176,4.6]) for(const ws of [0,2.2352,6,10]) for(const a of [0,45,90,135,180,-60]){chk('windP',wind.calmEquivalentSpeed(v,ws,a),W(v,ws,a,false));chk('windE',wind.speedInWindFromEffort(v,ws,a),W(v,ws,a,true));}
console.log('7:00/mi, 5 mph headwind, pace mode ->',wind.calmEquivalentSpeed(3.83176,2.2352,0), '(orig default const 3.915669)');
// Heat original
const h=fs.readFileSync(R+'heat-adjusted-pace-main/scripts.js','utf8');
const H=new Function(`const tempModParams=${grabConst(h,'tempModParams')};const heatIndexModParams=${grabConst(h,'heatIndexModParams')};${grabFn(h,'create1DInterpolationLookup')};${grabFn(h,'createLogspeedAdjustInterpolator')};
const hh=createLogspeedAdjustInterpolator(tempModParams,{extrapolate:true});const hi=create1DInterpolationLookup(heatIndexModParams,{extrapolate:true});return {hh,hi}`)();
for(const t of [-5,0,7.3,12,18.6,25,31.2,45,48]) for(const rh of [0,20,55.5,80,100]){chk('heat',heat.heatHumidityLookup(t,rh),H.hh(t,rh));chk('hi',heat.heatIndexLookup(t),H.hi(t));}
console.log('3.5 m/s at 25C/70% ->',heat.heatAdjustedSpeedFromEffort(3.5,25,70));
console.log(bad? bad+' mismatches':'ALL MATCH original implementations');
