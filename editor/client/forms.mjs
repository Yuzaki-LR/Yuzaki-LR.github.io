import {
  createBlock,
  createSection,
  isContribution,
  reserveSlug,
} from "./draft-store.mjs";
import {
  applyAvatarImageImport,
  applyProjectImageImport,
  confirmProjectSlugChange,
  imagePrivacyWarning,
  leaveAvatarImageMode,
  removeProjectImageImport,
} from "./image-controls.mjs";

function node(tag, { text, className, dataset, attributes } = {}) {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  for (const [key, entry] of Object.entries(dataset ?? {}))
    value.dataset[key] = entry;
  for (const [key, entry] of Object.entries(attributes ?? {}))
    value.setAttribute(key, entry);
  return value;
}
function uniqueFactory() {
  return (prefix) =>
    `${prefix}${crypto.randomUUID().replaceAll("-", "")}`.slice(0, 64);
}
function actionButton(text, action, { disabled = false, className } = {}) {
  const value = node("button", { text, className });
  value.type = "button";
  value.disabled = disabled;
  value.addEventListener("click", action);
  return value;
}
function errorBox(container, error) {
  let value = container.querySelector(".form-error");
  if (!value) {
    value = node("p", {
      className: "form-error",
      attributes: { role: "alert" },
    });
    container.prepend(value);
  }
  value.textContent = error.message;
}
function dispatch(container, store, rerender, action) {
  try {
    store.dispatch(action);
    rerender();
  } catch (error) {
    errorBox(container, error);
  }
}
function field({
  label,
  name,
  type = "text",
  value,
  multiline = false,
  onChange,
  disabled = false,
}) {
  const wrapper = node("label", { className: "editor-field" }),
    caption = node("span", { text: label }),
    control = node(multiline ? "textarea" : "input");
  control.name = name ?? "";
  if (!multiline) control.type = type;
  if (multiline) control.rows = 5;
  control.value = value ?? "";
  control.disabled = disabled;
  control.addEventListener("change", () =>
    onChange(
      type === "number"
        ? Number(control.value)
        : type === "checkbox"
          ? control.checked
          : control.value,
    ),
  );
  if (type === "checkbox") control.checked = Boolean(value);
  wrapper.append(caption, control);
  return wrapper;
}
function fieldAction(
  container,
  store,
  rerender,
  path,
  { emptyAsNull = true } = {},
) {
  return (value) =>
    dispatch(container, store, rerender, {
      type: "field/set",
      path,
      value: value === "" && emptyAsNull ? null : value,
    });
}
function controls(
  container,
  store,
  rerender,
  { path, id, index, allowHide = true, allowCopy = true, allowRemove = true },
) {
  const group = node("div", { className: "item-controls" }),
    reorder = node("div", {
      className: "reorder-controls",
      attributes: { role: "group", "aria-label": "调整顺序" },
    }),
    identity = Number.isInteger(index) ? { id, index } : { id };
  for (const [text, direction] of [
    ["上移", -1],
    ["下移", 1],
  ])
    reorder.append(
      actionButton(text, () =>
        dispatch(container, store, rerender, {
          type: "item/move",
          path,
          ...identity,
          direction,
        }),
      ),
    );
  group.append(reorder);
  if (allowCopy)
    group.append(
      actionButton("复制", () =>
        dispatch(container, store, rerender, {
          type: "item/copy",
          path,
          ...identity,
        }),
      ),
    );
  if (allowRemove)
    group.append(
      actionButton(
        "删除",
        () =>
          dispatch(container, store, rerender, {
            type: "item/remove",
            path,
            ...identity,
          }),
        { className: "danger" },
      ),
    );
  if (allowHide) {
    const hide = node("div", { dataset: { hideControlGroup: "" } });
    hide.append(
      actionButton("隐藏", () =>
        dispatch(container, store, rerender, {
          type: "item/hide",
          path,
          ...identity,
        }),
      ),
      node("p", {
        text: "隐藏内容仍保留在 Markdown 中，并可能在未来的公开源代码仓库中可见。",
        className: "privacy-warning",
      }),
    );
    group.append(hide);
  }
  return group;
}

