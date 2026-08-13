import assert from 'node:assert/strict';
import test from 'node:test';

const moduleUnderTest=await import('../client/draft-store.mjs');
const {createDraftStore,createProject,generateSlug,reserveSlug,isContribution,removeSection,changeKind,toCandidateBundle,hasUnsavedNavigationWarning}=moduleUnderTest;

function block(id='block0001',type='paragraph',markdown='Body') { return {id,type,hidden:false,...(type==='advanced'?{raw:markdown}:{markdown})}; }
function section(id='section01',kind='standard') { return {id,kind,hidden:false,title:kind==='contribution'?'My Role and Contribution':'Section',blocks:[block(`${id}blk`)]}; }
function bootstrap() { return {
  baseManifestHash:'a'.repeat(64), csrfToken:'csrf',
  site:{name:'Name',degree:null,institution:null,email:null,intro:'Intro',interests:['AI'],avatar:{mode:'initials'},links:{github:null,linkedin:null,googleScholar:null,orcid:null,custom:[]},theme:{background:'#ffffff',surface:'#f7f8f9',text:'#17212b',accent:'#2d587a'},navigation:[{label:'About',href:'/'}]},
  about:{sections:[section('aboutsec1')],newline:'\n',trailingNewline:true},
  research:[{slug:'paper-one',document:{frontmatter:{title:'Paper',summary:'Summary',order:1},sections:[section('research1')],newline:'\n',trailingNewline:true}}],
  projects:[{slug:'project-one',document:{slug:'project-one',frontmatter:{kind:'individual',category:'Cat',title:'Project One',shortTitle:'Project',summary:'Summary',role:'Role',methods:['Method'],featured:true,order:1},sections:[{...section('project01'),blocks:[block('project1blk'),block('project1img','image','![A](./images/a.png)')]}],newline:'\n',trailingNewline:true}}],
  images:[{kind:'project',slug:'project-one',name:'a.png',destination:'projects/project-one/images/a.png',sha256:'b'.repeat(64)}],
}; }

test('draft module exposes the approved store, ownership, slug and bundle boundary', () => {
  for (const name of ['createDraftStore','createProject','generateSlug','reserveSlug','isContribution','removeSection','changeKind','toCandidateBundle','hasUnsavedNavigationWarning']) {
    assert.equal(typeof moduleUnderTest[name],'function',name);
  }
});

test('slug generation normalises ASCII and rejects unsafe or empty project names', () => {
  assert.equal(generateSlug('  Café Signal_Model  '),'cafe-signal-model');
  assert.equal(generateSlug('A / B'),'a-b');
  for (const value of ['', '中文', '..', '%2e%2e', 'CON', 'Lpt1', 'a%2fb', 'a\\b']) assert.throws(()=>generateSlug(value),/项目网址/);
  assert.equal(reserveSlug('sample-project',['other','SAMPLE-PROJECT']),'sample-project-2');
  assert.equal(reserveSlug('sample-project',['sample-project','sample-project-2']),'sample-project-3');
});

test('project ownership helpers enforce the protected team contribution conversion contract', () => {
  const individual=createProject({kind:'individual',title:'Sample Project',slugCandidate:'sample-project'});
  const team=createProject({kind:'team',title:'Team Project',slugCandidate:'team-project'});
  assert.equal(individual.sections.some(isContribution),false);
  assert.equal(team.sections.filter(isContribution).length,1);
  const contributionId=team.sections.find(isContribution).id;
  assert.throws(()=>removeSection(team,contributionId),/团队项目的贡献章节不能删除/);
  const pending=changeKind(individual,'team');
  assert.equal(pending.pendingContributionRequired,true);
  assert.equal(pending.project.frontmatter.kind,'individual');
  const removal=changeKind(team,'individual');
  assert.equal(removal.pendingContributionRemoval.sectionId,contributionId);
  assert.equal(removal.project.frontmatter.kind,'team');
});

