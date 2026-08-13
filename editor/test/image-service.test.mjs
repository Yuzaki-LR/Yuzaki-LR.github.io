import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { sanitiseImage } from "../server/image-service.mjs";
import * as imageControls from "../client/image-controls.mjs";
import { createDraftStore, toCandidateBundle } from "../client/draft-store.mjs";
import { createUploadStore } from "../server/upload-store.mjs";
import { createRepositoryService } from "../server/repository-service.mjs";
import { createTestWorkspace } from "../../test/helpers.mjs";

const { createImageSession, imagePrivacyWarning } = imageControls;

const fixture = (name) =>
  readFile(new URL(`./fixtures/${name}`, import.meta.url));
test("real PNG JPEG WebP and TIFF bytes become metadata-free PNG without changing source bytes", async () => {
  const base = await fixture("metadata.png"),
    generated = [
      ["metadata.png", base],
      ["photo.jpeg", await sharp(base).jpeg().toBuffer()],
      ["photo.webp", await sharp(base).webp().toBuffer()],
      ["photo.tiff", await sharp(base).tiff().toBuffer()],
    ];
  for (const [originalName, bytes] of generated) {
    const before = Buffer.from(bytes),
      result = await sanitiseImage({ bytes, originalName });
    assert.deepEqual(bytes, before);
    assert.equal(result.mime, "image/png");
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    const metadata = await sharp(result.bytes).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, 2);
    assert.equal(metadata.height, 2);
    for (const key of ["exif", "xmp", "iptc", "icc", "comments"])
      assert.equal(metadata[key], undefined, `${originalName} ${key}`);
    assert.equal(metadata.hasProfile, false);
  }
});
test("EXIF orientation is applied to visible pixels and dimensions", async () => {
  const bytes = await fixture("oriented.jpg"),
    source = await sharp(bytes).metadata();
  assert.equal(source.orientation, 6);
  assert.equal(source.width, 2);
  assert.equal(source.height, 3);
  const result = await sanitiseImage({ bytes, originalName: "oriented.jpg" });
  assert.equal(result.width, 3);
  assert.equal(result.height, 2);
  assert.equal((await sharp(result.bytes).metadata()).orientation, undefined);
});
test("safe ASCII names include deterministic content hash and reject traversal before decode", async () => {
  const bytes = await fixture("metadata.png"),
    a = await sanitiseImage({ bytes, originalName: "CON 照片.png" }),
    different = await sanitiseImage({
      bytes: await sharp(bytes).negate().png().toBuffer(),
      originalName: "CON 照片.png",
    });
  assert.match(a.safeName, /^image-[a-f0-9]{8}\.png$/);
  assert.notEqual(a.safeName, different.safeName);
  for (const name of [
    "..",
    ".",
    "a..b.png",
    "folder/name.png",
    "folder\\name.png",
  ])
    await assert.rejects(
      sanitiseImage({ bytes, originalName: name }),
      /文件名不安全/,
    );
});
test("damaged and over-pixel inputs fail in Chinese", async () => {
  for (const name of ["corrupt.tif", "oversized-header.png"])
    await assert.rejects(
      sanitiseImage({ bytes: await fixture(name), originalName: name }),
      /[一-鿿]/,
    );
});
test("browser image session creates local previews and revokes them on replace remove and close", async () => {
  const revoked = [],
    created = [],
    urlApi = {
      createObjectURL: () => {
        const value = `blob:test-${created.length}`;
        created.push(value);
        return value;
      },
      revokeObjectURL: (value) => revoked.push(value),
    },
    fetchImpl = async () => ({
      ok: true,
      json: async () => ({
        uploadId: "a".repeat(32),
        width: 2,
        height: 2,
        safeName: "photo-12345678.png",
      }),
    }),
    discarded = [],
    session = createImageSession({ csrfToken: "csrf", sessionId: "b".repeat(32), fetchImpl, discardImpl: async (uploadId,options) => { discarded.push([uploadId,options]); return {ok:true,status:204}; }, urlApi }),
    first = new File([Buffer.from([1])], "first.png", { type: "image/png" }),
    second = new File([Buffer.from([2])], "second.png", { type: "image/png" });
  await session.upload(first, {key:"block",destinationPrefix:"projects/project-one/images"});
  await session.upload(second, {key:"block",destinationPrefix:"projects/project-one/images"});
  assert.deepEqual(revoked, ["blob:test-0"]);
  await session.remove("block");
  assert.deepEqual(revoked, ["blob:test-0", "blob:test-1"]);
  await session.upload(first, {key:"avatar",destinationPrefix:"site-images"});
  await session.close();
  assert.deepEqual(revoked, ["blob:test-0", "blob:test-1", "blob:test-2"]);
  assert.deepEqual(discarded.map(value=>value[0]),["a".repeat(32),"a".repeat(32),"a".repeat(32)]);
  assert.match(imagePrivacyWarning(), /Fig\.|report|报告|私密像素/);
});
test("Task 9 upload adapter replaces a real canonical project image with one session-bound candidate reference", async (t) => {
  const workspace = await createTestWorkspace();
  t.after(workspace.cleanup);
  const bootstrap = await createRepositoryService({
      projectRoot: workspace.root,
      csrfToken: "csrf-A",
    }).bootstrap(),
    store = createDraftStore(bootstrap),
    serverStore = createUploadStore({ sessionId: "c".repeat(32) }),
    project = store
      .getState()
      .projects.find((record) =>
        record.document.sections.some((section) =>
          section.blocks.some((block) => block.type === "image"),
        ),
      ),
    sectionIndex = project.document.sections.findIndex((section) =>
      section.blocks.some((block) => block.type === "image"),
    ),
    blockIndex = project.document.sections[sectionIndex].blocks.findIndex(
      (block) => block.type === "image",
    ),
    block = project.document.sections[sectionIndex].blocks[blockIndex],
    bytes = await fixture("metadata.png"),
    saved = serverStore.add({
      bytes,
      width: 2,
      height: 2,
      mime: "image/png",
      safeName: "replacement-12345678.png",
      sha256: "a".repeat(64),
    }),
    imageSession = createImageSession({
      csrfToken: "csrf-A",
      sessionId: serverStore.sessionId,
      fetchImpl: async () => ({ ok: true, json: async () => saved }),
      urlApi: { createObjectURL: () => "blob:test", revokeObjectURL: () => {} },
    });
  await imageSession.upload(
    new File([bytes], "replacement.png", { type: "image/png" }),
    { key: block.id, destinationPrefix: `projects/${project.slug}/images` },
  );
  store.dispatch({
    type: "field/set",
    path: [
      "projects",
      store
        .getState()
        .projects.findIndex((record) => record.slug === project.slug),
      "document",
      "sections",
      sectionIndex,
      "blocks",
      blockIndex,
      "markdown",
    ],
    value: `![Replacement](./images/${saved.safeName})\nCaption`,
  });
  const adapter = {
      sessionId: serverStore.sessionId,
      uploads: imageSession.uploads,
      resolveCanonical: () => true,
      resolveUpload: (reference) =>
        Boolean(serverStore.resolveUpload(reference)),
    },
    candidate = toCandidateBundle(store.getState(), adapter),
    expected = {
      kind: "upload",
      destination: `projects/${project.slug}/images/${saved.safeName}`,
      uploadId: saved.uploadId,
      sessionId: serverStore.sessionId,
    };
  assert.deepEqual(imageSession.uploads, [expected]);
  assert.deepEqual(
    candidate.images.find((image) => image.kind === "upload"),
    expected,
  );
  assert.equal(serverStore.resolveUpload(expected).uploadId, saved.uploadId);
});
test("image sessions reject unsafe identity and destinations before fetch or Blob creation",async()=>{for(const sessionId of [undefined,"", "a".repeat(31),"A".repeat(32)])assert.throws(()=>createImageSession({sessionId}),/会话/);let fetches=0,creates=0;const session=createImageSession({sessionId:"d".repeat(32),csrfToken:"csrf",fetchImpl:async()=>{fetches+=1;throw new Error("unreachable");},urlApi:{createObjectURL:()=>{creates+=1;return"blob:test";},revokeObjectURL:()=>{}}}),file=new File([Buffer.from([1])],"a.png",{type:"image/png"});for(const destinationPrefix of ["../site-images","projects\\slug\\images","projects/%2e%2e/images","projects/Project/images","projects/bad_slug/images","projects/project/images/extra","site-Images"])await assert.rejects(session.upload(file,{key:"x",destinationPrefix}),/位置/);assert.equal(fetches,0);assert.equal(creates,0);assert.deepEqual(session.uploads,[]);});
test("project and avatar helpers apply only closed store actions through one image session",async()=>{const actions=[],removed=[],events=[],store={dispatch:action=>{actions.push(action);events.push(`dispatch:${action.type}`)}},calls=[],imageSession={stage:async(_file,options)=>{calls.push(options);return{safeName:"clean-12345678.png",previewUrl:"blob:test",commit:async()=>events.push(`commit:${options.key}`),rollback:async()=>events.push(`rollback:${options.key}`)};},remove:async key=>{removed.push(key);events.push(`remove:${key}`)}},file=new File([Buffer.from([1])],"a.png",{type:"image/png"}),blockPath=["projects",0,"document","sections",0,"blocks",0],collectionPath=blockPath.slice(0,-1);await imageControls.applyProjectImageImport({file,key:"block1",projectSlug:"project-one",path:blockPath,alt:"Plot",caption:"Caption",store,imageSession});await imageControls.removeProjectImageImport({key:"block1",path:collectionPath,id:"block1",store,imageSession});await imageControls.applyAvatarImageImport({file,alt:"Portrait",store,imageSession});await imageControls.leaveAvatarImageMode({mode:"hidden",store,imageSession});assert.deepEqual(calls,[{key:"block1",destinationPrefix:"projects/project-one/images"},{key:"avatar",destinationPrefix:"site-images"}]);assert.deepEqual(actions,[{type:"field/set",path:[...blockPath,"markdown"],value:"![Plot](./images/clean-12345678.png)\nCaption"},{type:"item/remove",path:collectionPath,id:"block1"},{type:"avatar/transition",mode:"image",src:"./site-images/clean-12345678.png",alt:"Portrait"},{type:"avatar/transition",mode:"hidden"}]);assert.deepEqual(removed,["block1","avatar"]);assert.deepEqual(events.slice(1,4),["commit:block1","dispatch:item/remove","remove:block1"]);const rejected=[];await assert.rejects(imageControls.removeProjectImageImport({key:"block2",path:collectionPath,id:"block2",store:{dispatch:()=>{throw new Error("reject action")}},imageSession:{remove:key=>rejected.push(key)}}),/reject action/);assert.deepEqual(rejected,[]);});

