import { validateThemeContrast } from '../../src/lib/content/contrast.mjs';

const CONTRIBUTION_TITLE='My Role and Contribution';
const RESERVED=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const EDITOR_ID=/^[a-z][a-z0-9-]{7,63}$/;
const SLUG=/^[a-z][a-z0-9-]{0,62}$/;
const SHA256=/^[a-f0-9]{64}$/;
const BLOCK_TYPES=new Set(['subheading','paragraph','list','table','image','advanced']);
const FORBIDDEN_KEYS=new Set(['__proto__','prototype','constructor']);
const SITE_SCALARS=new Set(['name','degree','institution','email','intro']);
const THEME_FIELDS=new Set(['background','surface','text','accent']);
const LINK_FIELDS=new Set(['github','linkedin','googleScholar','orcid']);
const PROJECT_FIELDS=new Set(['title','shortTitle','summary','role','featured','order','date','status']);
const RESEARCH_FIELDS=new Set(['title','summary','order','status','authorship','date']);
const SAFE_URL=/^(?:https:|mailto:)/;
const MANUSCRIPT_STATUS='Submitted manuscript — Under editorial review';
const OWN=(value,key)=>value!==null&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,key);

function clone(value){return structuredClone(value);}
function fail(message){throw new Error(message);}
function isPlain(value){if(!value||typeof value!=='object'||Array.isArray(value))return false;const proto=Object.getPrototypeOf(value);return proto===Object.prototype||proto===null;}
function assertPlain(value,message='对象无效'){if(!isPlain(value))fail(message);}
function assertKeys(value,allowed,required=allowed,message='对象属性无效'){
  assertPlain(value,message);const keys=Object.keys(value);if(keys.some(key=>!allowed.includes(key))||required.some(key=>!OWN(value,key)))fail(message);
}
function assertPath(path){if(!Array.isArray(path)||!path.length||path.some(key=>typeof key!=='string'&&(!Number.isInteger(key)||key<0))||path.some(key=>FORBIDDEN_KEYS.has(key)))fail('编辑路径不允许');}
function ownAt(root,path){let value=root;for(const key of path){if(!OWN(value,key))fail('编辑路径不存在');value=value[key];}return value;}
function updateOwn(root,path,updater){if(!path.length)return updater(root);const [key,...rest]=path;if(!OWN(root,key))fail('编辑路径不存在');const copy=Array.isArray(root)?root.slice():{...root};copy[key]=updateOwn(root[key],rest,updater);return copy;}
function nonEmpty(value,label='内容'){if(typeof value!=='string'||!value.trim())fail(`${label}不能为空`);return value;}
function safeOptionalUrl(value){if(value===null||value===undefined||value==='')return null;if(typeof value!=='string'||!SAFE_URL.test(value))fail('链接地址无效');return value;}
function assertEditorId(id){if(typeof id!=='string'||!EDITOR_ID.test(id))fail('稳定 ID 无效');}
function assertSlug(slug,label='网址'){if(typeof slug!=='string'||!SLUG.test(slug)||RESERVED.test(slug))fail(`${label}无效`);}
function contentOf(block){return String(block?.markdown??block?.raw??'').trim();}
function allDocuments(state){return [state.about,...(state.research??[]).map(record=>record.document),...(state.projects??[]).map(record=>record.document)];}
function allIds(state){const ids=[];for(const document of allDocuments(state))for(const section of document?.sections??[]){ids.push(section.id);for(const block of section.blocks??[])ids.push(block.id);}for(const link of state.site?.links?.custom??[])if(link._editorId)ids.push(link._editorId);return ids;}
function makeIdFactory(state){const used=new Set(allIds(state));let sequence=1;return prefix=>{for(;;sequence+=1){const value=`${prefix}${String(sequence).padStart(8,'0')}`;if(!used.has(value)){used.add(value);sequence+=1;return value;}}};}
function localIdFactory(){let sequence=1;return prefix=>`${prefix}${String(sequence++).padStart(8,'0')}`;}

