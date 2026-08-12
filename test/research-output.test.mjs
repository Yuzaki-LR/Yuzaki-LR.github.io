import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { readDist } from './helpers.mjs';

const manuscriptTitle = 'Progress on More Electric Aircraft Power Systems at High Energy Density and Carbon Emission: Challenges and Opportunities';
const exactStatus = 'Submitted manuscript \u2014 Under editorial review';
const authorship = 'First-author review manuscript';
const currentDirection = 'I am currently developing projects and technical foundations in Embodied AI, Computer Vision, and Robotics. Completed outcomes will be added only when supporting evidence is ready.';
const interests = ['Embodied AI', 'Machine Learning', 'Computer Vision', 'Robotics'];
const prohibitedStatus = /under peer review|accepted|in press|published/i;

function singleElement(elements, message) {
  assert.equal(elements.length, 1, message);
  return elements.first();
}

function elementsWithHtmlClass($, elements, className) {
  return elements.filter((_, element) => {
    const classAttribute = $(element).attr('class');
    return classAttribute !== undefined
      && classAttribute.split(/[\t\n\f\r ]+/).includes(className);
  });
}

function mainContent($, page) {
  return singleElement($('main'), `${page} should contain exactly one main element`);
}

function sectionContent($, main, heading, page) {
  const sections = main.children('section').filter((_, element) => {
    const directHeadings = $(element).children('h2');
    return directHeadings.length === 1 && directHeadings.first().text() === heading;
  });

  return singleElement(sections, `${page} should contain exactly one ${heading} section`);
}

function assertActiveResearchNav($) {
  const primaryNav = singleElement(
    $('nav').filter((_, element) => $(element).attr('aria-label') === 'Primary'),
    'expected exactly one primary navigation element',
  );
  const activeLinks = primaryNav.find('a').filter(
    (_, element) => $(element).attr('aria-current') === 'page',
  );
  const activeResearch = singleElement(
    activeLinks,
    'primary navigation must have exactly one active link',
  );

  assert.equal(activeResearch.attr('href'), '/research/');
  assert.equal(activeResearch.text(), 'Research');
}

function headingElements($, main) {
  return main.find('h1, h2, h3, h4, h5, h6').toArray().map((element) => ({
    level: Number($(element).prop('tagName').slice(1)),
    text: $(element).text(),
  }));
}

function interestListItems($, section) {
  const list = singleElement(
    elementsWithHtmlClass($, section.find('ul'), 'interest-list'),
    'expected exactly one interest list',
  );

  return list.children('li').toArray().map((element) => $(element).text());
}

function manuscriptArticle($, section, page) {
  return singleElement(
    elementsWithHtmlClass($, section.children('article'), 'manuscript-entry'),
    `${page} should contain exactly one manuscript entry`,
  );
}

function assertManuscriptArticle($, article, page) {
  const status = singleElement(
    elementsWithHtmlClass($, article.children('p'), 'manuscript-status'),
    `${page} manuscript entry should contain exactly one status`,
  );
  const title = singleElement(
    article.children('h3'),
    `${page} manuscript entry should contain exactly one title`,
  );
  const authorshipText = singleElement(
    article.find('strong'),
    `${page} manuscript entry should contain exactly one authorship statement`,
  );

  assert.equal(status.text(), exactStatus);
  assert.equal(title.text(), manuscriptTitle);
  assert.equal(authorshipText.text(), `${authorship}.`);
  assert.doesNotMatch(
    article.text(),
    prohibitedStatus,
    `${page} manuscript entry must not claim a prohibited status`,
  );
}

function assertNoPublicationsHeading($, main, page) {
  const publicationsHeadings = main.find('h1, h2, h3, h4, h5, h6').filter(
    (_, element) => $(element).text().trim().toLowerCase() === 'publications',
  );
  assert.equal(publicationsHeadings.length, 0, `${page} must not include a Publications heading`);
}

test('research page has separate semantic interest, ongoing-work, and manuscript sections', async () => {
  const $ = load(await readDist('research/index.html'));
  const main = mainContent($, 'Research page');
  const researchInterests = sectionContent($, main, 'Research Interests', 'Research page');
  const ongoingWork = sectionContent($, main, 'Ongoing Work', 'Research page');
  const researchManuscripts = sectionContent($, main, 'Research & Manuscripts', 'Research page');

  assertActiveResearchNav($);
  assert.deepEqual(headingElements($, main), [
    { level: 1, text: 'Research' },
    { level: 2, text: 'Research Interests' },
    { level: 2, text: 'Ongoing Work' },
    { level: 2, text: 'Research & Manuscripts' },
    { level: 3, text: manuscriptTitle },
  ]);
  assert.deepEqual(interestListItems($, researchInterests), interests);
  assert.equal(
    singleElement(
      ongoingWork.children('p'),
      'Research page Ongoing Work should contain exactly one paragraph',
    ).text(),
    currentDirection,
  );
  assertManuscriptArticle(
    $,
    manuscriptArticle($, researchManuscripts, 'Research page'),
    'Research page',
  );
  assertNoPublicationsHeading($, main, 'Research page');
});

test('homepage renders the exact manuscript article without a Publications heading', async () => {
  const $ = load(await readDist('index.html'));
  const main = mainContent($, 'Homepage');
  const researchManuscripts = sectionContent($, main, 'Research & Manuscripts', 'Homepage');

  assertManuscriptArticle(
    $,
    manuscriptArticle($, researchManuscripts, 'Homepage'),
    'Homepage',
  );
  assertNoPublicationsHeading($, main, 'Homepage');
});