test("project and avatar helpers produce a valid real-store draft and roll back rejected transitions",async(t)=>{
  const workspace=await createTestWorkspace();
  t.after(workspace.cleanup);
  const source=await createRepositoryService({projectRoot:workspace.root,csrfToken:"csrf"}).bootstrap();
  const store=createDraftStore(source);
  const project=store.getState().projects.find(record=>record.document.sections.some(section=>section.blocks.some(block=>block.type==="image")));
  const projectIndex=store.getState().projects.findIndex(record=>record.slug===project.slug);
  const sectionIndex=project.document.sections.findIndex(section=>section.blocks.some(block=>block.type==="image"));
  const blockIndex=project.document.sections[sectionIndex].blocks.findIndex(block=>block.type==="image");
  const block=project.document.sections[sectionIndex].blocks[blockIndex];
  const removed=[];
  const imageSession={stage:async(_file,{key})=>({safeName:`${key}-12345678.png`,previewUrl:`blob:${key}`,commit:()=>{},rollback:()=>removed.push(`rollback:${key}`)}),remove:key=>removed.push(key)};
  const file=new File([Buffer.from([1])],"a.png",{type:"image/png"});
  const path=["projects",projectIndex,"document","sections",sectionIndex,"blocks",blockIndex];
  await imageControls.applyProjectImageImport({file,key:block.id,projectSlug:project.slug,path,alt:"English plot",caption:"English caption",store,imageSession});
  assert.equal(store.getState().projects[projectIndex].document.sections[sectionIndex].blocks[blockIndex].markdown,`![English plot](./images/${block.id}-12345678.png)\nEnglish caption`);
  await imageControls.applyAvatarImageImport({file,alt:"English portrait",store,imageSession});
  assert.deepEqual(store.getState().site.avatar,{mode:"image",src:"./site-images/avatar-12345678.png",alt:"English portrait"});
  await imageControls.leaveAvatarImageMode({mode:"initials",store,imageSession});
  assert.deepEqual(store.getState().site.avatar,{mode:"initials"});
  assert.deepEqual(removed,["avatar"]);
});