function validateBlock(block){
  const advanced=block?.type==='advanced';assertKeys(block,advanced?['id','type','hidden','raw','edited','pendingEditorIds']:['id','type','hidden','markdown','edited','pendingEditorIds'],['id','type','hidden',advanced?'raw':'markdown'],'内容块属性无效');assertEditorId(block.id);if(!BLOCK_TYPES.has(block.type))fail('内容块类型无效');if(typeof block.hidden!=='boolean')fail('内容块隐藏状态无效');
  if(block.type==='advanced'){if(typeof block.raw!=='string'||OWN(block,'markdown'))fail('高级内容块无效');}
  else if(typeof block.markdown!=='string'||OWN(block,'raw'))fail('内容块 Markdown 无效');
  if(block.type==='image'&&!/^!\[[^\]]*\]\(\.\/images\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.png\)(?:\r?\n+[\s\S]+)?$/.test(block.markdown))fail('图片内容块无效');
}
function validateSection(section,{allowContribution=true}={}){
  assertKeys(section,['id','kind','hidden','title','blocks','pendingEditorIds'],['id','kind','hidden','title','blocks'],'章节属性无效');assertEditorId(section.id);if(!['standard','contribution'].includes(section.kind))fail('章节类型无效');if(!allowContribution&&section.kind==='contribution')fail('贡献章节只能由项目类型转换创建');if(typeof section.hidden!=='boolean')fail('章节隐藏状态无效');nonEmpty(section.title,'章节标题');if(!Array.isArray(section.blocks)||!section.blocks.length)fail('章节至少需要一个内容块');for(const block of section.blocks)validateBlock(block);
}
function validateDocument(document){assertKeys(document,['frontmatter','sections','newline','trailingNewline'],['sections'],'文档属性无效');if(!Array.isArray(document.sections)||!document.sections.length)fail('文档至少需要一个章节');if(OWN(document,'newline')&&!['\n','\r\n'].includes(document.newline))fail('文档换行无效');if(OWN(document,'trailingNewline')&&typeof document.trailingNewline!=='boolean')fail('文档结尾无效');for(const section of document.sections)validateSection(section);}
function validateResearchRecord(record){
  assertKeys(record,['slug','document','hidden'],['slug','document'],'研究记录属性无效');assertSlug(record.slug,'研究网址');assertPlain(record.document,'研究文档无效');assertKeys(record.document.frontmatter,['title','summary','order','status','authorship','scope','date'],['title','summary','order'],'研究资料属性无效');
  const metadata=record.document.frontmatter;nonEmpty(metadata.title,'研究标题');nonEmpty(metadata.summary,'研究摘要');if(!Number.isInteger(metadata.order)||metadata.order<0)fail('研究顺序无效');if(metadata.status!==undefined&&metadata.status!==MANUSCRIPT_STATUS)fail('研究状态无效');for(const field of ['authorship','date'])if(metadata[field]!==undefined)nonEmpty(metadata[field],`研究 ${field}`);if(metadata.scope!==undefined&&(!Array.isArray(metadata.scope)||metadata.scope.some(value=>typeof value!=='string'||!value.trim())))fail('研究范围无效');validateDocument(record.document);if(OWN(record,'hidden')&&typeof record.hidden!=='boolean')fail('研究隐藏状态无效');
}
function validateProjectFrontmatter(metadata){
  assertKeys(metadata,['kind','category','title','shortTitle','summary','role','methods','featured','order','date','status'],['kind','category','title','shortTitle','summary','role','methods','featured','order'],'项目资料属性无效');
  if(!['individual','team'].includes(metadata.kind))fail('项目类型无效');for(const field of ['category','title','shortTitle','summary','role'])if(typeof metadata[field]!=='string')fail('项目文字资料无效');if(!Array.isArray(metadata.methods)||!metadata.methods.length||metadata.methods.some(value=>typeof value!=='string'))fail('项目方法无效');if(typeof metadata.featured!=='boolean')fail('项目精选状态无效');if(!Number.isInteger(metadata.order)||metadata.order<0)fail('项目顺序无效');for(const field of ['date','status'])if(metadata[field]!==undefined)nonEmpty(metadata[field],`项目 ${field}`);
}
function validateCustomLink(link){assertKeys(link,['_editorId','label','href','hidden'],['_editorId','label','href','hidden'],'资料链接属性无效');assertEditorId(link._editorId);nonEmpty(link.label,'链接名称');safeOptionalUrl(link.href);if(typeof link.hidden!=='boolean')fail('链接隐藏状态无效');}
function validateImageDescriptor(image){
  const project=image?.kind==='project';assertKeys(image,project?['kind','slug','name','destination','sha256']:['kind','name','destination','sha256'],project?['kind','slug','name','destination','sha256']:['kind','name','destination','sha256'],'图片描述属性无效');if(!['site','project'].includes(image.kind))fail('图片种类无效');nonEmpty(image.name,'图片名称');if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.png$/.test(image.name))fail('图片名称无效');if(!SHA256.test(image.sha256??''))fail('图片校验值无效');if(project)assertSlug(image.slug,'项目网址');const expected=project?`projects/${image.slug}/images/${image.name}`:`site-images/${image.name}`;if(image.destination!==expected)fail('图片位置与描述不一致');
}
function optionalText(value,label){if(value===null||value===undefined)return;if(typeof value!=='string'||!value.trim())fail(`${label}无效`);}
function validateSite(site){
  assertKeys(site,['name','degree','institution','email','intro','interests','avatar','links','theme','navigation'],undefined,'站点配置属性无效');nonEmpty(site.name,'姓名');optionalText(site.degree,'学位');optionalText(site.institution,'学校');if(site.email!==null&&site.email!==undefined&&(typeof site.email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(site.email)))fail('邮箱无效');nonEmpty(site.intro,'简介');if(!Array.isArray(site.interests)||site.interests.some(value=>typeof value!=='string'||!value.trim()))fail('研究兴趣无效');
  assertKeys(site.avatar,['mode','src','alt'],['mode'],'头像属性无效');if(!['initials','hidden','image'].includes(site.avatar.mode))fail('头像模式无效');if(site.avatar.mode==='image'){if(typeof site.avatar.src!=='string'||!/^\.\/site-images\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.png$/.test(site.avatar.src))fail('头像路径无效');nonEmpty(site.avatar.alt,'头像说明');}else if(OWN(site.avatar,'src')||OWN(site.avatar,'alt'))fail('非图片头像不能包含图片字段');
  assertKeys(site.links,['github','linkedin','googleScholar','orcid','custom'],['custom'],'资料链接属性无效');for(const field of LINK_FIELDS)safeOptionalUrl(site.links[field]);if(!Array.isArray(site.links.custom))fail('资料链接无效');for(const link of site.links.custom)validateCustomLink(link);
  assertKeys(site.theme,['background','surface','text','accent','focus'],['background','surface','text','accent'],'主题属性无效');for(const field of ['background','surface','text','accent'])if(typeof site.theme[field]!=='string'||!/^#[0-9a-f]{6}$/i.test(site.theme[field]))fail('主题颜色无效');if(OWN(site.theme,'focus')&&(typeof site.theme.focus!=='string'||!/^#[0-9a-f]{6}$/i.test(site.theme.focus)))fail('主题焦点颜色无效');
  if(!Array.isArray(site.navigation))fail('导航无效');for(const item of site.navigation){assertKeys(item,['label','href'],undefined,'导航属性无效');nonEmpty(item.label,'导航名称');if(typeof item.href!=='string'||!/^\/(?:[a-z0-9-]+\/)*$/.test(item.href))fail('导航地址无效');}
}
function assertUnique(values,message){const seen=new Set();for(const value of values){const key=String(value).toLowerCase();if(seen.has(key))fail(message);seen.add(key);}}
function ownershipError(project,{requireContent=false}={}){
  const kind=project.frontmatter?.kind,contributions=(project.sections??[]).filter(isContribution);
  if(kind==='individual'&&contributions.length!==0)return'个人项目不能包含贡献章节';
  if(kind==='team'&&contributions.length!==1)return'团队项目必须有且仅有一个贡献章节';
  if(!['individual','team'].includes(kind))return'项目类型无效';
  const contribution=contributions[0];if(contribution&&(contribution.title!==CONTRIBUTION_TITLE||contribution.hidden))return'团队贡献章节必须使用受保护标题且不能隐藏';
  if(requireContent&&contribution&&!contribution.blocks.some(block=>!block.hidden&&/[\p{L}\p{N}]/u.test(contentOf(block))))return'团队贡献章节需要非空可见内容';
  return null;
}
function assertBaseStructure(state,{allowInvalidOwnership=false}={}){
  if(typeof state.baseManifestHash!=='string'||!SHA256.test(state.baseManifestHash))fail('缺少规范内容基线');
  validateSite(state.site);validateDocument(state.about);for(const record of state.research??[])validateResearchRecord(record);
  for(const record of state.projects??[]){assertKeys(record,['slug','document'],undefined,'项目记录属性无效');assertSlug(record.slug,'项目网址');if(OWN(record.document,'slug'))fail('项目文件夹是唯一网址');validateDocument(record.document);validateProjectFrontmatter(record.document.frontmatter);const error=ownershipError(record.document);if(error&&!allowInvalidOwnership)fail(error);}
  assertUnique((state.research??[]).map(record=>record.slug),'研究网址重复');assertUnique((state.projects??[]).map(record=>record.slug),'项目网址重复');
  for(const link of state.site?.links?.custom??[])validateCustomLink(link);for(const image of state.images??[])validateImageDescriptor(image);
  const ids=allIds(state);for(const id of ids)assertEditorId(id);assertUnique(ids,'稳定 ID 重复');assertUnique((state.images??[]).map(image=>image.destination),'图片位置重复');
}
function readinessError(state){
  try{validateThemeContrast(state.site.theme);}catch(error){return error.message;}
  for(const {document} of state.projects??[]){for(const [field,label] of [['category','项目分类'],['title','项目标题'],['shortTitle','项目短标题'],['summary','项目摘要'],['role','项目角色']])if(!document.frontmatter[field].trim())return`${label}不能为空`;if(document.frontmatter.methods.some(value=>!value.trim()))return'项目方法不能为空';const error=ownershipError(document,{requireContent:true});if(error)return error;}
  return null;
}
function recalculate(state){const error=readinessError(state);return{...state,saveDisabled:Boolean(error),saveError:error};}

function withoutRuntime(value){
  const draft=clone(value);delete draft.csrfToken;delete draft.api;
  draft.projects=(draft.projects??[]).map(({slug,document,...record})=>{const clean=clone(document);delete clean.slug;return{slug,document:clean,...record};});
  draft.research=(draft.research??[]).map(record=>({...record,hidden:Boolean(record.hidden)}));
  const id=makeIdFactory(draft);draft.site.links.custom=(draft.site.links.custom??[]).map(link=>({...link,_editorId:link._editorId??id('linkitem'),hidden:Boolean(link.hidden)}));
  return draft;
}

export function generateSlug(title){
  if(typeof title!=='string'||title.includes('%')||title.includes('\\'))fail('项目网址无效');
  const slug=title.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').replace(/-+/g,'-');
  if(!slug||slug==='.'||slug==='..'||RESERVED.test(slug)||slug.length>63||!SLUG.test(slug))fail('项目网址无效');return slug;
}
export function reserveSlug(candidate,existingSlugs=[]){const base=generateSlug(candidate),used=new Set(existingSlugs.map(value=>String(value).toLowerCase()));if(!used.has(base))return base;for(let index=2;index<10000;index+=1){const suffix=`-${index}`,prefix=base.slice(0,63-suffix.length).replace(/-+$/,'');const value=`${prefix}${suffix}`;if(!used.has(value))return value;}fail('项目网址无法保留');}
export function isContribution(section){return section?.kind==='contribution';}
export function createBlock({type='paragraph',idFactory=localIdFactory()}={}){if(!BLOCK_TYPES.has(type))fail('内容块类型无效');const id=idFactory('block');if(type==='advanced')return{id,type,hidden:false,raw:''};if(type==='image')return{id,type,hidden:false,markdown:'![Image](./images/image.png)'};return{id,type,hidden:false,markdown:''};}
export function createSection({title='New Section',kind='standard',idFactory=localIdFactory()}={}){return{id:idFactory('section'),kind,hidden:false,title:kind==='contribution'?CONTRIBUTION_TITLE:title,blocks:[createBlock({idFactory})]};}
function categoryFor(kind){return kind==='team'?'Team project':'Individual project';}
export function createProject({kind,title,slugCandidate=title,idFactory=localIdFactory()}){if(!['individual','team'].includes(kind))fail('项目类型无效');nonEmpty(title,'项目标题');const slug=generateSlug(slugCandidate),sections=[createSection({idFactory})];if(kind==='team')sections.push(createSection({kind:'contribution',idFactory}));return{slug,frontmatter:{kind,category:categoryFor(kind),title,shortTitle:title,summary:'',role:'',methods:[''],featured:false,order:0},sections,newline:'\n',trailingNewline:true};}
export function removeSection(project,sectionId){const section=project.sections.find(item=>item.id===sectionId);if(!section)return clone(project);if(project.frontmatter.kind==='team'&&isContribution(section))fail('团队项目的贡献章节不能删除');if(project.sections.length===1)fail('文档至少需要一个章节');return{...clone(project),sections:project.sections.filter(item=>item.id!==sectionId).map(clone)};}
export function changeKind(project,nextKind){if(!['individual','team'].includes(nextKind))fail('项目类型无效');const value=clone(project);if(value.frontmatter.kind===nextKind)return{project:value};if(nextKind==='team')return{project:value,pendingContributionRequired:true,diff:{insertedSection:CONTRIBUTION_TITLE,category:categoryFor(nextKind)}};const contribution=value.sections.find(isContribution);return{project:value,pendingContributionRemoval:{sectionId:contribution?.id},diff:{removedSection:contribution??null,category:categoryFor(nextKind)}};}

function documentContext(state,path){
  if(path[0]==='about')return{document:state.about,prefixLength:1,owner:'about'};
  if(path[0]==='research'&&Number.isInteger(path[1])&&path[2]==='document'){if(!OWN(state.research,path[1]))fail('编辑路径不存在');return{document:state.research[path[1]].document,prefixLength:3,owner:'research',recordIndex:path[1]};}
  if(path[0]==='projects'&&Number.isInteger(path[1])&&path[2]==='document'){if(!OWN(state.projects,path[1]))fail('编辑路径不存在');return{document:state.projects[path[1]].document,prefixLength:3,owner:'project',recordIndex:path[1]};}
  return null;
}
function fieldContract(state,path){
  assertPath(path);
  if(path.length===2&&path[0]==='site'&&SITE_SCALARS.has(path[1]))return{kind:'site-scalar'};
  if(path.length===3&&path[0]==='site'&&path[1]==='theme'&&THEME_FIELDS.has(path[2]))return{kind:'colour'};
  if(path.length===3&&path[0]==='site'&&path[1]==='avatar'&&['mode','src','alt'].includes(path[2]))return{kind:`avatar-${path[2]}`};
  if(path.length===3&&path[0]==='site'&&path[1]==='links'&&LINK_FIELDS.has(path[2]))return{kind:'url'};
  if(path.length===3&&path[0]==='site'&&path[1]==='interests'&&Number.isInteger(path[2])&&OWN(state.site.interests,path[2]))return{kind:'nonempty'};
  if(path.length===5&&path[0]==='site'&&path[1]==='links'&&path[2]==='custom'&&Number.isInteger(path[3])&&OWN(state.site.links.custom,path[3])&&['label','href'].includes(path[4]))return{kind:path[4]==='href'?'url-required':'nonempty'};
  const context=documentContext(state,path);if(!context)fail('编辑路径不允许');const rest=path.slice(context.prefixLength);
  if(rest[0]==='frontmatter'&&rest.length===2){const field=rest[1],allowed=context.owner==='project'?PROJECT_FIELDS:context.owner==='research'?RESEARCH_FIELDS:new Set();if(!allowed.has(field)||field==='kind')fail('编辑路径不允许');return{kind:['featured'].includes(field)?'boolean':['order'].includes(field)?'integer':['date','status'].includes(field)?'optional-string':'nonempty'};}
  if(rest[0]==='frontmatter'&&['methods','scope'].includes(rest[1])&&rest.length===3&&Number.isInteger(rest[2])){const list=ownAt(context.document,['frontmatter',rest[1]]);if(!OWN(list,rest[2]))fail('编辑路径不存在');return{kind:'nonempty'};}
  if(rest[0]==='sections'&&Number.isInteger(rest[1])&&rest.length===3&&rest[2]==='title'){const section=ownAt(context.document,['sections',rest[1]]);if(isContribution(section))fail('团队贡献章节不能改名或隐藏');return{kind:'nonempty'};}
  if(rest[0]==='sections'&&Number.isInteger(rest[1])&&rest[2]==='blocks'&&Number.isInteger(rest[3])&&rest.length===5){const block=ownAt(context.document,['sections',rest[1],'blocks',rest[3]]),field=rest[4];if(field!==(block.type==='advanced'?'raw':'markdown'))fail('编辑路径不允许');return{kind:'string'};}
  fail('编辑路径不允许');
}
function validatedFieldValue(contract,value){switch(contract.kind){case'site-scalar':if(value===null)return null;if(typeof value!=='string')fail('资料字段无效');return value;case'colour':if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))fail('颜色无效');return value.toLowerCase();case'avatar-mode':if(!['initials','hidden','image'].includes(value))fail('头像模式无效');return value;case'avatar-src':nonEmpty(value,'头像路径');return value;case'avatar-alt':nonEmpty(value,'头像说明');return value;case'url':return safeOptionalUrl(value);case'url-required':return safeOptionalUrl(value)??fail('链接地址不能为空');case'nonempty':return nonEmpty(value);case'boolean':if(typeof value!=='boolean')fail('布尔字段无效');return value;case'integer':if(!Number.isInteger(value)||value<0)fail('顺序无效');return value;case'optional-string':if(value===undefined||value===null||value==='')return undefined;if(typeof value!=='string')fail('字段无效');return value;case'string':if(typeof value!=='string')fail('字段无效');return value;default:fail('编辑路径不允许');}}
function applyFieldSet(state,action){const contract=fieldContract(state,action.path),value=validatedFieldValue(contract,action.value);if(contract.kind==='avatar-mode'){const avatar=value==='image'?{...state.site.avatar,mode:value}:{mode:value};return updateOwn(state,['site','avatar'],()=>avatar);}return updateOwn(state,action.path,()=>clone(value));}