test('immutable actions edit every draft surface, preserve source bootstrap, and reset dirty state', () => {
  const source=bootstrap(), original=structuredClone(source), store=createDraftStore(source);
  let notices=0; const unsubscribe=store.subscribe(()=>notices++);
  store.dispatch({type:'field/set',path:['site','name'],value:'Edited Name'});
  store.dispatch({type:'field/set',path:['site','theme','accent'],value:'#123456'});
  store.dispatch({type:'field/set',path:['site','avatar','mode'],value:'hidden'});
  store.dispatch({type:'item/add',path:['site','links','custom'],item:{label:'Lab',href:'https://example.test'}});
  store.dispatch({type:'field/set',path:['research',0,'document','frontmatter','title'],value:'Edited paper'});
  store.dispatch({type:'item/add',path:['research'],item:{slug:'paper-two',document:{frontmatter:{title:'Two',summary:'S',order:2},sections:[section('research2')]}}});
  store.dispatch({type:'item/remove',path:['research'],id:'paper-one'});
  assert.equal(store.getState().site.name,'Edited Name');
  assert.deepEqual(store.getState().research.map(record=>record.slug),['paper-two']);
  assert.deepEqual(source,original);
  assert.equal(store.isDirty(),true); assert.equal(hasUnsavedNavigationWarning(store),true); assert.ok(notices>=7);
  store.reset(); assert.equal(store.isDirty(),false); assert.equal(store.getState().site.name,original.site.name); assert.deepEqual(store.getState().research.map(({hidden,...record})=>record),original.research); unsubscribe();
});

test('block operations copy, hide, remove and move without mutation and protect contribution controls', () => {
  const source=bootstrap(); source.about.sections[0].blocks=[block('block0001'),block('block0002','list','- one'),block('block0003','table','|A|\n|-|')];
  const store=createDraftStore(source);
  store.dispatch({type:'item/copy',path:['about','sections',0,'blocks'],id:'block0001'});
  const copied=store.getState().about.sections[0].blocks[1]; assert.notEqual(copied.id,'block0001'); assert.equal(copied.markdown,'Body');
  store.dispatch({type:'item/move',path:['about','sections',0,'blocks'],id:'block0003',direction:-1});
  assert.deepEqual(store.getState().about.sections[0].blocks.map(item=>item.id),['block0001',copied.id,'block0003','block0002']);
  store.dispatch({type:'item/hide',path:['about','sections',0,'blocks'],id:'block0002'}); assert.equal(store.getState().about.sections[0].blocks.at(-1).hidden,true);
  store.dispatch({type:'item/remove',path:['about','sections',0,'blocks'],id:'block0001'}); assert.equal(store.getState().about.sections[0].blocks.some(item=>item.id==='block0001'),false);
  const team=createProject({kind:'team',title:'Team',slugCandidate:'team'}); const state=bootstrap(); const {slug,...document}=team; state.projects=[{slug,document}]; const protectedStore=createDraftStore(state); const cid=team.sections.find(isContribution).id;
  for(const type of ['item/copy','item/hide','item/remove']) assert.throws(()=>protectedStore.dispatch({type,path:['projects',0,'document','sections'],id:cid}),/贡献章节/);
  const contributionIndex=protectedStore.getState().projects[0].document.sections.findIndex(isContribution);
  for(const [field,value] of [['title','Renamed'],['hidden',true]]) assert.throws(()=>protectedStore.dispatch({type:'field/set',path:['projects',0,'document','sections',contributionIndex,field],value}),/贡献章节|不允许/);
  protectedStore.dispatch({type:'item/move',path:['projects',0,'document','sections'],id:cid,direction:-1});
});

test('project create, remove, slug and kind changes require distinct confirmations', () => {
  const store=createDraftStore(bootstrap());
  store.dispatch({type:'project/create',kind:'individual',title:'Project One'});
  assert.deepEqual(store.getState().projects.map(p=>p.slug),['project-one','project-one-2']);
  store.dispatch({type:'project/remove',slug:'project-one'}); assert.equal(store.getState().pendingProjectRemoval.slug,'project-one'); assert.equal(store.getState().projects.length,2);
  store.dispatch({type:'project/confirm-remove',slug:'project-one'}); assert.deepEqual(store.getState().projects.map(p=>p.slug),['project-one-2']);
  store.dispatch({type:'project/change-kind',slug:'project-one-2',kind:'team'}); assert.equal(store.getState().projects[0].document.frontmatter.kind,'individual');
  store.dispatch({type:'project/confirm-kind-change',slug:'project-one-2'}); const project=store.getState().projects[0]; assert.equal(project.document.frontmatter.kind,'team'); assert.equal(project.document.sections.filter(isContribution).length,1); assert.equal(store.getState().saveDisabled,true);
  const contribution=project.document.sections.find(isContribution); store.dispatch({type:'field/set',path:['projects',0,'document','sections',project.document.sections.indexOf(contribution),'blocks',0,'markdown'],value:'My work'});store.dispatch({type:'field/set',path:['projects',0,'document','frontmatter','summary'],value:'Summary'});store.dispatch({type:'field/set',path:['projects',0,'document','frontmatter','role'],value:'Role'});store.dispatch({type:'field/set',path:['projects',0,'document','frontmatter','methods',0],value:'Method'}); assert.equal(store.getState().saveDisabled,false);
  store.dispatch({type:'project/change-kind',slug:'project-one-2',kind:'individual'}); assert.ok(store.getState().pendingKindChange.diff.removedSection); store.dispatch({type:'project/confirm-kind-change',slug:'project-one-2'}); assert.equal(store.getState().projects[0].document.sections.some(isContribution),false);
  store.dispatch({type:'project/change-slug',slug:'project-one-2',candidate:'renamed'}); assert.equal(store.getState().projects[0].slug,'project-one-2'); store.dispatch({type:'project/confirm-slug-change',slug:'project-one-2'}); assert.equal(store.getState().projects[0].slug,'renamed'); assert.equal('slug' in store.getState().projects[0].document,false);
});

