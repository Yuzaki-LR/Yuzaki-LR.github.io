import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { access, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import os from "node:os";
import { startEditor } from "../server/app.mjs";
import { createImageSession, applyProjectImageImport } from "../client/image-controls.mjs";
import { createRepositoryService } from "../server/repository-service.mjs";
import { createTestWorkspace } from "../../test/helpers.mjs";

async function treeHash(root) {
  const hash = createHash("sha256");
  async function walk(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      const target = path.join(directory, entry.name);
      hash.update(path.relative(root, target));
      if (entry.isDirectory()) await walk(target);
      else hash.update(await readFile(target));
    }
  }
  await walk(root);
  return hash.digest("hex");
}

async function request(
  origin,
  target,
  { method = "GET", headers = {}, body } = {},
) {
  const url = new URL(target, origin);
  return new Promise((resolve, reject) => {
    const value = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers,
        setHost: Object.keys(headers).some(
          (name) => name.toLowerCase() === "host",
        ),
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            body: Buffer.concat(chunks),
            headers: response.headers,
          }),
        );
      },
    );
    value.on("error", reject);
    if (body) value.write(body);
    value.end();
  });
}

async function rawHeaderRequest(origin, target, { method="POST", headers, body }) {
  const url = new URL(target, origin);
  return new Promise((resolve, reject) => {
    const value = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: target,
        method,
        headers,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            body: Buffer.concat(chunks),
            headers: response.headers,
          }),
        );
      },
    );
    value.on("error", reject);
    value.end(body);
  });
}

async function rawSocketExchange(origin, bytes, timeoutMs=1000) {
  const url=new URL(origin),socket=net.createConnection({host:url.hostname,port:Number(url.port)}),chunks=[];
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.destroy();reject(new Error('raw socket timeout'));},timeoutMs);socket.on('data',chunk=>chunks.push(chunk));socket.once('error',error=>{clearTimeout(timer);reject(error);});socket.once('close',()=>{clearTimeout(timer);resolve(Buffer.concat(chunks).toString('latin1'));});socket.once('connect',()=>socket.end(bytes));});
}

async function session(t) {
  const repositoryService = {
    bootstrap: async () => ({ csrfToken: "csrf-A" }),
  };
  const editor = await startEditor({
    projectRoot: process.cwd(),
    token: "startup-A",
    csrfToken: "csrf-A",
    repositoryService,
  });
  t.after(editor.close);
  const authority = new URL(editor.origin).host;
  const boot = await request(editor.origin, "/?session=startup-A", {
    headers: { Host: authority },
  });
  return {
    editor,
    authority,
    cookie: boot.headers["set-cookie"][0].split(";")[0],
  };
}
async function browserSession(t) {
  const workspace = await createTestWorkspace();
  const repositoryService = createRepositoryService({
    projectRoot: workspace.root,
    csrfToken: "csrf-A",
  });
  const editor = await startEditor({
    projectRoot: workspace.root,
    token: "startup-A",
    csrfToken: "csrf-A",
    repositoryService,
  });
  t.after(async () => {
    await editor.close();
    await workspace.cleanup();
  });
  const authority = new URL(editor.origin).host;
  const boot = await request(editor.origin, "/?session=startup-A", {
    headers: { Host: authority },
  });
  return {
    editor,
    workspace,
    authority,
    cookie: boot.headers["set-cookie"][0].split(";")[0],
  };
}
function validHeaders({ editor, authority, cookie }, body, name = "photo.png") {
  return {
    Host: authority,
    Origin: editor.origin,
    Cookie: cookie,
    "X-Editor-CSRF": "csrf-A",
    "Content-Type": "application/octet-stream",
    "Content-Length": String(body.length),
    "X-Editor-Content-Length": String(body.length),
    "X-Editor-Filename": name,
  };
}

test("authenticated state request streams one image into session memory", async (t) => {
  const { editor, authority, cookie } = await session(t),
    body = await readFile(new URL("./fixtures/metadata.png", import.meta.url));
  const response = await request(editor.origin, "/api/uploads", {
    method: "POST",
    body,
    headers: {
      Host: authority,
      Origin: editor.origin,
      Cookie: cookie,
      "X-Editor-CSRF": "csrf-A",
      "Content-Type": "application/octet-stream",
      "Content-Length": String(body.length),
      "X-Editor-Content-Length": String(body.length),
      "X-Editor-Filename": "Portrait%20photo.png",
    },
  });
  assert.equal(response.status, 201, response.body.toString());
  const value = JSON.parse(response.body);
  assert.match(value.uploadId, /^[a-f0-9]{32}$/);
  assert.equal(value.width, 2);
  assert.equal(value.height, 2);
  assert.match(value.safeName, /^[a-z0-9][a-z0-9_-]*(?:-[a-f0-9]{8})?\.png$/);
  assert.deepEqual(Object.keys(value).sort(), [
    "height",
    "safeName",
    "uploadId",
    "width",
  ]);
});