function collectionContext(state,path){
  assertPath(path);if(path.length===1&&path[0]==='research')return{kind:'research',items:state.research};if(path.length===1&&path[0]==='images')return{kind:'images',items:state.images};if(path.length===2&&path[0]==='site'&&path[1]==='interests')return{kind:'interests',items:state.site.interests};if(path.length===3&&path[0]==='site'&&path[1]==='links'&&path[2]==='custom')return{kind:'links',items:state.site.links.custom};
  const context=documentContext(state,path);if(!context)fail('列表路径不允许');const rest=path.slice(context.prefixLength);if(rest.length===1&&rest[0]==='sections')return{...context,kind:'sections',items:context.document.sections};if(rest.length===3&&rest[0]==='sections'&&Number.isInteger(rest[1])&&rest[2]==='blocks'){const section=ownAt(context.document,['sections',rest[1]]);return{...context,kind:'blocks',items:section.blocks,section};}fail('列表路径不允许');
}
function itemIndex(context,action){if(context.kind==='interests'){const index=Number.isInteger(action.index)?action.index:context.items.indexOf(action.id);if(!OWN(context.items,index))fail('编辑项不存在');return index;}const key=context.kind==='research'?'slug':context.kind==='images'?'destination':context.kind==='links'?'_editorId':'id';const index=context.items.findIndex(item=>item?.[key]===action.id);if(index<0)fail('编辑项不存在');return index;}
function regenerateDocumentIds(document,idFactory){const value=clone(document);for(const section of value.sections){section.id=idFactory('section');for(const block of section.blocks)block.id=idFactory('block');}return value;}
function validateAdded(context,item,idFactory,state){
  if(context.kind==='research'){validateResearchRecord(item);if(state.research.some(record=>record.slug.toLowerCase()===item.slug.toLowerCase()))fail('研究网址重复');return{...clone(item),hidden:Boolean(item.hidden)};}
  if(context.kind==='interests')return nonEmpty(item,'研究兴趣');
  if(context.kind==='links'){const value={...clone(item),_editorId:item?._editorId??idFactory('linkitem'),hidden:Boolean(item?.hidden)};validateCustomLink(value);return value;}
  if(context.kind==='sections'){validateSection(item,{allowContribution:false});return clone(item);}
  if(context.kind==='blocks'){validateBlock(item);return clone(item);}
  fail(context.kind==='images'?'图片导入将在下一任务启用':'列表新增不允许');
}
function applyItemAction(state,action){
  const context=collectionContext(state,action.path),idFactory=makeIdFactory(state),items=context.items;
  if(action.type==='item/add'){const added=validateAdded(context,action.item,idFactory,state);return updateOwn(state,action.path,current=>[...current,added]);}
  const index=itemIndex(context,action),item=items[index];
  if((context.kind==='sections'&&isContribution(item))||context.kind==='blocks'&&isContribution(context.section)){if(action.type!=='item/move')fail('团队贡献章节只能编辑和调整顺序');}
  if(action.type==='item/remove'){
    if(['sections','blocks'].includes(context.kind)&&items.length===1)fail(context.kind==='sections'?'文档至少需要一个章节':'章节至少需要一个内容块');
    return updateOwn(state,action.path,current=>current.filter((_,position)=>position!==index).map(clone));
  }
  if(action.type==='item/hide'){
    if(!['research','links','sections','blocks'].includes(context.kind))fail('此列表不支持隐藏');const result=items.map(clone);result[index].hidden=!result[index].hidden;
    if(context.kind==='blocks'&&!result.some(block=>!block.hidden))fail('章节至少需要一个可见内容块');return updateOwn(state,action.path,()=>result);
  }
  if(action.type==='item/copy'){
    const result=items.map(clone),copy=clone(item);
    if(context.kind==='sections'){copy.id=idFactory('section');for(const block of copy.blocks)block.id=idFactory('block');}
    else if(context.kind==='blocks')copy.id=idFactory('block');
    else if(context.kind==='links')copy._editorId=idFactory('linkitem');
    else if(context.kind==='research'){copy.slug=reserveSlug(copy.slug,state.research.map(record=>record.slug));copy.document=regenerateDocumentIds(copy.document,idFactory);}
    else if(context.kind==='interests'){}else fail('此列表不支持复制');result.splice(index+1,0,copy);return updateOwn(state,action.path,()=>result);
  }
  if(action.type==='item/move'){if(!Number.isInteger(action.direction)||![-1,1].includes(action.direction))fail('移动方向无效');const target=Math.max(0,Math.min(items.length-1,index+action.direction)),result=items.map(clone);if(target!==index){const[moved]=result.splice(index,1);result.splice(target,0,moved);}return updateOwn(state,action.path,()=>result);}
  fail('不支持的列表操作');
}

