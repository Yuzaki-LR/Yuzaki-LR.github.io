import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { renderSafeBlock } from '../src/lib/content/safe-render.mjs';
import { loadEvidenceRegister, loadProjectFixture, readBuiltRoute } from './helpers.mjs';

const classes = new Set(['design target / specification', 'analytical calculation', 'model estimate', 'reported simulation result', 'implementation cross-check']);
const slugs = ['future-ocean-habitat', 'life-support-system', 'communication-system-modelling'];
const requiredClaimIds = new Set([
  'foh-role-coordinator-leads', 'foh-otec-fixed-point', 'foh-microgrid-architecture', 'foh-storage-timescales', 'foh-udc-load-loops-temperatures', 'foh-udc-single-fault-degraded', 'foh-control-safety-authority',
  'life-ownership-individual-detail-design', 'life-fixed-resistor-replacement', 'life-multidomain-coupling', 'life-service-load-scope', 'life-source-and-bus-architecture', 'life-protected-conversion', 'life-hierarchical-control', 'life-environmental-targets', 'life-bus-result', 'life-cross-domain-result', 'life-cumulative-energy-ratio', 'life-instantaneous-efficiency-caveat', 'life-idealised-converter-caveat', 'life-model-limitations',
  'comm-capacity-290k', 'comm-snr-distance', 'comm-study-scope', 'comm-deterministic-config', 'comm-filters-and-orders', 'comm-decision-and-tuning', 'comm-overall-ranking', 'comm-butterworth-result', 'comm-ber-resolution', 'comm-interpretation-limits', 'comm-crosscheck-boundary',
]);
const banned = /\b(?:built|deployed|experimentally validated|measured efficiency|real-time capable|statistically significant)\b/i;
const equivalents = /\b(?:field[- ]tested|hardware validated|validated digital twin|AI[- ]controlled safety)\b/i;
const numericClaim = /\d+(?:\.\d+)?(?:\s*(?:%|kW|MW|kV|V|L(?:\/day)?|GHz|K|dB|km|ppm|°C))?/gi;
const conclusionClaim = /\b(?:converged|remained|preserves?|assigned|calculation gave|used average BER|ties at the minimum BER|implementation cross-checks|outperformed|improved|reduced|increased|achieved|deployed|demonstrated|proved|validated|supports?|establishes?)\b/gi;
const literalPattern = (value) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const factClassesByClaim = new Map([
  [['foh-otec-fixed-point', 'comm-capacity-290k', 'comm-snr-distance'], 'analytical calculation'],
  [['foh-microgrid-architecture', 'foh-storage-timescales', 'foh-udc-load-loops-temperatures', 'foh-udc-single-fault-degraded', 'foh-control-safety-authority', 'life-source-and-bus-architecture', 'life-environmental-targets'], 'design target / specification'],
  [['life-bus-result', 'life-cross-domain-result', 'life-cumulative-energy-ratio', 'life-instantaneous-efficiency-caveat', 'comm-study-scope', 'comm-deterministic-config', 'comm-filters-and-orders', 'comm-decision-and-tuning', 'comm-overall-ranking', 'comm-butterworth-result', 'comm-ber-resolution', 'comm-interpretation-limits'], 'reported simulation result'],
  [['foh-role-coordinator-leads', 'life-ownership-individual-detail-design', 'life-fixed-resistor-replacement', 'life-multidomain-coupling', 'life-service-load-scope', 'life-protected-conversion', 'life-hierarchical-control', 'life-idealised-converter-caveat', 'life-model-limitations', 'comm-crosscheck-boundary'], 'implementation cross-check'],
].flatMap(([ids, factClass]) => ids.map((claimId) => [claimId, factClass])));

function assertClaimSurfaceAgreement(claim, sourceText, domText) {
  for (const [surface, text] of [['source', sourceText], ['DOM', domText]]) {
    assert.match(text, literalPattern(claim.permittedWording), `${claim.claimId} permitted wording in ${surface}`);
    assert.match(text, literalPattern(claim.publicAnchor), `${claim.claimId} anchor in ${surface}`);
    for (const qualifier of claim.requiredQualifiers) assert.match(text, literalPattern(qualifier), `${claim.claimId} qualifier in ${surface}`);
    for (const anchor of claim.conclusionAnchors ?? []) assert.match(text, literalPattern(anchor), `${claim.claimId} conclusion anchor in ${surface}`);
  }
}

async function projectSurfaces(slug) {
  const project = await loadProjectFixture(slug);
  const $ = load(await readBuiltRoute(`/projects/${slug}/`));
  return { project, $ };
}

function visibleBlockText(block, projectSlug) {
  return normalizedClaimText(load(renderSafeBlock(block, { projectSlug })).root().text());
}

