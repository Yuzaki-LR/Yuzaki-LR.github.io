import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from 'cheerio';
import { loadSiteRepository } from '../../src/lib/content/repository.mjs';
import { readBuiltRoute } from '../../test/helpers.mjs';
import { toPreviewModel, previewSemantics } from '../shared/preview-model.mjs';
import { readFile } from 'node:fs/promises';

function actualSemantics(source) {
  const $=load(source), main=$('main');
  const clean=value=>value.replace(/\s+/g,' ').trim();
  return {
    headings:main.find('h1,h2,h3').map((_,el)=>`${el.tagName}:${clean($(el).text())}`).get(),
    text:clean(main.text()),
    links:main.find('a[href]').map((_,el)=>({text:clean($(el).text()),href:$(el).attr('href')})).get(),
    figures:main.find('figure').map((_,el)=>({alt:$(el).find('img').attr('alt')??'',caption:clean($(el).find('figcaption').text())})).get(),
    contributionHeadings:main.find('.contribution-section > h2').map((_,el)=>clean($(el).text())).get(),
  };
}
function findEditorId(nodes,id) { return nodes.some(node=>node.editorId===id||findEditorId(node.children??[],id)); }

test('preview model omits hidden content and empty optional links while preserving stable selection ids', () => {
  const draft={site:{name:'A',intro:'Intro',interests:[],avatar:{mode:'hidden'},links:{github:'',custom:[{label:'Empty',href:''}]},theme:{}},about:{sections:[{id:'section01',hidden:false,title:'Visible',blocks:[{id:'block0001',type:'paragraph',hidden:false,markdown:'Shown'},{id:'block0002',type:'paragraph',hidden:true,markdown:'Secret'}]}]},research:[],projects:[]};
  const model=toPreviewModel(draft,'/'); const semantics=previewSemantics(model);
  assert.match(semantics.text,/Shown/); assert.doesNotMatch(semantics.text,/Secret/); assert.deepEqual(semantics.links,[]); assert.deepEqual(model.profile.links,[]);
  assert.equal(findEditorId(model.nodes,'block0001'),true); assert.equal(findEditorId(model.nodes,'block0002'),false);
});

test('preview semantics match freshly built Astro main landmarks for every canonical route', async () => {
  const repository=await loadSiteRepository();
  const draft={site:repository.site,about:repository.about,research:repository.research.map(({slug,document})=>({slug,document})),projects:repository.projects.map(({slug,document})=>({slug,document})),images:[]};
  const routes=['/','/research/','/projects/',...draft.projects.map(project=>`/projects/${project.slug}/`)];
  for(const route of routes) assert.deepEqual(previewSemantics(toPreviewModel(draft,route)),actualSemantics(await readBuiltRoute(route)),route);
});

test('Chinese editor shell exposes exact navigation, three viewports and adjacent hide disclosure', async () => {
  const html=await readFile(new URL('../client/index.html',import.meta.url),'utf8'),$=load(html);
  assert.deepEqual($('.editor-nav button').map((_,el)=>$(el).text().trim()).get(),['全站资料','首页','研究与稿件','项目','外观','备份']);
  assert.deepEqual($('.viewport-switcher button').map((_,el)=>$(el).text().trim()).get(),['桌面','平板','手机']);
  assert.equal($('iframe[title="网站预览"][sandbox="allow-same-origin"]').length,1); assert.equal($('script[type="module"][src="/modules/app.mjs"]').length,1);
  const group=$('[data-hide-control-group]'); assert.equal(group.find('button').text().trim(),'隐藏'); assert.match(group.text(),/隐藏内容仍保留在 Markdown 中.*公开源代码仓库/);
  assert.equal($('.reorder-controls').filter((_,el)=>$(el).find('button').map((__,button)=>$(button).text().trim()).get().join('|')==='上移|下移').length,1);
});

test('preview model cannot emit scripts, event handlers or javascript links', () => {
  const draft={site:{name:'A',intro:'Intro',interests:[],avatar:{mode:'hidden'},links:{custom:[{label:'Bad',href:'javascript:alert(1)'},{label:'Good',href:'https://example.test'}]},theme:{}},about:{sections:[]},research:[],projects:[]};
  const source=JSON.stringify(toPreviewModel(draft,'/'));
  assert.doesNotMatch(source,/"tag":"script"|"on[a-z]+"\s*:|javascript:/i);
});

test('all supported block types produce safe semantic preview nodes', () => {
  const project={slug:'blocks',document:{frontmatter:{kind:'individual',category:'Individual',title:'Blocks',shortTitle:'Blocks',summary:'Summary',role:'Role',methods:['Method'],featured:false,order:1},sections:[{id:'section01',kind:'standard',hidden:false,title:'Content',blocks:[
    {id:'subhead01',type:'subheading',hidden:false,markdown:'### Detail'},
    {id:'paragraph1',type:'paragraph',hidden:false,markdown:'Read [source](https://example.test).'},
    {id:'list00001',type:'list',hidden:false,markdown:'- Alpha\n- Beta'},
    {id:'table0001',type:'table',hidden:false,markdown:'| A | B |\n| - | - |\n| 1 | 2 |'},
    {id:'image0001',type:'image',hidden:false,markdown:'![Plot](./images/plot.png)\nCaption'},
    {id:'advanced1',type:'advanced',hidden:false,raw:'<details>Safe text</details>'},
  ]}]}};
  const draft={site:{name:'A',intro:'Intro',interests:[],avatar:{mode:'hidden'},links:{custom:[]},theme:{}},about:{sections:[]},research:[],projects:[project]};
  const model=toPreviewModel(draft,'/projects/blocks/'),tags=[];const visit=nodes=>nodes.forEach(value=>{tags.push(value.tag);visit(value.children??[]);});visit(model.nodes);
  for(const tag of ['h3','p','a','ul','li','table','tr','th','td','figure','img','figcaption','pre'])assert.ok(tags.includes(tag),tag);
});