function applyProjectAction(state,action){
  const projects=state.projects??[],index=projects.findIndex(project=>project.slug===action.slug);
  if(action.type==='project/create'){const slug=reserveSlug(action.slugCandidate??action.title,projects.map(project=>project.slug)),created=createProject({kind:action.kind,title:action.title,slugCandidate:slug,idFactory:makeIdFactory(state)}),{slug:canonical,...document}=created;return{...state,projects:[...projects,{slug:canonical,document}]};}
  if(index<0)fail('项目不存在');
  if(action.type==='project/remove')return{...state,pendingProjectRemoval:{slug:action.slug,diff:{removed:clone(projects[index])},recoverableFromBackup:true}};
  if(action.type==='project/confirm-remove'){if(state.pendingProjectRemoval?.slug!==action.slug)fail('需要再次确认删除项目');return{...state,projects:projects.filter(project=>project.slug!==action.slug),pendingProjectRemoval:null};}
  if(action.type==='project/change-kind'){const pending=changeKind(projects[index].document,action.kind);return{...state,pendingKindChange:{slug:action.slug,nextKind:action.kind,...pending}};}
  if(action.type==='project/confirm-kind-change'){
    const pending=state.pendingKindChange;if(pending?.slug!==action.slug)fail('需要再次确认项目类型');const result=projects.map(clone),document=result[index].document;document.frontmatter.kind=pending.nextKind;document.frontmatter.category=categoryFor(pending.nextKind);
    if(pending.nextKind==='team'){if(document.sections.some(isContribution))fail('团队项目贡献章节状态无效');document.sections.push(createSection({kind:'contribution',idFactory:makeIdFactory(state)}));}else document.sections=document.sections.filter(section=>!isContribution(section));
    return{...state,projects:result,pendingKindChange:null};
  }
  if(action.type==='project/change-slug'){const candidate=reserveSlug(action.candidate,projects.filter((_,position)=>position!==index).map(project=>project.slug));return{...state,pendingSlugChange:{slug:action.slug,candidate,diff:{from:action.slug,to:candidate}}};}
  if(action.type==='project/confirm-slug-change'){const pending=state.pendingSlugChange;if(pending?.slug!==action.slug)fail('需要再次确认项目网址');const result=projects.map(clone);result[index].slug=pending.candidate;delete result[index].document.slug;return{...state,projects:result,pendingSlugChange:null};}
  fail('不支持的项目操作');
}

