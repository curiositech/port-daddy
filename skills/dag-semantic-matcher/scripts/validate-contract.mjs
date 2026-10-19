/** Self-contained checker for these bundled schemas, not a general JSON Schema implementation.
 * Checks supplied records only. It authenticates no authority, policy, catalog, vector, or effect.
 */
import {readFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
const inputSchema=JSON.parse(readFileSync(new URL('../schemas/input.json',import.meta.url),'utf8'));
const outputSchema=JSON.parse(readFileSync(new URL('../schemas/output.json',import.meta.url),'utf8'));
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const supported=new Set(['$schema','description','type','properties','required','additionalProperties','items','minItems','maxItems','minLength','pattern','enum','const','allOf','if','then','else','not']);
function schemaVocabulary(s){
 if(!object(s)||Object.keys(s).some(k=>!supported.has(k)))return false;
 const children=[...Object.values(s.properties??{}),...(s.allOf??[]),...['items','if','then','else','not'].filter(k=>k in s).map(k=>s[k])];
 return children.every(schemaVocabulary);
}
function shape(value,s,path='$'){
 const errors=[];const add=(c,k)=>{if(c)errors.push(`${path}:${k}`)};
 if('type'in s){const valid=s.type==='object'?object(value):s.type==='array'?Array.isArray(value):s.type==='number'?typeof value==='number'&&Number.isFinite(value):typeof value===s.type;add(!valid,'type');if(!valid)return errors;}
 add('const'in s&&!isDeepStrictEqual(value,s.const),'const');add(s.enum&&!s.enum.some(x=>isDeepStrictEqual(x,value)),'enum');
 if(typeof value==='string'){add(s.minLength!==undefined&&[...value].length<s.minLength,'minLength');add(s.pattern&&!new RegExp(s.pattern,'u').test(value),'pattern');}
 if(object(value)){
  for(const k of s.required??[])add(!Object.hasOwn(value,k),`required:${k}`);
  for(const[k,v]of Object.entries(value)){if(s.properties&&Object.hasOwn(s.properties,k))errors.push(...shape(v,s.properties[k],`${path}.${k}`));else add(s.additionalProperties===false,`unknown:${k}`);}
 }
 if(Array.isArray(value)){add(s.minItems!==undefined&&value.length<s.minItems,'minItems');add(s.maxItems!==undefined&&value.length>s.maxItems,'maxItems');if(s.items)value.forEach((v,i)=>errors.push(...shape(v,s.items,`${path}[${i}]`)));}
 for(const child of s.allOf??[])errors.push(...shape(value,child,path));
 if(s.not)add(shape(value,s.not,path).length===0,'not');
 if(s.if){const branch=shape(value,s.if,path).length===0?s.then:s.else;if(branch)errors.push(...shape(value,branch,path));}
 return errors;
}
export function validatePair(input,output){
 if(!schemaVocabulary(inputSchema)||!schemaVocabulary(outputSchema))return ['unsupported-schema-keyword'];
 const findings=[...shape(input,inputSchema,'input'),...shape(output,outputSchema,'output')];
 if(findings.length)return findings;
 const add=(condition,code)=>{if(condition)findings.push(code)};const r=input.retrieval,p=output.provenance;
 add(output.retrievalMode!==r.mode,'retrieval-mode-join');
 for(const k of ['authorityScope','corpusScope','catalogSnapshot','selectionPolicyRef'])add(p[k]!==input[k],`provenance:${k}`);
 for(const k of ['corpusPolicyRef','lexicalProfileRef'])add(p[k]!==r[k],`provenance:${k}`);
 if(r.mode==='HYBRID'){
  add(r.denseQuery.spaceId!==r.denseCorpus.spaceId,'hybrid-space-mismatch');
  add(p.denseSpaceId!==r.denseQuery.spaceId,'output-space-join');
  add(p.denseQueryProfileRef!==r.denseQuery.profileRef||p.denseCorpusProfileRef!==r.denseCorpus.profileRef,'dense-profile-join');
 }else add(p.degradedReason!==r.degradedReason,'degraded-reason-join');
 const ids=new Set();for(const c of output.candidates){add(ids.has(c.skillId),'duplicate-candidate');ids.add(c.skillId);}
 if(output.status==='SELECTED'){
  const s=output.selected,c=output.candidates.find(c=>c.skillId===s.skillId&&c.manifestDigest===s.manifestDigest);
  add(!c,'selection-not-in-candidates');
  if(c){add(c.gaps.length>0||c.constraintViolations.length>0,'selected-unresolved-or-forbidden');add(s.capabilityEvidence.some(e=>!c.capabilityEvidence.includes(e)),'selected-evidence-join');}
 }
 return findings;
}