test("failed replacement keeps the committed upload preview and draft until transition commit", async (t) => {
  const responses = [], revoked = [], created = [];
  const session = createImageSession({
    csrfToken: "csrf",
    sessionId: "b".repeat(32),
    fetchImpl: async (_target, options) => {
      responses.push(options.headers["X-Editor-Filename"]);
      const next = responses.length;
      if (next === 2) throw new Error("network unavailable");
      if (next === 3) return { ok: false, json: async () => ({ messageZh: "rejected" }) };
      if (next === 4) return { ok: true, json: async () => ({ uploadId: "bad" }) };
      return { ok: true, json: async () => ({ uploadId: String(next).repeat(32), width: 2, height: 2, safeName: `photo-${String(next).repeat(8)}.png` }) };
    },
    urlApi: { createObjectURL: () => `blob:stage-${created.push(created.length) - 1}`, revokeObjectURL: value => revoked.push(value) },
  });
  const first = new File([Buffer.from([1])], "first.png", { type: "image/png" });
  const saved = await session.upload(first, { key: "block", destinationPrefix: "projects/project-one/images" });
  const beforeUploads = session.uploads, beforePreview = session.getPreview("block");
  for (const name of ["network.png", "non-ok.png", "malformed.png"])
    await assert.rejects(session.upload(new File([Buffer.from([2])], name), { key: "block", destinationPrefix: "projects/project-one/images" }));
  assert.deepEqual(session.uploads, beforeUploads);
  assert.equal(session.getPreview("block"), beforePreview);
  assert.deepEqual(revoked, ["blob:stage-1", "blob:stage-2", "blob:stage-3"]);
  const workspace=await createTestWorkspace();t.after(workspace.cleanup);const realStore=createDraftStore(await createRepositoryService({projectRoot:workspace.root,csrfToken:"csrf"}).bootstrap()),draftBefore=realStore.getState(),rejectingStore={dispatch:()=>{throw new Error("draft rejected");}};
  await assert.rejects(imageControls.applyProjectImageImport({ file: new File([Buffer.from([3])], "dispatch.png"), key: "block", projectSlug: "project-one", path: ["projects", 0, "document", "sections", 0, "blocks", 0], alt: "Plot", caption: "Caption", store: rejectingStore, imageSession: session }), /draft rejected/);
  assert.deepEqual(session.uploads, beforeUploads);
  assert.equal(session.getPreview("block"), saved.previewUrl);
  assert.deepEqual(realStore.getState(),draftBefore);
  await session.upload(new File([Buffer.from([4])], "avatar-old.png"), { key: "avatar", destinationPrefix: "site-images" });
  const avatarBefore = session.getPreview("avatar"), avatarUploads = session.uploads;
  await assert.rejects(imageControls.applyAvatarImageImport({ file: new File([Buffer.from([5])], "avatar-new.png"), alt: "Portrait", store: { dispatch: () => { throw new Error("avatar rejected"); } }, imageSession: session }), /avatar rejected/);
  assert.equal(session.getPreview("avatar"), avatarBefore);
  assert.deepEqual(session.uploads, avatarUploads);
  assert.deepEqual(revoked,["blob:stage-1","blob:stage-2","blob:stage-3","blob:stage-4","blob:stage-6"]);
});