const ACTION_SCHEMAS=new Map([
  ['field/set',{allowed:['type','path','value'],required:['type','path','value']}],
  ['item/add',{allowed:['type','path','item'],required:['type','path','item']}],
  ['item/copy',{allowed:['type','path','id','index'],required:['type','path']}],
  ['item/hide',{allowed:['type','path','id','index'],required:['type','path']}],
  ['item/remove',{allowed:['type','path','id','index'],required:['type','path']}],
  ['item/move',{allowed:['type','path','id','index','direction'],required:['type','path','direction']}],
  ['project/create',{allowed:['type','kind','title','slugCandidate'],required:['type','kind','title']}],
  ['project/remove',{allowed:['type','slug'],required:['type','slug']}],
  ['project/confirm-remove',{allowed:['type','slug'],required:['type','slug']}],
  ['project/change-kind',{allowed:['type','slug','kind'],required:['type','slug','kind']}],
  ['project/confirm-kind-change',{allowed:['type','slug'],required:['type','slug']}],
  ['project/change-slug',{allowed:['type','slug','candidate'],required:['type','slug','candidate']}],
  ['project/confirm-slug-change',{allowed:['type','slug'],required:['type','slug']}],
]);
function assertAction(action){assertPlain(action,'编辑操作无效');if(!OWN(action,'type')||typeof action.type!=='string')fail('编辑操作无效');const schema=ACTION_SCHEMAS.get(action.type);if(!schema)fail('不支持的编辑操作');assertKeys(action,schema.allowed,schema.required,'编辑操作属性无效');}