test("upload security and representation headers fail before storage", async (t) => {
  const value = await session(t),
    body = await readFile(new URL("./fixtures/metadata.png", import.meta.url)),
    base = validHeaders(value, body);
  const variants = [
    {},
    { ...base, Cookie: "editor_session=wrong" },
    { ...base, Host: "evil.invalid" },
    { ...base, Origin: `${value.editor.origin}.evil` },
    { ...base, "X-Editor-CSRF": "wrong" },
    { ...base, "Content-Type": "image/png" },
    { ...base, "Content-Length": undefined },
    { ...base, "X-Editor-Content-Length": undefined },
    { ...base, "X-Editor-Content-Length": "01" },
    { ...base, "X-Editor-Content-Length": String(body.length+1) },
    { ...base, "X-Editor-Filename": undefined },
    { ...base, "X-Editor-Filename": "../photo.png" },
  ];
  for (const headers of variants) {
    for (const key of Object.keys(headers))
      if (headers[key] === undefined) delete headers[key];
    const response = await request(value.editor.origin, "/api/uploads", {
      method: "POST",
      headers,
      body,
    });
    assert.notEqual(response.status, 201);
    assert.equal(value.editor.uploadStore.size, 0);
    assert.equal(response.headers["access-control-allow-origin"], undefined);
  }
});
test("duplicate representation headers and limits fail before decoder or store mutation", async (t) => {
  let decodes=0,begins=0;
  const uploadStore={
      sessionId:"e".repeat(32),size:0,maxFileBytes:200*1024*1024,
      beginDecode:()=>{begins+=1;throw new Error("unreachable store");},
      add:()=>{throw new Error("unreachable add");},close:()=>{},
    },
    imageDecoder=async()=>{decodes+=1;throw new Error("unreachable decoder");},
    repositoryService={bootstrap:async()=>({csrfToken:"csrf-A"})},
    editor=await startEditor({projectRoot:process.cwd(),token:"startup-A",csrfToken:"csrf-A",repositoryService,uploadStore,imageDecoder});
  t.after(editor.close);
  const authority=new URL(editor.origin).host,
    boot=await request(editor.origin,"/?session=startup-A",{headers:{Host:authority}}),
    cookie=boot.headers["set-cookie"][0].split(";")[0],
    body=await readFile(new URL("./fixtures/metadata.png",import.meta.url)),
    common=["Host",authority,"Origin",editor.origin,"Cookie",cookie,"X-Editor-CSRF","csrf-A","Content-Type","application/octet-stream","Content-Length",String(body.length),"X-Editor-Content-Length",String(body.length),"X-Editor-Filename","photo.png"];
  for(const [name,value] of [["Content-Type","application/octet-stream"],["X-Editor-Content-Length",String(body.length)],["X-Editor-Filename","other.png"]]){
    const response=await rawHeaderRequest(editor.origin,"/api/uploads",{headers:[...common,name,value],body});
    assert.equal(response.status,400);
  }
  const overValue=String(200*1024*1024+1),overHeaders=[...common];for(const name of ["Content-Length","X-Editor-Content-Length"]){const index=overHeaders.indexOf(name);overHeaders[index+1]=overValue;}const overLimit=await rawHeaderRequest(editor.origin,"/api/uploads",{headers:overHeaders,body});
  assert.equal(overLimit.status,400);
  assert.equal(begins,0);
  assert.equal(decodes,0);
  assert.equal(uploadStore.size,0);
});