test('candidate bundle stays structured and resolves complete canonical/upload references fail closed', () => {
  const source=bootstrap();source.site.avatar={mode:'image',src:'./site-images/new.png',alt:'Portrait'};source.research.push({slug:'added',document:{frontmatter:{title:'Added',summary:'S',order:2},sections:[section('addedsec1')]}});source.research.shift();const draft=createDraftStore(source).getState();
  const uploadStore={sessionId:'session-A',uploads:[{kind:'upload',destination:'site-images/new.png',uploadId:'upload-1',sessionId:'session-A'}],resolveCanonical:({destination,sha256})=>destination.endsWith('a.png')&&sha256==='b'.repeat(64),resolveUpload:({uploadId,sessionId})=>uploadId==='upload-1'&&sessionId==='session-A'};
  const bundle=toCandidateBundle(draft,uploadStore);
  assert.equal(bundle.baseManifestHash,'a'.repeat(64));
  assert.equal(bundle.sessionId,'session-A');assert.equal('uploadSessionId' in bundle,false);
  assert.deepEqual(Object.keys(bundle.content).sort(),['about','projects','research','site']);
  assert.deepEqual(bundle.content.research.map(record=>record.slug),['added']); assert.equal(bundle.content.projects[0].slug,'project-one');
  assert.deepEqual(bundle.images,[{kind:'canonical',destination:'projects/project-one/images/a.png',sha256:'b'.repeat(64)},{kind:'upload',destination:'site-images/new.png',uploadId:'upload-1',sessionId:'session-A'}]);
  const removed=structuredClone(draft); removed.images=[]; assert.throws(()=>toCandidateBundle(removed,{...uploadStore,uploads:[]}),/缺少内容图片/);
  assert.throws(()=>toCandidateBundle(draft,{...uploadStore,resolveCanonical:()=>false}),/规范图片.*失效/);
  assert.throws(()=>toCandidateBundle(draft,{...uploadStore,uploads:[{kind:'upload',destination:'site-images/new.png',uploadId:'missing',sessionId:'session-A'}],resolveUpload:()=>false}),/上传图片.*失效/);
  assert.throws(()=>toCandidateBundle(draft,{...uploadStore,uploads:[{kind:'upload',destination:'x.png',uploadId:'upload-1',sessionId:'session-B'}]}),/上传会话/);
});

test('store preserves the exact conflict baseline through normal state to candidate conversion', () => {
  const store=createDraftStore(bootstrap()), draft=store.getState();
  assert.equal(draft.baseManifestHash,'a'.repeat(64));
  const uploadStore={sessionId:'s',uploads:[],resolveCanonical:()=>true,resolveUpload:()=>true};
  assert.equal(toCandidateBundle(draft,uploadStore).baseManifestHash,'a'.repeat(64));
});

test('closed field paths reject prototype traversal, missing targets and ownership fields', () => {
  const store=createDraftStore(bootstrap());
  const attacks=[
    ['__proto__','polluted'],['constructor','prototype','polluted'],['site','missing'],['projects'],
    ['projects',0,'document','frontmatter','kind'],['projects',0,'document','sections'],
    ['projects',0,'document','sections',0,'kind'],['projects',0,'document','sections',0,'id'],
  ];
  for(const path of attacks)assert.throws(()=>store.dispatch({type:'field/set',path,value:'x'}),/不允许|不存在|路径/);
  assert.equal({}.polluted,undefined);assert.equal(store.getState().projects[0].document.frontmatter.kind,'individual');
});