export function createDraftStore(bootstrap){
  const clean=withoutRuntime(bootstrap);assertBaseStructure(clean,{allowInvalidOwnership:true});let initial=recalculate(clean),state=clone(initial);const listeners=new Set();
  return{getState:()=>clone(state),subscribe(listener){if(typeof listener!=='function')fail('订阅函数无效');listeners.add(listener);return()=>listeners.delete(listener);},dispatch(action){assertAction(action);let next;if(action.type==='field/set')next=applyFieldSet(state,action);else if(action.type.startsWith('item/'))next=applyItemAction(state,action);else next=applyProjectAction(state,action);assertBaseStructure(next);state=recalculate(next);for(const listener of listeners)listener(clone(state));return clone(state);},isDirty:()=>JSON.stringify(state)!==JSON.stringify(initial),reset(){state=clone(initial);for(const listener of listeners)listener(clone(state));return clone(state);}};
}
export function hasUnsavedNavigationWarning(store){return Boolean(store?.isDirty());}

function referencedImages(draft){
  const destinations=new Map(),add=destination=>{const key=destination.toLowerCase();const existing=destinations.get(key);if(existing&&existing!==destination)fail('图片引用存在大小写别名');destinations.set(key,destination);};
  if(draft.site.avatar?.mode==='image'){const source=draft.site.avatar.src;if(typeof source!=='string'||!/^\.\/site-images\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.png$/.test(source))fail('头像图片引用无效');add(source.slice(2),'头像');}
  const scan=(document,projectSlug)=>{for(const section of document.sections??[])for(const block of section.blocks??[])if(block.type==='image'){const match=block.markdown.match(/^!\[[^\]]*\]\(([^)]+)\)/),source=match?.[1];if(projectSlug){if(!/^\.\/images\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.png$/.test(source??''))fail('项目图片引用无效');add(`projects/${projectSlug}/images/${source.slice('./images/'.length)}`,'项目图片');}else if(/^\.\/site-images\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.png$/.test(source??''))add(source.slice(2),'站点图片');}};
  scan(draft.about);for(const record of draft.research??[])scan(record.document);for(const record of draft.projects??[])scan(record.document,record.slug);return destinations;
}
function candidateSite(site){const value=clone(site);value.links.custom=(value.links.custom??[]).filter(link=>!link.hidden).map(({_editorId,hidden,...link})=>link);return value;}
function candidateResearch(records){return records.filter(record=>!record.hidden).map(({hidden,...record})=>clone(record));}
export function toCandidateBundle(draft,uploadStore={}){
  assertBaseStructure(draft,{allowInvalidOwnership:true});const ready=readinessError(draft);if(ready)fail(ready);if(typeof uploadStore.resolveCanonical!=='function'||typeof uploadStore.resolveUpload!=='function')fail('需要注入图片解析器');if(typeof uploadStore.sessionId!=='string'||!uploadStore.sessionId)fail('上传会话无效');
  const required=referencedImages(draft),canonical=new Map(),uploads=new Map();
  for(const descriptor of draft.images??[]){validateImageDescriptor(descriptor);const key=descriptor.destination.toLowerCase();if(canonical.has(key))fail('候选图片路径重复');canonical.set(key,{kind:'canonical',destination:descriptor.destination,sha256:descriptor.sha256});}
  const uploadIds=new Set();for(const upload of uploadStore.uploads??[]){assertKeys(upload,['kind','destination','uploadId','sessionId'],['kind','destination','uploadId','sessionId'],'上传图片引用属性无效');if(upload.kind!=='upload')fail('上传图片引用无效');if(upload.sessionId!==uploadStore.sessionId)fail('上传会话不匹配');if(typeof upload.uploadId!=='string'||!upload.uploadId)fail('上传图片引用无效');if(uploadIds.has(upload.uploadId))fail('上传图片 ID 重复');uploadIds.add(upload.uploadId);nonEmpty(upload.destination,'图片位置');const key=upload.destination.toLowerCase();if(uploads.has(key))fail('候选图片路径重复');if(!required.has(key))fail('未被内容引用的上传图片');if(required.get(key)!==upload.destination)fail('图片引用存在大小写别名');if(!uploadStore.resolveUpload({uploadId:upload.uploadId,sessionId:upload.sessionId,destination:upload.destination}))fail('上传图片引用已失效');uploads.set(key,{kind:'upload',destination:upload.destination,uploadId:upload.uploadId,sessionId:upload.sessionId});}
  const images=[];for(const [key,destination] of [...required].sort((first,second)=>first[1].localeCompare(second[1]))){const descriptor=canonical.get(key),upload=uploads.get(key);if(descriptor&&descriptor.destination!==destination||upload&&upload.destination!==destination)fail('图片引用存在大小写别名');if(descriptor&&upload)fail(`内容图片存在多个绑定: ${destination}`);if(!descriptor&&!upload)fail(`缺少内容图片: ${destination}`);if(upload){images.push(upload);continue;}if(!uploadStore.resolveCanonical(descriptor))fail('规范图片引用已失效');images.push(descriptor);}
  return{baseManifestHash:draft.baseManifestHash,sessionId:uploadStore.sessionId,content:{site:candidateSite(draft.site),about:clone(draft.about),research:candidateResearch(draft.research??[]),projects:clone(draft.projects??[])},images};
}