test("decoder failures expose only the public error allowlist", async (t) => {
  const secretPath=["root","private","image.png"].join("/"),token="token-secret",raw="raw-byte-sentinel",env="env-secret";
  let decodes=0;
  const imageDecoder=async()=>{decodes+=1;const error=Object.assign(new Error(`decoder ${secretPath} ${token} ${raw} ${env}`),{code:"BAD_INPUT",field:"image",details:{reason:"invalid",stack:"private-stack",secretPath,token,raw,env}});error.stack+=`\n${secretPath}`;throw error;};
  const repositoryService={bootstrap:async()=>({csrfToken:"csrf-A"})},editor=await startEditor({projectRoot:process.cwd(),token:"startup-A",csrfToken:"csrf-A",repositoryService,imageDecoder});
  t.after(editor.close);
  const authority=new URL(editor.origin).host,boot=await request(editor.origin,"/?session=startup-A",{headers:{Host:authority}}),cookie=boot.headers["set-cookie"][0].split(";")[0],body=await readFile(new URL("./fixtures/metadata.png",import.meta.url)),response=await request(editor.origin,"/api/uploads",{method:"POST",headers:{Host:authority,Origin:editor.origin,Cookie:cookie,"X-Editor-CSRF":"csrf-A","Content-Type":"application/octet-stream","Content-Length":String(body.length),"X-Editor-Content-Length":String(body.length),"X-Editor-Filename":"photo.png"},body});
  assert.equal(response.status,400);
  assert.equal(decodes,1);
  const publicError=JSON.parse(response.body);
  assert.deepEqual(Object.keys(publicError).sort(),["code","details","field","messageZh","ok"]);
  assert.deepEqual(publicError,{ok:false,code:"BAD_INPUT",messageZh:"请求无效",field:"image",details:{reason:"invalid"}});
  for(const sentinel of [secretPath,token,raw,env,"private-stack"])assert.doesNotMatch(response.body.toString(),new RegExp(sentinel.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
});
test("upload store enforces file session count concurrency and cross-session identity", async () => {
  const { createUploadStore } = await import("../server/upload-store.mjs"),
    image = {
      bytes: Buffer.from([1, 2]),
      width: 1,
      height: 1,
      safeName: "a-12345678.png",
      sha256: "a".repeat(64),
      mime: "image/png",
    },
    store = createUploadStore({
      maxFileBytes: 4,
      maxSessionBytes: 4,
      maxUploadCount: 1,
      maxConcurrentDecodes: 1,
      sessionId: "session-A",
    });
  const release = store.beginDecode(2);
  assert.throws(() => store.beginDecode(1), /处理/);
  release();
  const saved = store.add(image);
  assert.equal(
    store
      .resolveUpload({ uploadId: saved.uploadId, sessionId: "session-A" })
      .bytes.equals(image.bytes),
    true,
  );
  assert.equal(
    store.resolveUpload({ uploadId: saved.uploadId, sessionId: "session-B" }),
    false,
  );
  assert.throws(() => store.beginDecode(1), /数量/);
  store.close();
  assert.equal(store.size, 0);
});
test("a true socket stream truncated below declared length is bounded and never stored", async (t) => {
  const value = await session(t),
    url = new URL(value.editor.origin),
    body = await readFile(new URL("./fixtures/metadata.png", import.meta.url)),
    socket = net.createConnection({
      host: url.hostname,
      port: Number(url.port),
    });
  t.after(() => socket.destroy());
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const head = [
    `POST /api/uploads HTTP/1.1`,
    `Host: ${value.authority}`,
    `Origin: ${value.editor.origin}`,
    `Cookie: ${value.cookie}`,
    `X-Editor-CSRF: csrf-A`,
    `Content-Type: application/octet-stream`,
    `Content-Length: ${body.length + 1}`,
    `X-Editor-Content-Length: ${body.length + 1}`,
    `X-Editor-Filename: photo.png`,
    "Connection: close",
    "",
    "",
  ].join("\r\n");
  socket.write(Buffer.concat([Buffer.from(head), body]), () =>
    socket.destroy(),
  );
  await Promise.race([
    new Promise((resolve) => socket.once("close", resolve)),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("socket close timeout")), 1000),
    ),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(value.editor.uploadStore.size, 0);
});

test("application upload length must equal HTTP framing before decode or commit", async (t) => {
  let decodes=0;
  const {createUploadStore}=await import('../server/upload-store.mjs');
  const uploadStore=createUploadStore({maxFileBytes:1024,maxSessionBytes:1024,sessionId:'9'.repeat(32)}),repositoryService={bootstrap:async()=>({csrfToken:'csrf-A'})};
  const editor=await startEditor({projectRoot:process.cwd(),token:'startup-A',csrfToken:'csrf-A',repositoryService,uploadStore,imageDecoder:async()=>{decodes+=1;return{bytes:Buffer.from([1]),width:1,height:1,mime:'image/png',safeName:'safe-12345678.png',sha256:'a'.repeat(64)}}});t.after(editor.close);
  const authority=new URL(editor.origin).host,boot=await request(editor.origin,'/?session=startup-A',{headers:{Host:authority}}),cookie=boot.headers['set-cookie'][0].split(';')[0],body=Buffer.from([1,2]),extra=Buffer.from([3]);
  const head=[`POST /api/uploads HTTP/1.1`,`Host: ${authority}`,`Origin: ${editor.origin}`,`Cookie: ${cookie}`,`X-Editor-CSRF: csrf-A`,`Content-Type: application/octet-stream`,`Content-Length: ${body.length+extra.length}`,`X-Editor-Content-Length: ${body.length}`,`X-Editor-Filename: photo.png`,`Connection: close`,'',''].join('\r\n');
  const raw=await rawSocketExchange(editor.origin,Buffer.concat([Buffer.from(head),body,extra]));
  assert.doesNotMatch(raw,/HTTP\/1\.1 2\d\d/);assert.equal(decodes,0);assert.equal(uploadStore.size,0);assert.equal(uploadStore.totalBytes,0);
});

test("upload POST query case and encoded aliases fail before reservation or decode",async(t)=>{let begins=0,decodes=0,adds=0;const uploadStore={sessionId:"a".repeat(32),maxFileBytes:10,maxPixels:10,beginDecode:()=>{begins+=1;return()=>{}},add:()=>{adds+=1;throw new Error("unreachable")},remove:()=>false,close:()=>{}},repositoryService={bootstrap:async()=>({csrfToken:"csrf-A"})},editor=await startEditor({projectRoot:process.cwd(),token:"startup-A",csrfToken:"csrf-A",repositoryService,uploadStore,imageDecoder:async()=>{decodes+=1;throw new Error("unreachable")}});t.after(editor.close);const authority=new URL(editor.origin).host,boot=await request(editor.origin,"/?session=startup-A",{headers:{Host:authority}}),cookie=boot.headers["set-cookie"][0].split(";")[0],body=Buffer.from([1]),headers={Host:authority,Origin:editor.origin,Cookie:cookie,"X-Editor-CSRF":"csrf-A","Content-Type":"application/octet-stream","Content-Length":"1","X-Editor-Content-Length":"1","X-Editor-Filename":"photo.png"};const alias=await request(editor.origin,"/api/uploads?alias=1",{method:"POST",headers,body});assert.equal(alias.status,404);for(const target of ["/API/uploads","/api/%75ploads"]){const response=await request(editor.origin,target,{method:"POST",headers,body});assert.notEqual(response.status,201);}assert.equal(begins,0);assert.equal(decodes,0);assert.equal(adds,0);assert.equal(uploadStore.size??0,0);});

test("upload delete is exact authenticated same-origin state and session scoped", async (t) => {
  const first=await session(t),second=await session(t),body=await readFile(new URL("./fixtures/metadata.png",import.meta.url));
  const uploaded=await request(first.editor.origin,"/api/uploads",{method:"POST",headers:validHeaders(first,body),body});assert.equal(uploaded.status,201);const uploadId=JSON.parse(uploaded.body).uploadId;
  const valid={Host:first.authority,Origin:first.editor.origin,Cookie:first.cookie,"X-Editor-CSRF":"csrf-A"};
  for(const [target,headers,method] of [[`/api/uploads/${uploadId}`,{},"DELETE"],[`/api/uploads/${uploadId}`,{...valid,"X-Editor-CSRF":"wrong"},"DELETE"],[`/api/uploads/${uploadId}x`,valid,"DELETE"],[`/api/uploads/${uploadId}?extra=1`,valid,"DELETE"],[`/api/uploads/${uploadId}`,valid,"GET"]]){const response=await request(first.editor.origin,target,{method,headers});assert.notEqual(response.status,204);assert.equal(first.editor.uploadStore.size,1);}
  const cross={Host:second.authority,Origin:second.editor.origin,Cookie:second.cookie,"X-Editor-CSRF":"csrf-A"},crossDelete=await request(second.editor.origin,`/api/uploads/${uploadId}`,{method:"DELETE",headers:cross});assert.equal(crossDelete.status,404);assert.equal(first.editor.uploadStore.size,1);
  const duplicate=await rawHeaderRequest(first.editor.origin,`/api/uploads/${uploadId}`,{method:"DELETE",headers:["Host",first.authority,"Origin",first.editor.origin,"Cookie",first.cookie,"X-Editor-CSRF","csrf-A","X-Editor-CSRF","csrf-A"]});assert.notEqual(duplicate.status,204);assert.equal(first.editor.uploadStore.size,1);
  const deleted=await request(first.editor.origin,`/api/uploads/${uploadId}`,{method:"DELETE",headers:valid});assert.equal(deleted.status,204);assert.equal(deleted.body.length,0);assert.equal(first.editor.uploadStore.size,0);
});

test("rejected draft replacement deletes only the staged server upload", async (t) => {
  const value=await session(t),body=await readFile(new URL("./fixtures/metadata.png",import.meta.url));
  const fetchImpl=(target,options)=>fetch(new URL(target,value.editor.origin),{...options,headers:{...options.headers,Host:value.authority,Origin:value.editor.origin,Cookie:value.cookie}});
  const discardImpl=uploadId=>fetchImpl(`/api/uploads/${uploadId}`,{method:"DELETE",credentials:"same-origin",headers:{"X-Editor-CSRF":"csrf-A"}});
  const revoked=[],imageSession=createImageSession({csrfToken:"csrf-A",sessionId:value.editor.uploadStore.sessionId,fetchImpl,discardImpl,urlApi:{createObjectURL:()=>`blob:${revoked.length}`,revokeObjectURL:url=>revoked.push(url)}}),file=new File([body],"photo.png",{type:"image/png"});
  await imageSession.upload(file,{key:"block",destinationPrefix:"projects/project-one/images"});const oldUploads=imageSession.uploads,oldPreview=imageSession.getPreview("block");assert.equal(value.editor.uploadStore.size,1);
  await assert.rejects(applyProjectImageImport({file,key:"block",projectSlug:"project-one",path:["projects",0,"document","sections",0,"blocks",0],alt:"Plot",caption:"Caption",store:{dispatch:()=>{throw new Error("draft rejected")}},imageSession}),/draft rejected/);
  assert.equal(value.editor.uploadStore.size,1);assert.deepEqual(imageSession.uploads,oldUploads);assert.equal(imageSession.getPreview("block"),oldPreview);assert.deepEqual(revoked,["blob:0"]);
  const {applyAvatarImageImport}=await import("../client/image-controls.mjs");await assert.rejects(applyAvatarImageImport({file,alt:"Portrait",store:{dispatch:()=>{throw new Error("avatar rejected")}},imageSession}),/avatar rejected/);assert.equal(value.editor.uploadStore.size,1);assert.deepEqual(imageSession.uploads,oldUploads);assert.equal(imageSession.getPreview("block"),oldPreview);assert.deepEqual(revoked,["blob:0","blob:1"]);
});

test("successful replacement remove avatar leave and close reclaim server uploads",async(t)=>{const value=await session(t),body=await readFile(new URL("./fixtures/metadata.png",import.meta.url)),fetchImpl=(target,options)=>fetch(new URL(target,value.editor.origin),{...options,headers:{...options.headers,Host:value.authority,Origin:value.editor.origin,Cookie:value.cookie}}),sessionImages=createImageSession({csrfToken:"csrf-A",sessionId:value.editor.uploadStore.sessionId,fetchImpl,urlApi:{createObjectURL:()=>"blob:preview",revokeObjectURL:()=>{}}}),file=new File([body],"photo.png");await sessionImages.upload(file,{key:"block",destinationPrefix:"projects/project-one/images"});assert.equal(value.editor.uploadStore.size,1);await sessionImages.upload(file,{key:"block",destinationPrefix:"projects/project-one/images"});assert.equal(value.editor.uploadStore.size,1);await sessionImages.remove("block");assert.equal(value.editor.uploadStore.size,0);await sessionImages.upload(file,{key:"avatar",destinationPrefix:"site-images"});assert.equal(value.editor.uploadStore.size,1);await sessionImages.remove("avatar");assert.equal(value.editor.uploadStore.size,0);await sessionImages.upload(file,{key:"remaining",destinationPrefix:"site-images"});assert.equal(value.editor.uploadStore.size,1);await sessionImages.close();assert.equal(value.editor.uploadStore.size,0);});

test("valid framed upload closes its connection and delayed tail cannot become a second request",async(t)=>{const value=await session(t),url=new URL(value.editor.origin),body=await readFile(new URL("./fixtures/metadata.png",import.meta.url)),head=["POST /api/uploads HTTP/1.1",`Host: ${value.authority}`,`Origin: ${value.editor.origin}`,`Cookie: ${value.cookie}`,"X-Editor-CSRF: csrf-A","Content-Type: application/octet-stream",`Content-Length: ${body.length}`,`X-Editor-Content-Length: ${body.length}`,"X-Editor-Filename: photo.png","",""].join("\r\n"),socket=net.createConnection({host:url.hostname,port:Number(url.port)}),chunks=[];let tailSent=false;t.after(()=>socket.destroy());await new Promise((resolve,reject)=>{socket.once("connect",resolve);socket.once("error",reject)});socket.on("error",()=>{});socket.on("data",chunk=>{chunks.push(chunk);if(!tailSent){tailSent=true;socket.write(`GET /api/health HTTP/1.1\r\nHost: ${value.authority}\r\n\r\n`);}});socket.write(Buffer.concat([Buffer.from(head),body]));await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("response close timeout")),1000);socket.once("close",()=>{clearTimeout(timer);resolve()})});const first=Buffer.concat(chunks).toString("latin1");assert.equal(tailSent,true);assert.equal((first.match(/HTTP\/1\.1/g)??[]).length,1);assert.match(first,/HTTP\/1\.1 201/);assert.match(first,/Connection: close/i);assert.equal(value.editor.uploadStore.size,1);assert.equal(socket.destroyed,true);});