test("image session uses canonical reversible ASCII filename transport", async () => {
  let transported,length;
  const session=createImageSession({csrfToken:"csrf",sessionId:"c".repeat(32),fetchImpl:async(_target,options)=>{transported=options.headers["X-Editor-Filename"];length=options.headers["X-Editor-Content-Length"];return{ok:true,json:async()=>({uploadId:"d".repeat(32),width:1,height:1,safeName:"image-12345678.png"})};},discardImpl:async()=>({ok:true,status:204}),urlApi:{createObjectURL:()=>"blob:name",revokeObjectURL:()=>{}}});
  const name="中文 照片.png";
  await session.upload(new File([Buffer.from([1])],name),{key:"name",destinationPrefix:"site-images"});
  assert.equal(transported,encodeURIComponent(name));
  assert.equal(length,"1");
});

test("failed server discard remains reachable for bounded keepalive close retry",async()=>{const calls=[];let uploaded=0;const session=createImageSession({csrfToken:"csrf",sessionId:"2".repeat(32),fetchImpl:async()=>({ok:true,json:async()=>({uploadId:String(++uploaded).repeat(32),width:1,height:1,safeName:`image-${String(uploaded).repeat(8)}.png`})}),discardImpl:async(uploadId,options)=>{calls.push([uploadId,options]);return calls.length===1?{ok:false,status:503}:{ok:true,status:204};},discardTimeoutMs:50,urlApi:{createObjectURL:()=>`blob:${uploaded}`,revokeObjectURL:()=>{}}}),file=new File([Buffer.from([1])],"a.png");await session.upload(file,{key:"block",destinationPrefix:"projects/project-one/images"});await session.upload(file,{key:"block",destinationPrefix:"projects/project-one/images"});assert.deepEqual(calls,[["1".repeat(32),{keepalive:false}]]);await session.close();assert.deepEqual(calls,[["1".repeat(32),{keepalive:false}],["1".repeat(32),{keepalive:true}],["2".repeat(32),{keepalive:true}]]);assert.deepEqual(session.uploads,[]);});