test('every action uses an exact own-property schema and rejected dispatches are atomic', () => {
  const store=createDraftStore(bootstrap()),before=store.getState();
  const invalid=[
    {type:'field/set',path:['site','name'],value:'Changed',extra:true},
    {type:'item/move',path:['about','sections'],id:'aboutsec1',direction:1,item:{}},
    {type:'project/create',kind:'individual',title:'Injected',path:['projects']},
    {type:'project/remove',slug:'project-one',diff:{forged:true}},
    Object.assign(Object.create({type:'field/set'}),{path:['site','name'],value:'Inherited'}),
  ];
  for(const action of invalid){assert.throws(()=>store.dispatch(action),/操作|字段|属性/);assert.deepEqual(store.getState(),before);}
});

test('whole-state validation rejects invalid site fields and nested open objects fail closed', () => {
  const store=createDraftStore(bootstrap());
  for(const [path,value] of [[['site','name'],null],[['site','email'],'not-an-email'],[['site','avatar','src'],'../escape.png']]){
    const before=store.getState();assert.throws(()=>store.dispatch({type:'field/set',path,value}),/资料|邮箱|头像|路径|配置|姓名/);assert.deepEqual(store.getState(),before);
  }
  assert.throws(()=>store.dispatch({type:'item/add',path:['site','links','custom'],item:{label:'Lab',href:'https://example.test',constructor:'no'}}),/属性|对象|链接/);
  const openResearch={slug:'open-record',extra:true,document:{frontmatter:{title:'Open',summary:'Summary',order:2},sections:[section('openrec01')]}};
  assert.throws(()=>store.dispatch({type:'item/add',path:['research'],item:openResearch}),/属性/);
  delete openResearch.extra;openResearch.document.frontmatter.extra=true;
  assert.throws(()=>store.dispatch({type:'item/add',path:['research'],item:openResearch}),/属性/);
});

test('whole-state validation rejects malformed research and project frontmatter values', () => {
  const invalidResearch=bootstrap();invalidResearch.research[0].document.frontmatter.authorship=42;
  assert.throws(()=>createDraftStore(invalidResearch),/研究.*无效|作者|authorship/);
  const invalidProject=bootstrap();invalidProject.projects[0].document.frontmatter.methods=['Method',null];
  assert.throws(()=>createDraftStore(invalidProject),/项目.*无效|方法/);
  const invalidCategory=bootstrap();invalidCategory.projects[0].document.frontmatter.category=42;
  assert.throws(()=>createDraftStore(invalidCategory),/项目.*无效|分类/);
});

test('item add accepts only closed collections, valid types and globally unique stable ids', () => {
  const store=createDraftStore(bootstrap());
  const invalid=[
    {path:['site','interests'],item:{id:'fakeitem1'}},
    {path:['about','sections'],item:section('aboutsec1')},
    {path:['about','sections',0,'blocks'],item:{id:'aboutsec1',type:'paragraph',hidden:false,markdown:'duplicate global id'}},
    {path:['about','sections',0,'blocks'],item:{id:'bad',type:'paragraph',hidden:false,markdown:'bad id'}},
    {path:['about','sections',0,'blocks'],item:{id:'newblock1',type:'script',hidden:false,markdown:'bad type'}},
    {path:['about','sections',0,'blocks'],item:{id:'newblock2',type:'paragraph',hidden:false,markdown:'text',extra:'open object'}},
    {path:['about','sections'],item:{...section('newsect01'),extra:'open object'}},
    {path:['projects',0,'document','sections'],item:section('newcontri','contribution')},
  ];
  for(const action of invalid)assert.throws(()=>store.dispatch({type:'item/add',...action}),/不允许|稳定 ID|贡献|类型|重复|不能为空|属性/);
});

test('copying a section regenerates its own and every nested block id without collisions', () => {
  const source=bootstrap();source.about.sections[0].blocks.push(block('aboutblk2','paragraph','Second'));const store=createDraftStore(source);
  store.dispatch({type:'item/copy',path:['about','sections'],id:'aboutsec1'});
  const [original,copy]=store.getState().about.sections;assert.notEqual(copy.id,original.id);assert.equal(copy.blocks.length,2);
  assert.equal(copy.blocks.some((item,index)=>item.id===original.blocks[index].id),false);
  const ids=store.getState().about.sections.flatMap(item=>[item.id,...item.blocks.map(value=>value.id)]);assert.equal(new Set(ids).size,ids.length);
});