test("Unicode filename transport is canonical and unsafe decoded names fail before reservation or decode", async (t) => {
  let begins=0,decodes=0,adds=0;
  const uploadStore={sessionId:'8'.repeat(32),maxFileBytes:100,maxPixels:100,beginDecode:()=>{begins+=1;return()=>{};},add:()=>{adds+=1;return{uploadId:'7'.repeat(32),width:1,height:1,safeName:'name-12345678.png'};},remove:()=>false,close:()=>{},get size(){return adds;}},repositoryService={bootstrap:async()=>({csrfToken:'csrf-A'})};
  const editor=await startEditor({projectRoot:process.cwd(),token:'startup-A',csrfToken:'csrf-A',repositoryService,uploadStore,imageDecoder:async({originalName})=>{decodes+=1;return{bytes:Buffer.from([1]),width:1,height:1,mime:'image/png',safeName:`${originalName.replace(/[^a-z]+/gi,'-').replace(/^-|-$/g,'')||'image'}-12345678.png`,sha256:'a'.repeat(64)}}});t.after(editor.close);
  const authority=new URL(editor.origin).host,boot=await request(editor.origin,'/?session=startup-A',{headers:{Host:authority}}),cookie=boot.headers['set-cookie'][0].split(';')[0],body=Buffer.from([1]),headers={Host:authority,Origin:editor.origin,Cookie:cookie,'X-Editor-CSRF':'csrf-A','Content-Type':'application/octet-stream','Content-Length':'1','X-Editor-Content-Length':'1'};
  const validName='中文 照片.png',valid=await request(editor.origin,'/api/uploads',{method:'POST',headers:{...headers,'X-Editor-Filename':encodeURIComponent(validName)},body});assert.equal(valid.status,201);assert.equal(decodes,1);
  const percent=String.fromCharCode(37),unsafe=[["folder","image.png"].join('/'),["C:","folder","image.png"].join('\\'),["file:","","folder","image.png"].join('/'),["..","image.png"].join('/')].map(encodeURIComponent),malformed=[`${percent}E0${percent}A4${percent}A`,`${percent}252e${percent}252e.png`];
  for(const transport of [...unsafe,...malformed]){const response=await request(editor.origin,'/api/uploads',{method:'POST',headers:{...headers,'X-Editor-Filename':transport},body});assert.equal(response.status,400);}
  assert.equal(begins,1);assert.equal(decodes,1);assert.equal(adds,1);
});