test("malformed successful response discards a recoverable staged upload id",async()=>{const discarded=[],revoked=[],uploadId="3".repeat(32),session=createImageSession({csrfToken:"csrf",sessionId:"4".repeat(32),fetchImpl:async()=>({ok:true,json:async()=>({uploadId,width:0,height:1,safeName:"image-12345678.png"})}),discardImpl:async id=>{discarded.push(id);return{ok:true,status:204};},urlApi:{createObjectURL:()=>"blob:malformed",revokeObjectURL:value=>revoked.push(value)}});await assert.rejects(session.upload(new File([Buffer.from([1])],"a.png"),{key:"block",destinationPrefix:"projects/project-one/images"}),/响应无效/);assert.deepEqual(discarded,[uploadId]);assert.deepEqual(revoked,["blob:malformed"]);assert.deepEqual(session.uploads,[]);});

test("close owns an in-flight stage and prevents a late transaction commit",async()=>{let resolveFetch;const uploadId="5".repeat(32),discarded=[],revoked=[],session=createImageSession({csrfToken:"csrf",sessionId:"6".repeat(32),fetchImpl:()=>new Promise(resolve=>{resolveFetch=resolve}),discardImpl:async id=>{discarded.push(id);return{ok:true,status:204}},urlApi:{createObjectURL:()=>"blob:late",revokeObjectURL:value=>revoked.push(value)}}),upload=session.upload(new File([Buffer.from([1])],"late.png"),{key:"block",destinationPrefix:"projects/project-one/images"}),closing=session.close();await assert.rejects(session.upload(new File([Buffer.from([2])],"new.png"),{key:"new",destinationPrefix:"site-images"}),/关闭/);resolveFetch({ok:true,json:async()=>({uploadId,width:1,height:1,safeName:"late-12345678.png"})});await assert.rejects(upload,/关闭/);assert.deepEqual(await closing,{complete:true,pending:0});assert.deepEqual(discarded,[uploadId]);assert.deepEqual(revoked,["blob:late"]);assert.deepEqual(session.uploads,[]);assert.equal(session.getPreview("block"),undefined);});

test("subsequent close retries retained cleanup and concurrent closes coalesce",async()=>{const uploadId="7".repeat(32),calls=[];let releaseFirst;const session=createImageSession({csrfToken:"csrf",sessionId:"8".repeat(32),fetchImpl:async()=>({ok:true,json:async()=>({uploadId,width:1,height:1,safeName:"close-12345678.png"})}),discardImpl:(id,options)=>{calls.push([id,options]);if(calls.length===1)return new Promise(resolve=>{releaseFirst=()=>resolve({ok:false,status:503})});return Promise.resolve({ok:true,status:204})},discardTimeoutMs:100,urlApi:{createObjectURL:()=>"blob:close",revokeObjectURL:()=>{}}});await session.upload(new File([Buffer.from([1])],"close.png"),{key:"block",destinationPrefix:"site-images"});const first=session.close(),same=session.close();assert.equal(first,same);await Promise.resolve();assert.equal(typeof releaseFirst,"function");releaseFirst();assert.deepEqual(await first,{complete:false,pending:1});assert.deepEqual(await session.close(),{complete:true,pending:0});assert.deepEqual(calls,[[uploadId,{keepalive:true}],[uploadId,{keepalive:true}]]);});