function imageFields({
  container,
  store,
  rerender,
  block,
  path,
  collectionPath,
  projectSlug,
  imageSession,
}) {
  const match = block.markdown.match(
      /^!\[([^\]]*)\]\(([^)]+)\)(?:\r?\n+([\s\S]+))?$/,
    ),
    alt = match?.[1] ?? "",
    source = match?.[2] ?? "./images/image.png",
    caption = match?.[3] ?? "",
    key = block.id;
  const update = (nextAlt, nextCaption, nextSource = source) =>
    dispatch(container, store, rerender, {
      type: "field/set",
      path: [...path, "markdown"],
      value: `![${nextAlt}](${nextSource})${nextCaption ? `\n${nextCaption}` : ""}`,
    });
  const group = node("div", { className: "image-metadata" }),
    input = node("input", {
      attributes: {
        type: "file",
        accept: "image/png,image/jpeg,image/webp,image/tiff",
      },
    }),
    preview = node("img", {
      className: "local-image-preview",
      attributes: { alt: "本地图片预览" },
    });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const result = await applyProjectImageImport({
        file,
        key,
        projectSlug,
        path,
        alt,
        caption,
        store,
        imageSession,
      });
      preview.src = result.previewUrl;
      preview.hidden = false;
      rerender();
    } catch (error) {
      errorBox(container, error);
    }
  });
  preview.hidden = !imageSession?.getPreview(key);
  if (!preview.hidden) preview.src = imageSession.getPreview(key);
  group.append(
    field({
      label: "English alt",
      value: alt,
      onChange: (value) => update(value, caption),
    }),
    field({
      label: "English caption",
      value: caption,
      multiline: true,
      onChange: (value) => update(alt, value),
    }),
    input,
    preview,
    node("p", { text: source, className: "image-source" }),
    actionButton("移除本地图片", async () => {
      try {
        await removeProjectImageImport({
          key,
          path: collectionPath,
          id: block.id,
          store,
          imageSession,
        });
        rerender();
      } catch (error) {
        errorBox(container, error);
      }
    }),
    node("p", { text: imagePrivacyWarning(), className: "privacy-warning" }),
  );
  return group;
}
function renderBlock({
  container,
  store,
  rerender,
  block,
  path,
  collectionPath,
  protectedContribution,
  imageSession,
  projectSlug,
}) {
  const card = node("div", {
      className: "block-card",
      dataset: { editorId: block.id, blockType: block.type },
    }),
    contentPath = [...path, block.type === "advanced" ? "raw" : "markdown"];
  card.append(node("h5", { text: `${block.type} 内容块` }));
  if (block.type === "image")
    card.append(
      imageFields({
        container,
        store,
        rerender,
        block,
        path,
        collectionPath,
        projectSlug,
        imageSession,
      }),
    );
  else
    card.append(
      field({
        label: block.type === "advanced" ? "高级原文" : "Markdown 内容",
        value: block.raw ?? block.markdown ?? "",
        multiline: true,
        onChange: fieldAction(container, store, rerender, contentPath, {
          emptyAsNull: false,
        }),
      }),
    );
  card.append(
    controls(container, store, rerender, {
      path: collectionPath,
      id: block.id,
      allowHide: !protectedContribution,
      allowCopy: !protectedContribution,
      allowRemove: block.type !== "image" && !protectedContribution,
    }),
  );
  return card;
}
function renderDocument({
  container,
  store,
  rerender,
  document,
  root,
  imageSession,
  projectSlug,
  label = "文档",
}) {
  const group = node("section", { className: "document-editor" });
  group.append(node("h3", { text: label }));
  for (
    let sectionIndex = 0;
    sectionIndex < document.sections.length;
    sectionIndex += 1
  ) {
    const section = document.sections[sectionIndex],
      sectionPath = [...root, "sections", sectionIndex],
      collectionPath = [...root, "sections"],
      protectedContribution = isContribution(section),
      card = node("article", {
        className: "section-card",
        dataset: { documentSection: section.id, editorId: section.id },
      });
    card.append(
      field({
        label: "章节标题",
        value: section.title,
        disabled: protectedContribution,
        onChange: fieldAction(container, store, rerender, [
          ...sectionPath,
          "title",
        ]),
      }),
    );
    const blocks = node("div", { className: "block-list" });
    for (
      let blockIndex = 0;
      blockIndex < section.blocks.length;
      blockIndex += 1
    )
      blocks.append(
        renderBlock({
          container,
          store,
          rerender,
          block: section.blocks[blockIndex],
          path: [...sectionPath, "blocks", blockIndex],
          collectionPath: [...sectionPath, "blocks"],
          protectedContribution,
          imageSession,
          projectSlug,
        }),
      );
    card.append(
      blocks,
      controls(container, store, rerender, {
        path: collectionPath,
        id: section.id,
        allowHide: !protectedContribution,
        allowCopy: !protectedContribution,
        allowRemove: !protectedContribution,
      }),
    );
    if (!protectedContribution) {
      const type = node("select");
      for (const value of [
        "paragraph",
        "subheading",
        "list",
        "table",
        "image",
        "advanced",
      ])
        type.append(node("option", { text: value, attributes: { value } }));
      card.append(
        type,
        actionButton("新增内容块", () =>
          dispatch(container, store, rerender, {
            type: "item/add",
            path: [...sectionPath, "blocks"],
            item: createBlock({ type: type.value, idFactory: uniqueFactory() }),
          }),
        ),
      );
    }
    group.append(card);
  }
  group.append(
    actionButton("新增章节", () =>
      dispatch(container, store, rerender, {
        type: "item/add",
        path: [...root, "sections"],
        item: createSection({
          title: "New Section",
          idFactory: uniqueFactory(),
        }),
      }),
    ),
  );
  return group;
}

