import test from 'node:test';
import assert from 'node:assert/strict';
import { readDist } from './helpers.mjs';

const manuscriptTitle = 'Progress on More Electric Aircraft Power Systems at High Energy Density and Carbon Emission: Challenges and Opportunities';
const exactStatus = 'Submitted manuscript \u2014 Under editorial review';
const authorship = 'First-author review manuscript';
const currentDirection = 'I am currently developing projects and technical foundations in Embodied AI, Computer Vision, and Robotics. Completed outcomes will be added only when supporting evidence is ready.';
const interests = ['Embodied AI', 'Computer Vision', 'Robotics'];
const prohibitedStatus = /under peer review|accepted|in press|published/i;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mainContent(html) {
  const match = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/);
  assert.ok(match, 'expected a main element');
  return match[1];
}

function sectionContent(main, heading) {
  const match = main.match(
    new RegExp(`<section\\b[^>]*>\\s*<h2\\b[^>]*>${escapeRegex(heading)}<\\/h2>([\\s\\S]*?)<\\/section>`),
  );
  assert.ok(match, `expected a ${heading} section`);
  return match[1];
}

function headingElements(html) {
  return [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((match) => ({
    level: Number(match[1]),
    text: match[2],
  }));
}

function manuscriptArticle(section, page) {
  const articles = [...section.matchAll(/<article\b[^>]*class="[^"]*\bmanuscript-entry\b[^"]*"[^>]*>[\s\S]*?<\/article>/g)];
  assert.equal(articles.length, 1, `${page} should contain exactly one manuscript entry`);
  return articles[0][0];
}

function assertManuscriptArticle(article, page) {
  assert.match(article, new RegExp(`<p class="manuscript-status">${escapeRegex(exactStatus)}<\\/p>`));
  assert.match(article, new RegExp(`<h3\\b[^>]*>${escapeRegex(manuscriptTitle)}<\\/h3>`));
  assert.match(article, new RegExp(`<strong>${escapeRegex(authorship)}\\.<\\/strong>`));
  assert.doesNotMatch(article, prohibitedStatus, `${page} manuscript entry must not claim a prohibited status`);
}

function assertNoPublicationsHeading(main, page) {
  assert.doesNotMatch(
    main,
    /<h[1-6][^>]*>\s*Publications\s*<\/h[1-6]>/i,
    `${page} must not include a Publications heading`,
  );
}

test('research page has separate semantic interest, ongoing-work, and manuscript sections', async () => {
  const html = await readDist('research/index.html');
  const main = mainContent(html);
  const researchInterests = sectionContent(main, 'Research Interests');
  const ongoingWork = sectionContent(main, 'Ongoing Work');
  const researchManuscripts = sectionContent(main, 'Research &amp; Manuscripts');

  assert.match(
    html,
    /<a\b(?=[^>]*href="\/research\/")(?=[^>]*aria-current="page")[^>]*>Research<\/a>/,
  );
  assert.deepEqual(headingElements(main), [
    { level: 1, text: 'Research' },
    { level: 2, text: 'Research Interests' },
    { level: 2, text: 'Ongoing Work' },
    { level: 2, text: 'Research &amp; Manuscripts' },
    { level: 3, text: manuscriptTitle },
  ]);
  assert.match(researchInterests, /<ul class="interest-list">/);
  for (const interest of interests) {
    assert.match(researchInterests, new RegExp(`<li>${escapeRegex(interest)}<\\/li>`));
  }
  assert.ok(ongoingWork.includes(currentDirection));
  assertManuscriptArticle(manuscriptArticle(researchManuscripts, 'Research page'), 'Research page');
  assertNoPublicationsHeading(html, 'Research page');
});

test('homepage renders the exact manuscript article without a Publications heading', async () => {
  const html = await readDist('index.html');
  const main = mainContent(html);
  const researchManuscripts = sectionContent(main, 'Research &amp; Manuscripts');

  assert.match(researchManuscripts, new RegExp(`<h3\\b[^>]*>${escapeRegex(manuscriptTitle)}<\\/h3>`));
  assertManuscriptArticle(manuscriptArticle(researchManuscripts, 'Homepage'), 'Homepage');
  assertNoPublicationsHeading(html, 'Homepage');
});
