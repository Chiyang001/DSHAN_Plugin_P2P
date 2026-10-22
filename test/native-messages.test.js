import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNativeMessages, mirrorId } from '../native-messages.js';

test('native Session adapter uses cached selected journal and forwards model, prompt and upload to the owner', async () => {
  const calls = [], chat = { id: 'shared', owner: 'owner', members: ['here','owner'], sessionId: 'private-owner-id', title: 'Shared', updatedAt: 1, version: 'v1', events: [{seq:2,type:'user/message',data:{message:{content:[{type:'text',text:'history'}]}}}], nativeProjections: { values: { modelSelection: { next: {provider:'p',model:'m'} } } } };
  const controller = { async list() { return { items: [{ sessionId: 'private-local' }] }; }, async prompt() { return 'local'; }, async projections() { return 'local'; }, async selectModel() { return 'local'; }, async attachment() { return 'local'; }, async page() { return 'local'; }, async *follow() { yield 'local'; }, async modelCatalog() { return {groups:[]}; }, async *control(signal) { yield {type:'baseline',value:{projections:{}}}; await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true})); } };
  const original = controller.prompt, uploads = { async uploadStream(){return 'local';} };
  const linked = { data: { deviceId:'here',chats:{shared:chat} }, async init(){}, async action(input){calls.push(['prompt',input]);}, async nativeCall(item,method,request){calls.push([method,request]);return {accepted:true};} };
  const dispose = installNativeMessages({get:name=>name==='sessionController'?controller:uploads,emit(){}},linked);
  try {
    const id=mirrorId(chat);const list=await controller.list({});assert.equal(list.items.length,2);assert.equal(list.items[1].sessionId,id);
    assert.equal(await controller.prompt({sessionId:'private-local'}),'local');
    await controller.prompt({sessionId:id,requestId:'request',content:[{type:'image',data:'aQ==',mediaType:'image/png'},{type:'text',text:'hello'}]});
    assert.equal(calls[0][1].content.length,2);assert.equal(calls[0][1].id,'shared');
    await controller.selectModel({sessionId:id,provider:'p',model:'m',reasoningEffort:'high'});
    assert.equal(calls[1][0],'selectModel');assert.equal(calls[1][1].reasoningEffort,'high');
    const projection=await controller.projections({sessionId:id});assert.equal(projection.values.modelSelection.next.model,'m');
    const controlAbort=new AbortController(); const controls=controller.control(controlAbort.signal); const baseline=await controls.next(); assert.equal(baseline.value.value.projections[id].values.modelSelection.next.model,'m'); controlAbort.abort(); await controls.return();
    const abort=new AbortController();const source=controller.follow({address:{kind:'session',sessionId:id}},abort.signal);const first=await source.next();assert.equal(first.value.type,'snapshot');assert.equal(first.value.records[0].event.seq,0);abort.abort();await source.return();
    const streamAbort=new AbortController(), stream=controller.follow({address:{kind:'session',sessionId:id},assistantStream:true},streamAbort.signal); await stream.next(); chat.live='hello'; assert.equal((await stream.next()).value.frame.type,'start'); const one=(await stream.next()).value.frame; assert.equal(one.index,0); assert.equal(one.chunk.text,'hello'); chat.live='hello world';const two=(await stream.next()).value.frame;assert.equal(two.type,'chunk');assert.equal(two.index,1);assert.equal(two.chunk.text,' world'); chat.live='';const end=(await stream.next()).value.frame;assert.equal(end.type,'end');assert.equal(end.index,2);streamAbort.abort();await stream.return();
    await uploads.uploadStream({sessionId:id,name:'test.txt',data:(async function*(){yield Buffer.from('data');})()});assert.equal(calls[2][0],'upload');assert.equal(calls[2][1].data,'ZGF0YQ==');
    chat.removed=true;assert.equal((await controller.list({})).items.length,1);
  } finally {dispose();}
  assert.equal(controller.prompt,original);
});