export function renderInspector({ container, selection, store, onNavigate, imageSession }) {
  container.replaceChildren();
  if (!selection) {
    container.append(
      node("p", { text: "点击预览中的内容，或从左侧选择编辑区域。" }),
    );
    return;
  }
  const rerender = () =>
      renderInspector({
        container,
        selection: findEditable(store.getState(), selection.editorId),
        store,
        onNavigate,
        imageSession,
      }),
    card = node("div", {
      className: "field-card",
      dataset: { editorId: selection.editorId },
    });
  if (selection.route)
    card.append(
      actionButton("编辑项目详情", () => onNavigate?.(selection.route)),
    );
  card.append(
    field({
      label: selection.label ?? "内容",
      value: selection.value ?? "",
      multiline: selection.multiline !== false,
      disabled: selection.fieldDisabled,
      onChange: fieldAction(container, store, rerender, selection.path, {
        emptyAsNull: !selection.allowEmpty,
      }),
    }),
  );
  if (selection.collectionPath)
    card.append(
      controls(container, store, rerender, {
        path: selection.collectionPath,
        id: selection.editorId,
        allowHide: !selection.protectedContribution,
        allowCopy: !selection.protectedContribution,
        allowRemove: !selection.protectedContribution,
      }),
    );
  container.append(card);
}

export function findEditable(draft, editorId) {
  const researchIndex = (draft.research ?? []).findIndex(
    (record) => record.slug === editorId,
  );
  if (researchIndex >= 0) {
    const record = draft.research[researchIndex];
    return {
      editorId,
      label: "稿件标题",
      value: record.document.frontmatter.title,
      path: ["research", researchIndex, "document", "frontmatter", "title"],
      collectionPath: ["research"],
    };
  }
  const projectIndex = (draft.projects ?? []).findIndex(
    (record) => record.slug === editorId,
  );
  if (projectIndex >= 0) {
    const record = draft.projects[projectIndex];
    return {
      editorId,
      label: "项目标题",
      value: record.document.frontmatter.title,
      path: ["projects", projectIndex, "document", "frontmatter", "title"],
      route: `/projects/${record.slug}/`,
    };
  }
  const documents = [
    { root: ["about"], document: draft.about },
    ...(draft.research ?? []).map((record, index) => ({
      root: ["research", index, "document"],
      document: record.document,
    })),
    ...(draft.projects ?? []).map((record, index) => ({
      root: ["projects", index, "document"],
      document: record.document,
    })),
  ];
  for (const { root, document } of documents)
    for (
      let sectionIndex = 0;
      sectionIndex < (document.sections ?? []).length;
      sectionIndex += 1
    ) {
      const section = document.sections[sectionIndex],
        protectedContribution = isContribution(section);
      if (section.id === editorId)
        return {
          editorId,
          label: "章节标题",
          value: section.title,
          path: [...root, "sections", sectionIndex, "title"],
          collectionPath: [...root, "sections"],
          protectedContribution,
          fieldDisabled: protectedContribution,
        };
      for (
        let blockIndex = 0;
        blockIndex < section.blocks.length;
        blockIndex += 1
      ) {
        const block = section.blocks[blockIndex];
        if (block.id === editorId)
          return {
            editorId,
            label: "内容",
            value: block.markdown ?? block.raw ?? "",
            path: [
              ...root,
              "sections",
              sectionIndex,
              "blocks",
              blockIndex,
              block.type === "advanced" ? "raw" : "markdown",
            ],
            collectionPath: [...root, "sections", sectionIndex, "blocks"],
            protectedContribution,
            allowEmpty: true,
          };
      }
    }
  return null;
}