test("sanitized output schema and actual quotas are enforced atomically", async () => {
  const {createUploadStore}=await import('../server/upload-store.mjs'),store=createUploadStore({maxFileBytes:4,maxSessionBytes:8,maxUploadCount:1,maxPixels:4,sessionId:'6'.repeat(32)}),valid={bytes:Buffer.from([1]),width:1,height:1,mime:'image/png',safeName:'safe-12345678.png',sha256:'a'.repeat(64)};
  for(const image of [{...valid,bytes:Buffer.alloc(5)},{...valid,width:5},{...valid,mime:'image/jpeg'},{...valid,safeName:'unsafe.png'},{...valid,sha256:'bad'},{...valid,extra:true}]){assert.throws(()=>store.add(image),/图片|限制|无效/);assert.equal(store.size,0);assert.equal(store.totalBytes,0);}
  store.add({...valid,bytes:Buffer.alloc(4)});assert.equal(store.size,1);assert.equal(store.totalBytes,4);
});

test("upload route passes store pixel limit to decoder and rejects expanded output", async (t) => {
  const {createUploadStore}=await import('../server/upload-store.mjs'),uploadStore=createUploadStore({maxFileBytes:2,maxSessionBytes:2,maxPixels:3,sessionId:'5'.repeat(32)});let receivedPixels;
  const repositoryService={bootstrap:async()=>({csrfToken:'csrf-A'})};
  const editor=await startEditor({projectRoot:process.cwd(),token:'startup-A',csrfToken:'csrf-A',repositoryService,uploadStore,imageDecoder:async({maxPixels})=>{receivedPixels=maxPixels;return{bytes:Buffer.alloc(3),width:1,height:1,mime:'image/png',safeName:'safe-12345678.png',sha256:'a'.repeat(64)}}});t.after(editor.close);
  const authority=new URL(editor.origin).host,boot=await request(editor.origin,'/?session=startup-A',{headers:{Host:authority}}),cookie=boot.headers['set-cookie'][0].split(';')[0],response=await request(editor.origin,'/api/uploads',{method:'POST',headers:{Host:authority,Origin:editor.origin,Cookie:cookie,'X-Editor-CSRF':'csrf-A','Content-Type':'application/octet-stream','Content-Length':'1','X-Editor-Content-Length':'1','X-Editor-Filename':'photo.png'},body:Buffer.from([1])});
  assert.equal(receivedPixels,3);assert.equal(response.status,400);assert.equal(uploadStore.size,0);assert.equal(uploadStore.totalBytes,0);
});

