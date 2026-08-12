export const PROJECT_KINDS = Object.freeze(['individual', 'team']);
export const BLOCK_TYPES = Object.freeze(['subheading', 'paragraph', 'list', 'table', 'image', 'advanced']);
export const CONTRIBUTION_TITLE = 'My Role and Contribution';
export const MANUSCRIPT_STATUS = 'Submitted manuscript — Under editorial review';
export const EDITOR_ID = /^[a-z][a-z0-9-]{7,63}$/;
export const editorMarker = /^<!-- editor:(section|block) id="([a-z][a-z0-9-]{7,63})"(?: kind="(standard|contribution)")?(?: type="([a-z]+)")? hidden="(true|false)" -->$/;