function renderSite({ container, store, rerender, state }) {
  const fields = [
    ["姓名", "site-name", "text", "name"],
    ["学位", "site-degree", "text", "degree"],
    ["学校", "site-institution", "text", "institution"],
    ["邮箱", "site-email", "email", "email"],
    ["简介", "site-intro", "text", "intro"],
  ];
  for (const [label, name, type, key] of fields)
    container.append(
      field({
        label,
        name,
        type,
        value: state.site[key],
        multiline: key === "intro",
        onChange: fieldAction(container, store, rerender, ["site", key]),
      }),
    );
  for (let index = 0; index < state.site.interests.length; index += 1) {
    const value = state.site.interests[index],
      card = node("div", { className: "record-card" });
    card.append(
      field({
        label: "研究兴趣",
        value,
        onChange: fieldAction(container, store, rerender, [
          "site",
          "interests",
          index,
        ]),
      }),
      controls(container, store, rerender, {
        path: ["site", "interests"],
        id: value,
        index,
        allowHide: false,
      }),
    );
    container.append(card);
  }
  container.append(
    actionButton("新增研究兴趣", () =>
      dispatch(container, store, rerender, {
        type: "item/add",
        path: ["site", "interests"],
        item: "New interest",
      }),
    ),
  );
  for (const [label, key] of [
    ["GitHub", "github"],
    ["LinkedIn", "linkedin"],
    ["Google Scholar", "googleScholar"],
    ["ORCID", "orcid"],
  ])
    container.append(
      field({
        label,
        type: "url",
        value: state.site.links[key],
        onChange: fieldAction(container, store, rerender, [
          "site",
          "links",
          key,
        ]),
      }),
    );
}
function renderAbout(context) {
  context.container.append(
    renderDocument({
      ...context,
      document: context.state.about,
      root: ["about"],
      label: "首页 About 内容",
    }),
  );
}
function renderResearch({ container, store, rerender, state, imageSession }) {
  for (let index = 0; index < state.research.length; index += 1) {
    const record = state.research[index],
      root = ["research", index, "document"],
      frontmatter = record.document.frontmatter,
      card = node("article", {
        className: "record-card",
        dataset: { researchRecord: record.slug },
      });
    card.append(
      node("h3", { text: record.slug }),
      field({
        label: "稿件标题",
        value: frontmatter.title,
        onChange: fieldAction(container, store, rerender, [
          ...root,
          "frontmatter",
          "title",
        ]),
      }),
      field({
        label: "摘要",
        value: frontmatter.summary,
        multiline: true,
        onChange: fieldAction(container, store, rerender, [
          ...root,
          "frontmatter",
          "summary",
        ]),
      }),
      field({
        label: "排序",
        type: "number",
        value: frontmatter.order,
        onChange: fieldAction(container, store, rerender, [
          ...root,
          "frontmatter",
          "order",
        ]),
      }),
    );
    for (const [label, key] of [
      ["作者身份", "authorship"],
      ["日期", "date"],
    ])
      card.append(
        field({
          label,
          value: frontmatter[key],
          onChange: fieldAction(container, store, rerender, [
            ...root,
            "frontmatter",
            key,
          ]),
        }),
      );
    card.append(
      controls(container, store, rerender, {
        path: ["research"],
        id: record.slug,
      }),
      renderDocument({
        container,
        store,
        rerender,
        document: record.document,
        root,
        label: "稿件正文",
        imageSession,
      }),
    );
    container.append(card);
  }
  container.append(
    actionButton("新增稿件", () => {
      const existing = state.research.map((record) => record.slug),
        slug = reserveSlug("new-research", existing);
      dispatch(container, store, rerender, {
        type: "item/add",
        path: ["research"],
        item: {
          slug,
          document: {
            frontmatter: {
              title: "New research",
              summary: "Summary",
              order: state.research.length,
            },
            sections: [
              createSection({ title: "Overview", idFactory: uniqueFactory() }),
            ],
            newline: "\n",
            trailingNewline: true,
          },
        },
      });
    }),
  );
}
function renderProjects({ container, store, rerender, state, onNavigate, imageSession }) {
  const creator = node("section", { className: "create-project" }),
    title = field({
      label: "新项目标题",
      name: "new-project-title",
      value: "New project",
      onChange: () => {},
    }),
    kind = node("select");
  for (const [value, text] of [
    ["individual", "个人项目"],
    ["team", "团队项目"],
  ])
    kind.append(node("option", { text, attributes: { value } }));
  creator.append(
    title,
    kind,
    actionButton("创建项目", () =>
      dispatch(container, store, rerender, {
        type: "project/create",
        kind: kind.value,
        title: title.querySelector("input").value,
      }),
    ),
  );
  container.append(creator);
  for (let index = 0; index < state.projects.length; index += 1) {
    const record = state.projects[index],
      document = record.document,
      frontmatter = document.frontmatter,
      root = ["projects", index, "document"],
      card = node("article", {
        className: "record-card",
        dataset: { projectRecord: record.slug },
      });
    card.append(
      node("h3", { text: frontmatter.title }),
      actionButton("编辑项目详情", () =>
        onNavigate?.(`/projects/${record.slug}/`),
      ),
      field({
        label: "项目标题",
        value: frontmatter.title,
        onChange: fieldAction(container, store, rerender, [
          ...root,
          "frontmatter",
          "title",
        ]),
      }),
      field({
        label: "短标题",
        value: frontmatter.shortTitle,
        onChange: fieldAction(container, store, rerender, [
          ...root,
          "frontmatter",
          "shortTitle",
        ]),
      }),
      field({
        label: "摘要",
        value: frontmatter.summary,
        multiline: true,
        onChange: fieldAction(container, store, rerender, [
          ...root,
          "frontmatter",
          "summary",
        ]),
      }),
      field({
        label: "角色",
        value: frontmatter.role,
        onChange: fieldAction(container, store, rerender, [
          ...root,
          "frontmatter",
          "role",
        ]),
      }),
      field({
        label: "排序",
        type: "number",
        value: frontmatter.order,
        onChange: fieldAction(container, store, rerender, [
          ...root,
          "frontmatter",
          "order",
        ]),
      }),
      field({
        label: "精选项目",
        type: "checkbox",
        value: frontmatter.featured,
        onChange: fieldAction(container, store, rerender, [
          ...root,
          "frontmatter",
          "featured",
        ]),
      }),
    );
    for (
      let methodIndex = 0;
      methodIndex < frontmatter.methods.length;
      methodIndex += 1
    )
      card.append(
        field({
          label: `方法 ${methodIndex + 1}`,
          value: frontmatter.methods[methodIndex],
          onChange: fieldAction(container, store, rerender, [
            ...root,
            "frontmatter",
            "methods",
            methodIndex,
          ]),
        }),
      );
    const slugField = field({
        label: "项目网址",
        value: record.slug,
        onChange: () => {},
      }),
      slugInput = slugField.querySelector("input");
    card.append(
      slugField,
      actionButton("预览网址变更", () =>
        dispatch(container, store, rerender, {
          type: "project/change-slug",
          slug: record.slug,
          candidate: slugInput.value,
        }),
      ),
    );
    const nextKind = frontmatter.kind === "team" ? "individual" : "team";
    card.append(
      actionButton(`改为${nextKind === "team" ? "团队" : "个人"}项目`, () =>
        dispatch(container, store, rerender, {
          type: "project/change-kind",
          slug: record.slug,
          kind: nextKind,
        }),
      ),
      actionButton(
        "删除项目",
        () =>
          dispatch(container, store, rerender, {
            type: "project/remove",
            slug: record.slug,
          }),
        { className: "danger" },
      ),
    );
    if (state.pendingSlugChange?.slug === record.slug)
      card.append(
        node("pre", {
          text: JSON.stringify(state.pendingSlugChange.diff, null, 2),
        }),
        actionButton("确认网址变更", () => {
          try{confirmProjectSlugChange({store,imageSession,slug:record.slug});rerender();}catch(error){errorBox(container,error);}
        }),
      );
    if (state.pendingKindChange?.slug === record.slug)
      card.append(
        node("pre", {
          text: JSON.stringify(state.pendingKindChange.diff, null, 2),
        }),
        actionButton("确认类型变更", () =>
          dispatch(container, store, rerender, {
            type: "project/confirm-kind-change",
            slug: record.slug,
          }),
        ),
      );
    if (state.pendingProjectRemoval?.slug === record.slug)
      card.append(
        node("pre", {
          text: JSON.stringify(state.pendingProjectRemoval.diff, null, 2),
        }),
        actionButton(
          "再次确认删除项目",
          () =>
            dispatch(container, store, rerender, {
              type: "project/confirm-remove",
              slug: record.slug,
            }),
          { className: "danger" },
        ),
      );
    card.append(
      renderDocument({
        container,
        store,
        rerender,
        document,
        root,
        label: "项目正文",
        imageSession,
        projectSlug: record.slug,
      }),
    );
    container.append(card);
  }
}
function renderAppearance({ container, store, rerender, state, imageSession }) {
  for (const [label, key] of [
    ["背景", "background"],
    ["表面", "surface"],
    ["正文", "text"],
    ["强调色", "accent"],
  ])
    container.append(
      field({
        label,
        type: "color",
        value: state.site.theme[key],
        onChange: fieldAction(container, store, rerender, [
          "site",
          "theme",
          key,
        ]),
      }),
    );
  const avatar = node("label", { className: "editor-field" });
  avatar.append(node("span", { text: "头像" }));
  const select = node("select");
  for (const [value, text] of [
    ["initials", "首字母"],
    ["image", "图片"],
    ["hidden", "隐藏"],
  ]) {
    const option = node("option", { text, attributes: { value } });
    option.selected = state.site.avatar.mode === value;
    select.append(option);
  }
  select.addEventListener("change", async () => {
    if (select.value === "image") {
      select.value = state.site.avatar.mode;
      return;
    }
    try {
      await leaveAvatarImageMode({ mode: select.value, store, imageSession });
      rerender();
    } catch (error) {
      errorBox(container, error);
      select.value = state.site.avatar.mode;
    }
  });
  avatar.append(select);
  container.append(avatar);
  const avatarImport=node("div",{className:"image-metadata"}),
    avatarAlt=field({label:"English avatar alt",value:state.site.avatar.alt??"Portrait",onChange:value=>{if(state.site.avatar.mode==='image')dispatch(container,store,rerender,{type:'field/set',path:['site','avatar','alt'],value});}}),
    avatarAltInput=avatarAlt.querySelector("input"),
    avatarInput=node("input",{attributes:{type:"file",accept:"image/png,image/jpeg,image/webp,image/tiff"}}),
    avatarPreview=node("img",{className:"local-image-preview",attributes:{alt:"本地头像预览"}});
  avatarPreview.hidden=!imageSession.getPreview("avatar");
  if(!avatarPreview.hidden)avatarPreview.src=imageSession.getPreview("avatar");
  avatarInput.addEventListener("change",async()=>{
    const file=avatarInput.files?.[0];if(!file)return;
    try{await applyAvatarImageImport({file,alt:avatarAltInput.value,store,imageSession});rerender();}catch(error){errorBox(container,error);}
  });
  avatarImport.append(avatarAlt,avatarInput,avatarPreview,node("p",{text:state.site.avatar.src??"尚未导入头像图片",className:"image-source"}),node("p",{text:imagePrivacyWarning(),className:"privacy-warning"}));
  container.append(avatarImport);
  for (let index = 0; index < state.site.links.custom.length; index += 1) {
    const link = state.site.links.custom[index],
      card = node("article", { className: "record-card" });
    card.append(
      field({
        label: "链接名称",
        value: link.label,
        onChange: fieldAction(container, store, rerender, [
          "site",
          "links",
          "custom",
          index,
          "label",
        ]),
      }),
      field({
        label: "链接地址",
        type: "url",
        value: link.href,
        onChange: fieldAction(container, store, rerender, [
          "site",
          "links",
          "custom",
          index,
          "href",
        ]),
      }),
      controls(container, store, rerender, {
        path: ["site", "links", "custom"],
        id: link._editorId,
      }),
    );
    container.append(card);
  }
  container.append(
    actionButton("新增链接", () =>
      dispatch(container, store, rerender, {
        type: "item/add",
        path: ["site", "links", "custom"],
        item: { label: "New link", href: "https://example.com" },
      }),
    ),
    node("p", {
      text: imagePrivacyWarning(),
      className: "privacy-warning",
    }),
  );
}
function renderBackup({ container, state, api, csrfToken, onRestored }) {
  container.append(
    node("h3", { text: "草稿与备份" }),
    node("p", { text: `规范内容基线：${state.baseManifestHash}` }),
    node("p", { text: imagePrivacyWarning(), className: "privacy-warning" }),
  );
  const list = node("div", { attributes: { "aria-live": "polite" } });
  list.append(node("p", { text: "正在读取备份…" }));
  container.append(list);
  if (typeof api?.backups !== "function") return;
  api.backups().then((value) => {
    if (!list.isConnected) return;
    list.replaceChildren();
    if (value.status !== 200 || value.ok !== true) { errorBox(list, new Error(value.messageZh ?? "无法读取备份。")); return; }
    if (!value.backups.length) { list.append(node("p", { text: "尚无备份记录。" })); return; }
    const operationNames = { save: "保存", archive: "草稿备份", restore: "恢复" };
    for (const backup of [...value.backups].reverse()) {
      const card = node("article", { className: "record-card", dataset: { backupId: backup.id } });
      card.append(
        node("h4", { text: new Date(backup.createdAt).toLocaleString("zh-CN") }),
        node("p", { text: `操作：${operationNames[backup.kind] ?? backup.kind} · 状态：${backup.status}` }),
      );
      const output = node("div", { attributes: { "aria-live": "polite" } });
      const view = actionButton("查看差异", async () => {
        view.disabled = true; output.replaceChildren(node("p", { text: "正在比较文本、配置与图片…" }));
        try {
          const result = await api.diffBackup(backup.id, csrfToken);
          if (result.status !== 200 || result.ok !== true) throw new Error(result.messageZh ?? "无法比较备份。");
          const lines = [
            ...(result.diff.added ?? []).map((name) => `新增：${name}`),
            ...(result.diff.removed ?? []).map((name) => `删除：${name}`),
            ...(result.diff.changed ?? []).map((name) => `修改：${name}`),
          ];
          output.replaceChildren(node("pre", { text: lines.join("\n") || "没有文件差异" }));
          const confirm = actionButton("确认恢复", async () => {
            confirm.disabled = true;
            try {
              const restored = await api.restore(backup.id, result.confirmation.token, csrfToken);
              if (restored.status !== 200 || restored.ok !== true) throw new Error(restored.messageZh ?? "恢复失败。");
              onRestored?.(restored);
            } catch (error) { errorBox(output, error); confirm.disabled = false; }
          }, { className: "danger" });
          output.append(confirm);
        } catch (error) { output.replaceChildren(); errorBox(output, error); view.disabled = false; }
      });
      card.append(view, output); list.append(card);
    }
  }).catch((error) => { if (list.isConnected) { list.replaceChildren(); errorBox(list, error); } });
}

export function renderPanel({ container, panel, store, onNavigate, imageSession, api, csrfToken, onRestored }) {
  const rerender = () => renderPanel({ container, panel, store, onNavigate, imageSession, api, csrfToken, onRestored });
  container.replaceChildren();
  const context = {
    container,
    panel,
    store,
    onNavigate,
    imageSession,
    api,
    csrfToken,
    onRestored,
    rerender,
    state: store.getState(),
  };
  if (panel === "site") renderSite(context);
  else if (panel === "about") renderAbout(context);
  else if (panel === "research") renderResearch(context);
  else if (panel === "projects") renderProjects(context);
  else if (panel === "appearance") renderAppearance(context);
  else if (panel === "backup") renderBackup(context);
  else container.append(node("p", { text: "此编辑区域不存在。" }));
}