function normalizedClaimText(text) {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function maskRegisteredClaimFragments(text, claims) {
  const normalizedText = normalizedClaimText(text);
  const fragments = claims.flatMap(({ permittedWording, requiredQualifiers, conclusionAnchors = [] }) => [permittedWording, ...requiredQualifiers, ...conclusionAnchors]).map(normalizedClaimText).sort((left, right) => right.length - left.length);
  const covered = new Uint8Array(normalizedText.length);
  for (const fragment of fragments) {
    for (const match of normalizedText.matchAll(new RegExp(literalPattern(fragment).source, 'gi'))) covered.fill(1, match.index, match.index + match[0].length);
  }
  return normalizedText.replace(/[\s\S]/g, (character, index) => covered[index] ? ' ' : character);
}

function claimSignals(text) {
  return [...text.matchAll(numericClaim), ...text.matchAll(conclusionClaim)].map(({ 0: signal }) => signal);
}

function unregisteredClaimFragments(project, claims, domBlocks = null) {
  return project.sections.flatMap(({ blocks }) => blocks).filter(({ hidden, type }) => !hidden && type !== 'image').flatMap((block) => {
    const blockClaims = claims.filter(({ project: slug, publicBlock }) => slug === project.slug && publicBlock === block.id);
    const surfaces = [['source', visibleBlockText(block, project.slug)]];
    if (domBlocks) surfaces.push(['DOM', domBlocks(block.id)]);
    return surfaces.flatMap(([surface, text]) => claimSignals(maskRegisteredClaimFragments(text, blockClaims)).map((signal) => `${project.slug}:${block.id}:${surface}:${signal}`));
  });
}

test('claim register contains the complete audited public claim set and separate asset boundary', async () => {
  const register = await loadEvidenceRegister();
  const { claims, assets } = register;
  assert.deepEqual(new Set(register.supportedFactClasses), classes);
  assert.deepEqual(new Set(claims.map(({ claimId }) => claimId)), requiredClaimIds);
  assert.equal(new Set(claims.map(({ claimId }) => claimId)).size, claims.length);
  for (const claim of claims) {
    for (const field of ['project', 'sourceMaterialType', 'location', 'ownership', 'factClass', 'permittedWording', 'limitation', 'publicAnchor', 'publicBlock']) assert.equal(typeof claim[field], 'string', `${claim.claimId}.${field}`);
    assert.ok(slugs.includes(claim.project), claim.claimId);
    assert.equal(claim.factClass, factClassesByClaim.get(claim.claimId), `${claim.claimId}.factClass`);
    if (claim.project === 'life-support-system') assert.match(claim.ownership, /^individual\b/i, `${claim.claimId}.ownership`);
    if (claim.project === 'communication-system-modelling') assert.equal(claim.ownership, 'individual modelling implementation and analysis', `${claim.claimId}.ownership`);
    if (claim.project === 'future-ocean-habitat') assert.match(claim.ownership, claim.claimId === 'foh-role-coordinator-leads' ? /^personal role in team output$/i : /^team\b/i, `${claim.claimId}.ownership`);
    assert.ok(claim.limitation.trim().length >= 20, `${claim.claimId}.limitation`);
    assert.ok(Array.isArray(claim.requiredQualifiers) && claim.requiredQualifiers.length > 0, claim.claimId);
    assert.ok(claim.conclusionAnchors === undefined || Array.isArray(claim.conclusionAnchors), `${claim.claimId}.conclusionAnchors`);
    assert.match(claim.permittedWording, literalPattern(claim.publicAnchor), claim.claimId);
    assert.doesNotMatch(JSON.stringify(claim), /(?:[A-Z]:[\\/]|OneDrive|student number|grading|assignment instructions|\.pdf\b)/i);
  }
  assert.ok(Array.isArray(assets) && assets.length > 0);
  assert.equal(register.assetsAreClaimOracle, false);
});

test('each claim is satisfied independently in its registered project source and fresh DOM block', async () => {
  const { claims } = await loadEvidenceRegister();
  const surfaces = new Map(await Promise.all(slugs.map(async (slug) => [slug, await projectSurfaces(slug)])));
  for (const claim of claims) {
    const { project, $ } = surfaces.get(claim.project);
    const block = project.sections.flatMap(({ blocks }) => blocks).find(({ id }) => id === claim.publicBlock);
    assert.ok(block && !block.hidden, `${claim.claimId} source block`);
    const sourceText = load(renderSafeBlock(block, { projectSlug: claim.project })).root().text();
    const builtBlock = $(`[data-block-id="${claim.publicBlock}"]`);
    const domText = builtBlock.length ? builtBlock.text() : '';
    assertClaimSurfaceAgreement(claim, sourceText, domText);
    for (const [otherSlug, other] of surfaces) {
      if (otherSlug === claim.project) continue;
      assert.equal(other.$(`[data-block-id="${claim.publicBlock}"]`).length, 0, `${claim.claimId} must not be answered by ${otherSlug}`);
    }
  }
});

test('source and DOM must each satisfy a claim instead of pooling their text', () => {
  const claim = { claimId: 'counterexample', permittedWording: 'Claimed 12 kW.', publicAnchor: '12 kW', requiredQualifiers: ['simulated only'] };
  assert.throws(() => assertClaimSurfaceAgreement(claim, 'Claimed 12 kW.', 'simulated only'), /counterexample/);
});

test('every public numeric or conclusion block has a registered claim', async () => {
  const { claims } = await loadEvidenceRegister();
  for (const slug of slugs) {
    const project = await loadProjectFixture(slug);
    const $ = load(await readBuiltRoute(`/projects/${slug}/`));
    assert.deepEqual(unregisteredClaimFragments(project, claims, (blockId) => normalizedClaimText($(`[data-block-id="${blockId}"]`).text())), []);
  }
});

test('a registered block cannot absorb an extra unregistered numeric or conclusion claim', async () => {
  const { claims } = await loadEvidenceRegister();
  const project = structuredClone(await loadProjectFixture('life-support-system'));
  const block = project.sections.flatMap(({ blocks }) => blocks).find(({ id }) => id === 'life-energy-ratio');
  const original = block.markdown;
  for (const addition of [' The model achieved an additional 42 kW.', ' The system achieved robust operation.', ' The system deployed successfully.']) {
    block.markdown = `${original}${addition}`;
    assert.notDeepEqual(unregisteredClaimFragments(project, claims), [], `source: ${addition}`);
    block.markdown = original;
    assert.notDeepEqual(unregisteredClaimFragments(project, claims, () => visibleBlockText(block, project.slug) + addition), [], `DOM: ${addition}`);
  }
  block.markdown = original;
  assert.deepEqual(unregisteredClaimFragments(project, claims), []);
});

test('Unicode compatibility forms cannot hide a claim inside a registered block', async () => {
  const { claims } = await loadEvidenceRegister();
  const project = structuredClone(await loadProjectFixture('life-support-system'));
  const block = project.sections.flatMap(({ blocks }) => blocks).find(({ id }) => id === 'life-energy-ratio');
  const original = block.markdown;
  for (const addition of [' The output was ４２ kW.', ' The output was 𝟜𝟚 kW.', ' The system ａｃｈｉｅｖｅｄ robust operation.']) {
    block.markdown = `${original}${addition}`;
    assert.notDeepEqual(unregisteredClaimFragments(project, claims), [], addition);
  }
});

test('non-BMP characters do not misalign registered coverage and uncovered signals', async () => {
  const { claims } = await loadEvidenceRegister();
  const project = structuredClone(await loadProjectFixture('life-support-system'));
  const block = project.sections.flatMap(({ blocks }) => blocks).find(({ id }) => id === 'life-energy-ratio');
  const original = block.markdown;
  block.markdown = `🧪 ${original}`;
  assert.deepEqual(unregisteredClaimFragments(project, claims), [], 'registered fragments remain covered after non-BMP prefix');
  block.markdown = original.replace('97.6%. This is', '97.6%. 🧪 This is');
  assert.deepEqual(unregisteredClaimFragments(project, claims), [], 'registered fragments remain covered with non-BMP character between them');
  block.markdown = `🧪 ${original} The output was ４２ kW.`;
  assert.notDeepEqual(unregisteredClaimFragments(project, claims), [], 'unregistered signal remains visible after non-BMP prefix');
});

test('removing a claim row exposes its fragment even when the block retains other claims', async () => {
  const { claims } = await loadEvidenceRegister();
  const project = await loadProjectFixture('life-support-system');
  const withoutRatio = claims.filter(({ claimId }) => claimId !== 'life-cumulative-energy-ratio');
  assert.notDeepEqual(unregisteredClaimFragments(project, withoutRatio), []);
});

test('claim scanning delegates image blocks to the asset oracle without weakening technical prose coverage', async () => {
  const { claims } = await loadEvidenceRegister();
  const project = structuredClone(await loadProjectFixture('life-support-system'));
  const paragraph = project.sections.flatMap(({ blocks }) => blocks).find(({ id }) => id === 'life-evidence-summary');
  paragraph.markdown += ' The system achieved 999 kW.';
  assert.notDeepEqual(unregisteredClaimFragments(project, claims), [], 'technical prose remains covered by claim scanning');
});

test('registered qualifiers drive special boundaries and unsupported status vocabulary', async () => {
  const { claims } = await loadEvidenceRegister();
  const byId = new Map(claims.map((claim) => [claim.claimId, claim]));
  for (const claimId of ['life-cumulative-energy-ratio', 'comm-decision-and-tuning', 'foh-control-safety-authority']) {
    const claim = byId.get(claimId);
    const { project, $ } = await projectSurfaces(claim.project);
    const block = project.sections.flatMap(({ blocks }) => blocks).find(({ id }) => id === claim.publicBlock);
    const dom = $(`[data-block-id="${claim.publicBlock}"]`).text();
    const sourceText = load(renderSafeBlock(block, { projectSlug: claim.project })).root().text();
    assert.match(sourceText, literalPattern(claim.publicAnchor));
    for (const qualifier of claim.requiredQualifiers) assert.match(dom, literalPattern(qualifier));
  }
  const corpus = (await Promise.all(slugs.map(async (slug) => (await projectSurfaces(slug)).$.root().text()))).join('\n');
  assert.doesNotMatch(corpus, banned);
  assert.doesNotMatch(corpus, equivalents);
});