test('candidate readiness uses the shared contrast contract and exact project ownership invariants', () => {
  const uploadStore={sessionId:'s',uploads:[],resolveCanonical:()=>true,resolveUpload:()=>true};
  const low=bootstrap();low.site.theme={background:'#ffffff',surface:'#ffffff',text:'#777777',accent:'#777777'};
  assert.throws(()=>toCandidateBundle(createDraftStore(low).getState(),uploadStore),/正文\/背景.*required 4\.5:1.*actual 4\.48:1/);
  const malformed=bootstrap(),project=malformed.projects[0].document;project.frontmatter.kind='team';project.sections.push(section('contrib01','contribution'),section('contrib02','contribution'));
  const store=createDraftStore(malformed);assert.equal(store.getState().saveDisabled,true);assert.throws(()=>toCandidateBundle(store.getState(),uploadStore),/团队项目必须有且仅有一个/);
});

test('kind confirmation updates public category and enforces exact contribution shape', () => {
  const store=createDraftStore(bootstrap());store.dispatch({type:'project/change-kind',slug:'project-one',kind:'team'});store.dispatch({type:'project/confirm-kind-change',slug:'project-one'});
  let project=store.getState().projects[0].document;assert.equal(project.frontmatter.category,'Team project');assert.equal(project.sections.filter(isContribution).length,1);assert.equal(project.sections.find(isContribution).title,'My Role and Contribution');
  store.dispatch({type:'field/set',path:['projects',0,'document','sections',1,'blocks',0,'markdown'],value:'Contribution'});store.dispatch({type:'project/change-kind',slug:'project-one',kind:'individual'});store.dispatch({type:'project/confirm-kind-change',slug:'project-one'});
  project=store.getState().projects[0].document;assert.equal(project.frontmatter.category,'Individual project');assert.equal(project.sections.some(isContribution),false);
});

test('candidate images equal actual content references and retain upload session identity', () => {
  const source=bootstrap();source.site.avatar={mode:'image',src:'./site-images/avatar.png',alt:'Portrait'};source.images.push({kind:'site',name:'avatar.png',destination:'site-images/avatar.png',sha256:'c'.repeat(64)});const draft=createDraftStore(source).getState();
  const uploadStore={sessionId:'session-A',uploads:[{kind:'upload',destination:'projects/project-one/images/new.png',uploadId:'u1',sessionId:'session-A'}],resolveCanonical:()=>true,resolveUpload:()=>true};
  assert.throws(()=>toCandidateBundle(draft,uploadStore),/未被内容引用的上传图片/);
  uploadStore.uploads[0].destination='projects/project-one/images/a.png';draft.images=draft.images.filter(image=>!image.destination.endsWith('/a.png'));
  const bundle=toCandidateBundle(draft,uploadStore);assert.deepEqual(bundle.images.find(image=>image.kind==='upload'),{kind:'upload',destination:'projects/project-one/images/a.png',uploadId:'u1',sessionId:'session-A'});
  const missing=structuredClone(draft);missing.site.avatar.src='./site-images/missing.png';assert.throws(()=>toCandidateBundle(missing,uploadStore),/缺少内容图片|未被内容引用/);
});

test('removing a project image block through the store omits its old canonical image and reset restores it', () => {
  const source=bootstrap(),original=structuredClone(source),store=createDraftStore(source),uploads={sessionId:'session-A',uploads:[],resolveCanonical:()=>true,resolveUpload:()=>true};
  store.dispatch({type:'item/remove',path:['projects',0,'document','sections',0,'blocks'],id:'project1img'});
  const removed=toCandidateBundle(store.getState(),uploads);assert.deepEqual(removed.images,[]);assert.equal(store.getState().images[0].destination,'projects/project-one/images/a.png');assert.deepEqual(source,original);assert.equal(store.isDirty(),true);
  store.reset();const restored=toCandidateBundle(store.getState(),uploads);assert.deepEqual(restored.images,[{kind:'canonical',destination:'projects/project-one/images/a.png',sha256:'b'.repeat(64)}]);assert.equal(store.isDirty(),false);
});