const windowsPath = (...segments) => ["C:", ...segments].join("\\");
async function browserExecutable() {
  for (const candidate of [
    process.env.EDITOR_TEST_BROWSER,
    windowsPath(
      "Program Files",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe",
    ),
    windowsPath(
      "Program Files (x86)",
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe",
    ),
  ]) {
    if (!candidate) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error("真实 Chromium 不可用");
}
async function waitFor(read, timeout = 8000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      return await read();
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw last;
}
class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    socket.addEventListener("message", (event) => {
      const value = JSON.parse(event.data);
      if (!value.id) {
        this.events.push(value);
        return;
      }
      const pending = this.pending.get(value.id);
      this.pending.delete(value.id);
      value.error
        ? pending.reject(new Error(value.error.message))
        : pending.resolve(value.result);
    });
  }
  send(method, params = {}, timeoutMs = 8_000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP response timeout: ${method}`));},timeoutMs);
      this.pending.set(id, { resolve:value=>{clearTimeout(timer);resolve(value);}, reject:error=>{clearTimeout(timer);reject(error);} });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
}

test("CDP commands reject on bounded missing response",async()=>{const socket=new EventTarget();socket.send=()=>{};const cdp=new Cdp(socket);await assert.rejects(cdp.send("Runtime.evaluate",{},10),/CDP.*Runtime\.evaluate/);});

function waitForChildClose(child, timeoutMs, message) {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onClose = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      child.off("close", onClose);
      reject(new Error(message));
    }, timeoutMs);
    child.once("close", onClose);
  });
}

async function closeBrowserResources({
  cdp,
  child,
  socket,
  cleanup,
  timeoutMs = 2_000,
}) {
  try {
    const childClosed=waitForChildClose(child,timeoutMs,"浏览器进程未按时退出");
    try { await Promise.race([cdp?.send("Browser.close"),childClosed]); } catch {}
    try {
      await childClosed;
    } catch {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await waitForChildClose(
        child,
        timeoutMs,
        "浏览器进程在终止后仍未退出",
      );
    }
  } finally {
    socket?.close();
  }
  await cleanup();
}

test("browser cleanup waits for task-owned child close before removing its profile", async () => {
  const fakeChild = ({ closeOnBrowser = false, closeOnKill = false } = {}) => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    child.kill = () => {
      child.events.push("child.kill");
      if (closeOnKill)
        queueMicrotask(() => {
          child.exitCode = 0;
          child.events.push("child.close");
          child.emit("close", 0);
        });
      return true;
    };
    child.events = [];
    child.closeOnBrowser = closeOnBrowser;
    return child;
  };
  const run = async (child) => {
    const cdp = {
        send: async (method) => {
          child.events.push(method);
          if (child.closeOnBrowser)
            queueMicrotask(() => {
              child.exitCode = 0;
              child.events.push("child.close");
              child.emit("close", 0);
            });
        },
      },
      socket = { close: () => child.events.push("socket.close") },
      cleanup = async () => child.events.push("cleanup");
    await closeBrowserResources({ cdp, child, socket, cleanup, timeoutMs: 10 });
  };

  const graceful = fakeChild({ closeOnBrowser: true });
  await run(graceful);
  assert.deepEqual(graceful.events, [
    "Browser.close",
    "child.close",
    "socket.close",
    "cleanup",
  ]);

  const killed = fakeChild({ closeOnKill: true });
  await run(killed);
  assert.deepEqual(killed.events, [
    "Browser.close",
    "child.kill",
    "child.close",
    "socket.close",
    "cleanup",
  ]);

  const stalled = fakeChild();
  await assert.rejects(
    run(stalled),
    /浏览器进程在终止后仍未退出/,
  );
  assert.deepEqual(stalled.events, [
    "Browser.close",
    "child.kill",
    "socket.close",
  ]);

  const exitedWithoutReply=fakeChild(),cleanupEvents=[];await Promise.race([closeBrowserResources({child:exitedWithoutReply,cdp:{send:()=>{cleanupEvents.push("Browser.close");queueMicrotask(()=>{exitedWithoutReply.exitCode=0;cleanupEvents.push("child.close");exitedWithoutReply.emit("close",0)});return new Promise(()=>{});}},socket:{close:()=>cleanupEvents.push("socket.close")},cleanup:async()=>cleanupEvents.push("cleanup"),timeoutMs:10}),new Promise((_,reject)=>setTimeout(()=>reject(new Error("close helper outer deadline")),30))]);assert.deepEqual(cleanupEvents,["Browser.close","child.close","socket.close","cleanup"]);
});

test("real Chromium image controls upload preview replace remove and warn without disk writes", { timeout: 25_000 }, async (t) => {
  const value = await browserSession(t),
    beforeTree = await treeHash(value.workspace.root),
    profile = await mkdtemp(path.join(os.tmpdir(), "task9-browser-")),
    child = spawn(
      await browserExecutable(),
      [
        "--headless=new",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--disable-background-networking",
        "about:blank",
      ],
      { stdio: "ignore", windowsHide: true },
    );
  let cdp, socket;
  t.after(async () => {
    await closeBrowserResources({
      cdp,
      child,
      socket,
      cleanup: () => rm(profile, { recursive: true, force: true }),
    });
  });
  const active = path.join(profile, "DevToolsActivePort"),
    lines = await waitFor(async () => {
      const result = (await readFile(active, "utf8")).trim().split(/\r?\n/);
      if (result.length < 2) throw new Error("debug port");
      return result;
    }),
    pages = await fetch(`http://127.0.0.1:${lines[0]}/json/list`).then(
      (response) => response.json(),
    ),
    websocket = new WebSocket(
      pages.find((page) => page.type === "page").webSocketDebuggerUrl,
    );
  socket = websocket;
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  cdp = new Cdp(socket);
  await cdp.send("Page.enable");
  await cdp.send("Network.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.setCookie", {
    name: "editor_session",
    value: value.cookie.slice("editor_session=".length),
    url: value.editor.origin,
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
  });
  await cdp.send("Page.navigate", { url: value.editor.origin });
  await waitFor(async () => {
    const result = await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector('iframe')?.contentDocument?.querySelector('main')?.textContent`,
      returnByValue: true,
    });
    if (!result.result.value) throw new Error("app loading");
    return result;
  });
  const encoded = (
      await readFile(new URL("./fixtures/metadata.png", import.meta.url))
    ).toString("base64"),
    result = await cdp.send("Runtime.evaluate", {
      expression: `(async()=>{
        const poll=async(read,label)=>{const end=performance.now()+7000;let value;while(performance.now()<end){value=read();if(value)return value;await new Promise(requestAnimationFrame);}throw new Error('timeout:'+label);};
        const bytes=Uint8Array.from(atob('${encoded}'),character=>character.charCodeAt(0));
        const setFile=(input,name)=>{const transfer=new DataTransfer();transfer.items.add(new File([bytes],name,{type:'image/png'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));};
        document.querySelector('[data-route="/projects/"]').click();
        const firstInput=await poll(()=>document.querySelector('[data-project-record] [data-block-type="image"] .image-metadata input[type=file]'),'project input');
        const editorId=firstInput.closest('[data-editor-id]').dataset.editorId;
        const card=()=>document.querySelector('[data-editor-id="'+CSS.escape(editorId)+'"]');
        const projectState=()=>{const value=card(),preview=value?.querySelector('.local-image-preview'),source=value?.querySelector('.image-source')?.textContent??'';return value&&preview&&!preview.hidden&&preview.src.startsWith('blob:')&&source.includes('.png')?{value,preview,source}:null;};
        const english=()=>[...card().querySelectorAll('.editor-field span')].map(value=>value.textContent);
        const controls=()=>[...card().querySelectorAll('button')].map(value=>value.textContent.trim());
        setFile(firstInput,'first.png');
        const first=await poll(projectState,'first project upload'),firstUrl=first.preview.src,firstSource=first.source;
        setFile(first.value.querySelector('input[type=file]'),'second.png');
        const second=await poll(()=>{const state=projectState();return state&&state.preview.src!==firstUrl&&state.source!==firstSource?state:null;},'second project upload'),secondUrl=second.preview.src,secondSource=second.source;
        const oldRevoked=await fetch(firstUrl).then(()=>false,()=>true);
        const labels=english(),buttons=controls(),warning=second.value.querySelector('.privacy-warning')?.textContent??'';
        [...second.value.querySelectorAll('button')].find(button=>button.textContent.includes('移除'))?.click();
        await poll(()=>!card(),'project remove');
        const currentRevoked=await fetch(secondUrl).then(()=>false,()=>true);
        document.querySelector('[data-panel="appearance"]').click();
        const appearance=()=>document.querySelector('#inspector-fields'),avatarInput=await poll(()=>appearance().querySelector('.image-metadata input[type=file]'),'avatar input');
        const avatarState=()=>{const root=appearance(),preview=root.querySelector('.local-image-preview'),source=root.querySelector('.image-source')?.textContent??'',mode=root.querySelector('select')?.value,alt=root.querySelector('.image-metadata input[type=text]')?.value;return preview&&!preview.hidden&&preview.src.startsWith('blob:')&&source.includes('.png')&&mode==='image'?{preview,source,mode,alt}:null;};
        setFile(avatarInput,'avatar-first.png');
        const avatarFirst=await poll(avatarState,'first avatar upload'),avatarFirstUrl=avatarFirst.preview.src;
        const firstMode=appearance().querySelector('select');firstMode.value='initials';firstMode.dispatchEvent(new Event('change',{bubbles:true}));
        await poll(()=>appearance().querySelector('select')?.value==='initials'&&appearance().querySelector('.local-image-preview')?.hidden,'avatar initials');
        const avatarFirstRevoked=await fetch(avatarFirstUrl).then(()=>false,()=>true);
        const avatarSecondInput=appearance().querySelector('.image-metadata input[type=file]');setFile(avatarSecondInput,'avatar-second.png');
        const avatarSecond=await poll(avatarState,'second avatar upload'),avatarSecondUrl=avatarSecond.preview.src;
        const secondMode=appearance().querySelector('select');secondMode.value='hidden';secondMode.dispatchEvent(new Event('change',{bubbles:true}));
        await poll(()=>appearance().querySelector('select')?.value==='hidden'&&appearance().querySelector('.local-image-preview')?.hidden,'avatar hidden');
        const avatarSecondRevoked=await fetch(avatarSecondUrl).then(()=>false,()=>true);
        return{project:{firstSource,secondSource,replaced:firstUrl!==secondUrl,oldRevoked,currentRevoked,removed:!card(),warning,labels,buttons},avatar:{inputEnabled:!avatarInput.disabled,firstMode:avatarFirst.mode,firstSource:avatarFirst.source,firstAlt:avatarFirst.alt,firstRevoked:avatarFirstRevoked,secondRevoked:avatarSecondRevoked,finalMode:appearance().querySelector('select')?.value,hidden:appearance().querySelector('.local-image-preview')?.hidden,warning:appearance().querySelector('.privacy-warning')?.textContent??''}};
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text,
    );
  const browserResult=result.result.value;
  assert.equal(browserResult.project.replaced,true);assert.equal(browserResult.project.oldRevoked,true);assert.equal(browserResult.project.currentRevoked,true);assert.equal(browserResult.project.removed,true);assert.notEqual(browserResult.project.firstSource,browserResult.project.secondSource);for(const source of [browserResult.project.firstSource,browserResult.project.secondSource])assert.match(source,/^\.\/images\/[a-z0-9_-]+-[a-f0-9]{8}\.png$/);assert.ok(browserResult.project.labels.includes('English alt'));assert.ok(browserResult.project.labels.includes('English caption'));for(const label of ['隐藏','上移','下移'])assert.ok(browserResult.project.buttons.includes(label));assert.match(browserResult.project.warning,/Fig\.|report|报告|私密像素/);
  assert.deepEqual({inputEnabled:browserResult.avatar.inputEnabled,firstMode:browserResult.avatar.firstMode,firstAlt:browserResult.avatar.firstAlt,firstRevoked:browserResult.avatar.firstRevoked,secondRevoked:browserResult.avatar.secondRevoked,finalMode:browserResult.avatar.finalMode,hidden:browserResult.avatar.hidden},{inputEnabled:true,firstMode:'image',firstAlt:'Portrait',firstRevoked:true,secondRevoked:true,finalMode:'hidden',hidden:true});assert.match(browserResult.avatar.firstSource,/^\.\/site-images\/[a-z0-9_-]+-[a-f0-9]{8}\.png$/);assert.match(browserResult.avatar.warning,/Fig\.|report|报告|私密像素/);
  assert.equal(value.editor.uploadStore.size,0);
  const uploadRequests=cdp.events.filter(event=>event.method==='Network.requestWillBeSent'&&event.params.request.url===`${value.editor.origin}/api/uploads`&&event.params.request.method==='POST'),uploadResponses=cdp.events.filter(event=>event.method==='Network.responseReceived'&&event.params.response.url===`${value.editor.origin}/api/uploads`&&event.params.response.status===201),deleteRequests=cdp.events.filter(event=>event.method==='Network.requestWillBeSent'&&/^\/api\/uploads\/[a-f0-9]{32}$/.test(new URL(event.params.request.url).pathname)&&event.params.request.method==='DELETE'),deleteResponses=cdp.events.filter(event=>event.method==='Network.responseReceived'&&/^\/api\/uploads\/[a-f0-9]{32}$/.test(new URL(event.params.response.url).pathname)&&event.params.response.status===204);assert.equal(uploadRequests.length,4);for(const request of uploadRequests)assert.equal(request.params.request.headers['X-Editor-Content-Length'],String(Buffer.from(encoded,'base64').length));assert.equal(uploadResponses.length,4);assert.equal(deleteRequests.length,4);assert.equal(deleteResponses.length,4);const httpRequests=cdp.events.filter(event=>event.method==='Network.requestWillBeSent'&&/^https?:/.test(event.params.request.url)).map(event=>event.params.request);assert.deepEqual([...new Set(httpRequests.map(request=>new URL(request.url).origin))],[value.editor.origin]);
  assert.deepEqual(cdp.events.filter(event=>event.method==='Runtime.exceptionThrown'),[]);assert.deepEqual(cdp.events.filter(event=>event.method==='Runtime.consoleAPICalled'&&event.params.type==='error'),[]);
  assert.equal(await treeHash(value.workspace.root),beforeTree);
});
