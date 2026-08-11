# Yunxi Wu Academic Website — Design Specification

Date: 2026-08-11

Status: Approved design, pending specification review

Public language: English

Planned host: GitHub Pages

## 1. Purpose

Create an academic personal website for Yunxi Wu that serves two related goals:

1. provide a durable academic profile that can grow with future research, projects, and publications; and
2. support MSc and PhD applications by making academic direction, engineering evidence, individual contributions, and contact routes easy to verify.

The site must read as an academic profile rather than a visual-design portfolio. It must not imply that incomplete Embodied AI, Computer Vision, or Robotics work is already a completed research outcome.

## 2. Audiences

Primary audiences:

- MSc and PhD admissions tutors;
- prospective supervisors and research collaborators;
- academics and engineers reviewing Yunxi Wu's background;
- recruiters for research-oriented engineering roles.

The browsing hierarchy is designed for three depths:

- approximately 10 seconds: identity, degree, university, and research interests;
- approximately 60 seconds: selected EEE project evidence and manuscript status;
- extended review: project-detail pages, contribution boundaries, and technical evidence.

## 3. Verified public profile

Use only the following confirmed identity facts in version 1:

- Public name: **Yunxi Wu**
- Degree: **BEng Electronic and Electrical Engineering**
- Institution: **University of Birmingham**
- Research interests: **Embodied AI, Computer Vision, and Robotics**
- Current position: undergraduate student
- Public email: **yxw1331@student.bham.ac.uk**
- Site language: English

Approved homepage introduction:

> I am a BEng Electronic and Electrical Engineering student at the University of Birmingham. My current academic work spans systems design, modelling, control, and signal processing. I am developing toward research in Embodied AI, Computer Vision, and Robotics.

Do not add a graduation year, academic grade, scholarship, award, affiliation, location, any other contact address, social account, or personal fact unless the user supplies or verifies it.

## 4. Design direction

### 4.1 Overall character

Use the approved **restrained academic sidebar** direction:

- white background;
- compact top navigation;
- profile and links in a left sidebar on wide screens;
- academic content in the main right column;
- Times New Roman as the primary typeface for headings and most body copy;
- thin rules and low-saturation blue-grey accents;
- conventional text entries instead of large portfolio cards;
- no decorative gradients, oversized display headlines, parallax, or attention-seeking animation.

The reference site informed the type of academic website, but the implementation must not copy its layout, theme assets, code, or wording.

### 4.2 Visual tokens

Initial design tokens:

- page background: `#ffffff`;
- secondary surface: `#f7f8f9`;
- primary text: `#292d32`;
- secondary text: `#656c73`;
- rule/border: `#dfe2e6`;
- primary accent: `#2d587a`;
- primary headings and body: `Times New Roman`, Times, serif fallback;
- small navigation, metadata, and interface labels may use Arial or `Helvetica Neue` as a secondary sans-serif treatment.

Use Times New Roman for the clear majority of visible text. Use system fonts so the site has no remote-font dependency. Hover treatments should be limited to link colour or underline changes. Keyboard focus must remain clearly visible.

### 4.3 Responsive behaviour

- Desktop/tablet: approximately 220–240 px profile sidebar plus flexible main content.
- Narrow screens: sidebar becomes a profile header above the main content.
- Navigation may wrap or use a small native disclosure menu; it must not require a JavaScript framework.
- Project metadata moves below the project summary on narrow screens.
- No horizontal scrolling at common mobile widths.

## 5. Information architecture

The approved version 1 is a focused multi-page site with three primary navigation items.

### 5.1 About

The root homepage and primary landing page. It contains:

1. profile sidebar;
2. concise academic introduction;
3. research interests;
4. three selected project entries;
5. Research & Manuscripts entry;
6. current-direction note;
7. verified public links only.

The homepage should not reproduce every project detail. It provides a concise route to deeper pages.

### 5.2 Projects

The Projects index lists the initial three projects and is designed to accept future work without redesign.

Each substantial project has a dedicated page using this order:

1. Overview
2. My Contribution
3. Technical Approach
4. Results & Validation
5. Evidence Gallery
6. Reflection & Next Steps

Every project page must state whether it is individual or group work. For group work, **My Contribution** is mandatory and must define both responsibility and boundary.

### 5.3 Research

Use three distinct categories:

- **Research Interests** — Embodied AI, Computer Vision, and Robotics;
- **Ongoing Work** — incomplete work described without results claims;
- **Research & Manuscripts** — submitted writing and, later, verified publications.

Do not create a Publications section in version 1. A publication category may be introduced only when a work is accepted or published and its bibliographic status is verified.

## 6. Initial content model

### 6.1 Future Ocean Habitat — Integrated Systems Concept Design

- Type: group project
- Source: *Integrated Design Project 2 Assignment 1 Concept Design — Future Ocean Habitat*
- Safe public positioning: systems concept design for a self-sufficient future ocean habitat
- Verified contribution:
  - Group Coordinator/Leader
  - lead for WP3 Energy
  - lead for WP5 Systems
  - lead for WP6B Underwater Data Centre
  - contributor to WP1 and WP2
- Candidate technical themes: energy architecture, systems and control, communications/alarms, underwater data-centre design and cooling

The site must not present the whole group report as Yunxi Wu's individual work. Team names and unrelated individual contributions must not be exposed.

### 6.2 Life-Support System — Power and Control Simulation

- Type: individual detailed design
- Sources: individual report and `Life_Support_System_YunxiWu.slx`
- Safe public positioning: multi-domain power and control simulation for a future ocean-habitat life-support system
- Verified technical scope:
  - 180 V DC bus;
  - water intake, reverse osmosis, recovery, and distribution;
  - oxygen generation and carbon-dioxide removal;
  - HVAC and humidity control;
  - hierarchical closed-loop control;
  - PI and PWM control;
  - Simulink/Simscape multi-domain modelling;
  - protection, inrush, and pre-charge considerations.

Candidate result for the detail page, only with its simulation context preserved:

> The submitted simulation reports a cumulative efficiency of 97.7% under the documented model configuration.

Do not state or imply that this is measured physical-system efficiency.

### 6.3 Communication-System Modelling and Filter Optimisation

- Type: individual laboratory work
- Sources: report and three MATLAB files
- Safe public positioning: modelling and analysis of channel behaviour and coherent demodulation under noise
- Verified technical scope:
  - Shannon capacity and BER under bandwidth and temperature variation;
  - SNR versus distance with 2 dB/km attenuation;
  - OOK/AM coherent demodulation under AWGN;
  - moving-median, FFT, Butterworth, and Chebyshev filter comparison;
  - BER as the primary metric and MSE as the tie-breaker;
  - deterministic random seed and parameter sweeps in MATLAB.

Candidate result for the detail page, explicitly limited to the tested setup:

> Among the tested filters and parameter ranges, the Butterworth configuration achieved the lowest reported average BER (0.0593) and MSE (4.04 × 10^-2).

### 6.4 More Electric Aircraft review manuscript

- Page: Research
- Type: first-author review manuscript
- Exact title: *Progress on More Electric Aircraft Power Systems at High Energy Density and Carbon Emission: Challenges and Opportunities*
- Exact public status label: **Submitted manuscript — Under editorial review**

Do not describe the manuscript as under peer review, accepted, in press, or published. Do not make its full text publicly downloadable unless the user confirms that journal and co-author policies permit it.

## 7. Accuracy and privacy rules

### 7.1 Suitable public material

- newly written English project summaries;
- clearly attributed role and contribution statements;
- sanitised plots, diagrams, and model screenshots;
- contextualised simulation results;
- selected code or model links after a separate privacy and quality review.

### 7.2 Material excluded from direct publication

- original coursework PDFs;
- student numbers;
- assignment prompts and marking material;
- teammate names or personal information not explicitly approved for release;
- unchanged report pages that expose unrelated coursework data;
- unpublished manuscript full text;
- fabricated contact links, dates, metrics, or project claims.

### 7.3 Figure preparation