test('hidden image blocks remain candidate references while leaving image avatar mode omits its old canonical descriptor', () => {
  const source=bootstrap();source.site.avatar={mode:'image',src:'./site-images/avatar.png',alt:'Portrait'};source.images.push({kind:'site',name:'avatar.png',destination:'site-images/avatar.png',sha256:'c'.repeat(64)});const store=createDraftStore(source),uploads={sessionId:'session-A',uploads:[],resolveCanonical:()=>true,resolveUpload:()=>true};
  store.dispatch({type:'item/hide',path:['projects',0,'document','sections',0,'blocks'],id:'project1img'});let bundle=toCandidateBundle(store.getState(),uploads);assert.deepEqual(bundle.images.map(image=>image.destination),['projects/project-one/images/a.png','site-images/avatar.png']);
  store.dispatch({type:'field/set',path:['site','avatar','mode'],value:'hidden'});bundle=toCandidateBundle(store.getState(),uploads);assert.deepEqual(bundle.images.map(image=>image.destination),['projects/project-one/images/a.png']);
  store.reset();assert.deepEqual(toCandidateBundle(store.getState(),uploads).images.map(image=>image.destination),['projects/project-one/images/a.png','site-images/avatar.png']);
});

test('candidate image bindings reject ambiguity, case aliases, stale and invalid uploads but omit unused canonical descriptors', () => {
  const source=bootstrap();source.images.push({kind:'site',name:'orphan.png',destination:'site-images/orphan.png',sha256:'d'.repeat(64)});const draft=createDraftStore(source).getState();
  const base={sessionId:'session-A',uploads:[],resolveCanonical:()=>true,resolveUpload:()=>true};
  assert.deepEqual(toCandidateBundle(draft,base).images,[{kind:'canonical',destination:'projects/project-one/images/a.png',sha256:'b'.repeat(64)}]);
  const duplicateCanonical=bootstrap();duplicateCanonical.images.push({...duplicateCanonical.images[0]});assert.throws(()=>createDraftStore(duplicateCanonical),/图片位置重复/);
  const casefoldCanonical=bootstrap();casefoldCanonical.images.push({...casefoldCanonical.images[0],name:'A.png',destination:'projects/project-one/images/A.png'});assert.throws(()=>createDraftStore(casefoldCanonical),/图片位置重复/);
  draft.images=draft.images.filter(image=>!image.destination.endsWith('orphan.png'));draft.images[0].destination='projects/project-one/images/A.png';draft.images[0].name='A.png';
  assert.throws(()=>toCandidateBundle(draft,base),/大小写|图片引用/);
  const canonical=bootstrap();assert.throws(()=>toCandidateBundle(createDraftStore(canonical).getState(),{...base,resolveCanonical:()=>false}),/规范图片.*失效/);
  const ambiguous=bootstrap();assert.throws(()=>toCandidateBundle(createDraftStore(ambiguous).getState(),{...base,uploads:[{kind:'upload',destination:'projects/project-one/images/a.png',uploadId:'replacement',sessionId:'session-A'}]}),/多个|重复|冲突|绑定/);
  const unknown=bootstrap(),unknownDraft=createDraftStore(unknown).getState();unknownDraft.images=[];assert.throws(()=>toCandidateBundle(unknownDraft,{...base,uploads:[{kind:'upload',destination:'projects/project-one/images/a.png',uploadId:'unknown',sessionId:'session-A'}],resolveUpload:()=>false}),/上传图片.*失效/);
  assert.throws(()=>toCandidateBundle(unknownDraft,{...base,uploads:[{kind:'upload',destination:'projects/project-one/images/a.png',uploadId:'cross-session',sessionId:'session-B'}]}),/上传会话/);
  assert.throws(()=>toCandidateBundle(createDraftStore(bootstrap()).getState(),{...base,uploads:[{kind:'upload',destination:'site-images/orphan.png',uploadId:'orphan',sessionId:'session-A'}]}),/未被内容引用的上传图片/);
  assert.throws(()=>toCandidateBundle(unknownDraft,{...base,uploads:[{kind:'upload',destination:'projects/project-one/images/a.png',uploadId:'one',sessionId:'session-A'},{kind:'upload',destination:'projects/project-one/images/a.png',uploadId:'two',sessionId:'session-A'}]}),/候选图片路径重复/);
  draft.images=[];const uploads=[
    {kind:'upload',destination:'projects/project-one/images/a.png',uploadId:'same',sessionId:'session-A'},
    {kind:'upload',destination:'site-images/avatar.png',uploadId:'same',sessionId:'session-A'},
  ];draft.site.avatar={mode:'image',src:'./site-images/avatar.png',alt:'Portrait'};
  assert.throws(()=>toCandidateBundle(draft,{...base,uploads}),/上传.*重复/);
});