test("confirmed slug migration keeps canonical and uploaded project images candidate-ready", async (t) => {
  assert.equal(typeof imageControls.confirmProjectSlugChange, "function");
  const workspace = await createTestWorkspace(); t.after(workspace.cleanup);
  const source = await createRepositoryService({ projectRoot: workspace.root, csrfToken: "csrf" }).bootstrap();
  const store = createDraftStore(source), projectIndex = store.getState().projects.findIndex(record => record.document.sections.some(section => section.blocks.some(value => value.type === "image"))), project = store.getState().projects[projectIndex];
  const sectionIndex = project.document.sections.findIndex(section => section.blocks.some(value => value.type === "image")), originalIndex = project.document.sections[sectionIndex].blocks.findIndex(value => value.type === "image"), original = project.document.sections[sectionIndex].blocks[originalIndex];
  store.dispatch({ type: "item/copy", path: ["projects", projectIndex, "document", "sections", sectionIndex, "blocks"], id: original.id });
  const copiedIndex = originalIndex + 1, copied = store.getState().projects[projectIndex].document.sections[sectionIndex].blocks[copiedIndex];
  const imageSession = createImageSession({ csrfToken: "csrf", sessionId: "e".repeat(32), fetchImpl: async () => ({ ok: true, json: async () => ({ uploadId: "f".repeat(32), width: 2, height: 2, safeName: "migrated-12345678.png" }) }), urlApi: { createObjectURL: () => "blob:migrated", revokeObjectURL: () => {} } });
  await imageControls.applyProjectImageImport({ file: new File([Buffer.from([1])], "migrated.png"), key: copied.id, projectSlug: project.slug, path: ["projects", projectIndex, "document", "sections", sectionIndex, "blocks", copiedIndex], alt: "Uploaded", caption: "", store, imageSession });
  store.dispatch({ type: "project/change-slug", slug: project.slug, candidate: "renamed-project" });
  imageControls.confirmProjectSlugChange({ store, imageSession, slug: project.slug });
  const adapter = { sessionId: imageSession.uploads[0].sessionId, uploads: imageSession.uploads, resolveCanonical: () => true, resolveUpload: () => true }, candidate = toCandidateBundle(store.getState(), adapter);
  assert.deepEqual(candidate.images.map(value => value.destination).filter(value => value.startsWith('projects/renamed-project/')).sort(), ["projects/renamed-project/images/migrated-12345678.png", `projects/renamed-project/images/${original.markdown.match(/images\/([^)]+)/)[1]}`, `projects/renamed-project/images/${project.document.sections[sectionIndex].blocks.filter(value=>value.type==='image')[1].markdown.match(/images\/([^)]+)/)[1]}`].sort());
  assert.equal(candidate.images.some(value => value.destination.includes(`projects/${project.slug}/`)), false);
});

test("slug upload migration collision and store failure preserve pending draft and old destinations", async () => {
  let sequence=0;const imageSession=createImageSession({csrfToken:"csrf",sessionId:"1".repeat(32),fetchImpl:async()=>({ok:true,json:async()=>({uploadId:String(++sequence).repeat(32),width:1,height:1,safeName:"same-12345678.png"})}),urlApi:{createObjectURL:()=>`blob:${sequence}`,revokeObjectURL:()=>{}}}),file=new File([Buffer.from([1])],"same.png");
  await imageSession.upload(file,{key:"old",destinationPrefix:"projects/project-one/images"});await imageSession.upload(file,{key:"new",destinationPrefix:"projects/renamed-project/images"});const before=imageSession.uploads;
  const state={pendingSlugChange:{slug:"project-one",candidate:"renamed-project"}},store={getState:()=>structuredClone(state),dispatch:()=>{throw new Error("unreachable dispatch");}};
  assert.throws(()=>imageControls.confirmProjectSlugChange({store,imageSession,slug:"project-one"}),/重复/);assert.deepEqual(imageSession.uploads,before);assert.deepEqual(store.getState(),state);
  let committed=false;const failingStore={getState:()=>({pendingSlugChange:{slug:"project-one",candidate:"other-project"}}),dispatch:()=>{throw new Error("store rejected");}},migrationSession={migrateProject:()=>({commit:()=>{committed=true;}})};
  assert.throws(()=>imageControls.confirmProjectSlugChange({store:failingStore,imageSession:migrationSession,slug:"project-one"}),/store rejected/);assert.equal(committed,false);
});