Figures must be cropped or recreated from verified source material so that they contain no student number, assessment instructions, unrelated names, comments, or hidden document metadata. Captions must identify whether an image is a concept diagram, simulation output, or model screenshot.

## 8. Pending user inputs

The site can be built locally before these are supplied, but unavailable public controls must be omitted rather than faked. The confirmed public contact email is `yxw1331@student.bham.ac.uk` and should be displayed as a working `mailto:` link.

- GitHub username — required before final repository configuration
- GitHub profile URL — optional until username is known
- LinkedIn URL — optional
- profile photograph — optional; use a neutral `YW` monogram until provided

## 9. Technical design

### 9.1 Site generation

- Astro static site generation
- pre-rendered HTML output
- no database, authentication, server-side API, analytics, or contact-form backend in version 1
- minimal client-side JavaScript
- reusable site layout, sidebar, navigation, project entry, manuscript entry, and metadata components
- project and research records stored as validated content files so future entries do not require layout duplication

Suggested source shape:

```text
src/
  components/
  content/
    projects/
    research/
  layouts/
  pages/
    index.astro
    projects/
    research.astro
  styles/
public/
  assets/
```

The exact file shape may be refined during implementation if Astro's current supported content APIs require a small change; the public information architecture must remain unchanged.

### 9.2 GitHub Pages deployment

- Use a repository named `<username>.github.io` for a root user-site URL when available.
- Use GitHub Actions as the publishing source.
- Use Astro's official GitHub Pages action and GitHub's Pages deployment action at their current supported versions when implementation begins.
- Configure the canonical site URL only after the GitHub username is known.
- Keep a lockfile in the repository for reproducible builds.
- Do not create a remote repository, push, or enable Pages without explicit user approval for the exact target.

Official implementation references:

- <https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site>
- <https://docs.astro.build/en/guides/deploy/github/>

## 10. Accessibility, metadata, and quality

The implementation must include:

- semantic landmarks and heading hierarchy;
- a keyboard-accessible skip link;
- visible keyboard focus;
- descriptive alternative text for meaningful images;
- empty alternative text for decorative imagery;
- adequate colour contrast;
- page-specific English titles and descriptions;
- canonical URLs after the final host is known;
- correct active navigation state;
- no dead or placeholder links;
- responsive layouts for desktop, tablet, and mobile;
- no publication of source-document metadata or sensitive embedded content.

Version 1 does not include a CV page or CV download. It also does not require a blog, CMS, comments, tracking analytics, theme switcher, Chinese translation, contact form, search, or generated social-preview image.

## 11. Build and review workflow

1. Build the complete site locally from the approved specification.
2. Extract or prepare only the minimum sanitised project evidence needed for the three project pages.
3. Validate the production build and internal links.
4. Review wording against the verified source material.
5. Review responsive behaviour and accessibility.
6. Perform a privacy pass over every public asset and generated output.
7. Present the local site to the user for factual and visual review.
8. Request exact GitHub username and repository/publishing approval.
9. Create or connect the approved repository and enable GitHub Pages.
10. Verify the deployed URL and provide a short maintenance guide.

## 12. Acceptance criteria

The first version is complete when:

- About, Projects, and Research routes build successfully;
- three project-detail pages use the approved evidence template;
- the Future Ocean Habitat contribution boundary is explicit;
- the manuscript status appears exactly as approved;
- research interests and ongoing work are not presented as completed research;
- all public copy is English;
- no sensitive coursework or teammate data is present;
- unavailable links are absent rather than broken;
- navigation and content remain usable on narrow and wide screens;
- the production build succeeds;
- the user has reviewed the finished local site;
- public deployment occurs only after separate explicit approval.

## 13. Non-goals for version 1

- copying the reference website or its theme;
- publishing raw coursework or the manuscript;
- presenting a full publication list before verified publications exist;
- adding a backend, database, authentication, contact form, analytics, or CMS;
- adding a CV page or downloadable CV;
- adding speculative projects, achievements, dates, metrics, or affiliations;
- creating a Chinese-language duplicate before the English site is complete.
