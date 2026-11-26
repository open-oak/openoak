import assert from 'node:assert/strict';
import test, {before,after} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createKanbanTestDatabase} from '../helpers/database.mjs';
import {initializeNewKanbanAccount,changeBoardSharing,getBoardSharing,previewBoardInvite,acceptBoardInvite} from '../../lib/kanban-sharing.ts';
import {applyKanbanOperation} from '../../lib/kanban-operations.ts';
import {listV2Boards,listV2Lists,listV2Cards,getV2Card,getV2Profile,readV2CardDetails,getV2Changes,searchModularKanban} from '../../lib/kanban-v2-reads.ts';
import {kanbanReadResponse,kanbanOperationResponse} from '../../lib/kanban-v2-http.ts';
let db,key,ownerBoard;
const operation=(type,fields={})=>({contractVersion:2,operationId:randomUUID(),epoch:1,boardKey:key,type,...fields});
before(async()=>{db=await createKanbanTestDatabase();await initializeNewKanbanAccount('owner',db.pool);await initializeNewKanbanAccount('outsider',db.pool);ownerBoard=(await listV2Boards('owner',{},db.pool)).items[0];key=ownerBoard.boardKey;});
after(async()=>{await db?.close();});
test('explicit joins initialize a new actor independently and preserve owner-only controls',async()=>{
 await changeBoardSharing('owner',key,'enable',undefined,db.pool);
 const sharing=await getBoardSharing('owner',key,db.pool);const token=sharing.invitePath.split('/').at(-1);
 assert.equal((await previewBoardInvite(token,db.pool)).boardKey,key);
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM "KanbanBoardMember"')).rows[0].n,0);
 await acceptBoardInvite('editor',token,db.pool);await acceptBoardInvite('editor',token,db.pool);
 assert.equal((await db.pool.query('SELECT count(*)::int n FROM "KanbanBoardMember"')).rows[0].n,1);
 const catalog=await listV2Boards('editor',{},db.pool);assert.equal(catalog.items.length,2);assert.equal(catalog.items.find(b=>b.boardKey===key).accessLevel,'editor');
 const concealed=await getBoardSharing('editor',key,db.pool);assert.equal(concealed.invitePath,null);assert.deepEqual(concealed.members,[]);
 for(const actor of ['editor','outsider'])await assert.rejects(changeBoardSharing(actor,key,'disable',undefined,db.pool),{code:'not_found'});
 await assert.rejects(applyKanbanOperation('editor',operation('board.delete',{expectedRevision:1}),db.pool),{code:'not_found'});
 const ownProfile=await getV2Profile('owner',db.pool);const memberProfile=await getV2Profile('editor',db.pool);
 await applyKanbanOperation('editor',operation('profile.selectBoard',{expectedProfileVersion:memberProfile.version}),db.pool);
 assert.equal((await getV2Profile('editor',db.pool)).activeBoardKey,key);assert.deepEqual(await getV2Profile('owner',db.pool),ownProfile);
});
test('members use one operation service across HTTP reads, content, ordering and safe retries',async()=>{
 // Owners and actors may have different migration epochs.
 await db.pool.query('UPDATE "KanbanTransition" SET "migrationEpoch"=3 WHERE "ownerId"=\'owner\'');
 const lists=(await listV2Lists('editor',{boardKey:key},db.pool)).items;
 const create=operation('card.create',{cardId:'shared-card',listId:lists[0].id,expectedOrderVersion:lists[0].orderVersion,title:'Shared item',description:'Complete shared notes'});
 const response=await kanbanOperationResponse('editor',new Request('http://localhost/api/kanban/v2/operations',{method:'POST',headers:{'content-type':'application/json',origin:'http://localhost'},body:JSON.stringify(create)}),db.pool);assert.equal(response.status,200);
 assert.equal((await applyKanbanOperation('editor',create,db.pool)).status,'duplicate');
 assert.equal((await db.pool.query('SELECT "ownerId" FROM "KanbanOperationReceipt" WHERE "actorId"=\'editor\' AND "operationId"=$1',[create.operationId])).rows[0].ownerId,'owner');
 assert.equal((await kanbanReadResponse('editor','card',new URLSearchParams({boardKey:key,id:'shared-card'}),db.pool)).status,200);
 assert.equal((await readV2CardDetails('editor',{boardKey:key},db.pool)).items[0].card.description,'Complete shared notes');
 assert.equal((await searchModularKanban('editor','Shared item',20,db.pool))[0].boardId,key);
 await applyKanbanOperation('owner',{...operation('card.update',{cardId:'shared-card',expectedContentVersion:1,changes:{description:'Owner change'}}),epoch:3},db.pool);
 await assert.rejects(applyKanbanOperation('editor',operation('card.update',{cardId:'shared-card',expectedContentVersion:1,changes:{title:'Stale'}}),db.pool),{code:'conflict'});
 const current=(await getV2Card('editor',{boardKey:key,id:'shared-card'},db.pool)).result.card;
 const updatedLists=(await listV2Lists('editor',{boardKey:key},db.pool)).items;
 await applyKanbanOperation('editor',operation('card.move',{cardId:'shared-card',sourceListId:lists[0].id,destinationListId:lists[1].id,index:0,expectedPlacementVersion:current.placementVersion,expectedOrderVersions:Object.fromEntries(updatedLists.slice(0,2).map(l=>[l.id,l.orderVersion]))}),db.pool);
 assert.equal((await getV2Card('owner',{boardKey:key,id:'shared-card'},db.pool)).result.card.description,'Owner change');
 assert.ok((await getV2Changes('editor',{boardKey:key,sinceRevision:1},db.pool)).items.length);
 for(const read of [()=>listV2Lists('outsider',{boardKey:key},db.pool),()=>listV2Cards('outsider',{boardKey:key},db.pool),()=>getV2Card('outsider',{boardKey:key,id:'shared-card'},db.pool)])await assert.rejects(read(),{code:'not_found'});
 // Keep a successful receipt for the post-removal authorization check.
 globalThis.memberCreate=create;
});
test('rotation, disable, removal and leave have distinct effects and reauthorize receipts',async()=>{
 const old=(await getBoardSharing('owner',key,db.pool)).invitePath.split('/').at(-1);
 await changeBoardSharing('owner',key,'rotate',undefined,db.pool);assert.equal(await previewBoardInvite(old,db.pool),null);
 await assert.rejects(acceptBoardInvite('outsider',old,db.pool),{code:'not_found'});
 const token=(await getBoardSharing('owner',key,db.pool)).invitePath.split('/').at(-1);
 await changeBoardSharing('owner',key,'disable',undefined,db.pool);assert.equal(await previewBoardInvite(token,db.pool),null);
 assert.equal((await getV2Card('editor',{boardKey:key,id:'shared-card'},db.pool)).result.kind,'card');
 await changeBoardSharing('owner',key,'remove','editor',db.pool);
 assert.equal((await listV2Boards('editor',{},db.pool)).items.some(b=>b.boardKey===key),false);
 assert.notEqual((await getV2Profile('editor',db.pool)).activeBoardKey,key);
 await assert.rejects(applyKanbanOperation('editor',globalThis.memberCreate,db.pool),{code:'not_found'});
 await assert.rejects(getV2Card('editor',{boardKey:key,id:'shared-card'},db.pool),{code:'not_found'});
 await changeBoardSharing('owner',key,'enable',undefined,db.pool);const next=(await getBoardSharing('owner',key,db.pool)).invitePath.split('/').at(-1);await acceptBoardInvite('editor',next,db.pool);
 await changeBoardSharing('editor',key,'leave',undefined,db.pool);assert.equal((await listV2Boards('editor',{},db.pool)).items.some(b=>b.boardKey===key),false);
 await assert.rejects(changeBoardSharing('owner',key,'leave',undefined,db.pool),{code:'invalid'});
});
test('existing legacy accounts are preserved; initialization is safe under racing requests',async()=>{
 await db.pool.query('INSERT INTO "KanbanDocument" ("userId","boards","activeBoardId") VALUES (\'legacy\',\'[]\',\'missing\')');
 assert.equal(await initializeNewKanbanAccount('legacy',db.pool),false);
 assert.equal((await db.pool.query('SELECT "boards" FROM "KanbanDocument" WHERE "userId"=\'legacy\'')).rows[0].boards.length,0);
 await Promise.all([initializeNewKanbanAccount('racing-new',db.pool),initializeNewKanbanAccount('racing-new',db.pool)]);
 assert.equal((await listV2Boards('racing-new',{},db.pool)).items.length,1);
});

test('revoked offline boards leave navigation and cache, retaining unsent work without retries', async () => {
 const {KanbanBrowserStore} = await import('../../lib/kanban-browser-store.ts');
 const {KanbanBrowserApi} = await import('../../lib/kanban-browser-api.ts');
 await changeBoardSharing('owner',key,'enable',undefined,db.pool);
 await acceptBoardInvite('offline-editor',(await getBoardSharing('owner',key,db.pool)).invitePath.split('/').at(-1),db.pool);
 const values=new Map();const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
 let offline=false,posts=0,view;
 const api=new KanbanBrowserApi(async(path,init)=>{
  if(offline)throw new TypeError('Offline');const url=new URL(path,'http://localhost');
  if(init?.method==='POST'){posts++;return kanbanOperationResponse('offline-editor',new Request(url,init),db.pool);}
  return kanbanReadResponse('offline-editor',url.pathname.split('/').at(-1),url.searchParams,db.pool);
 });
 let store=new KanbanBrowserStore(storage,'offline-editor',api,next=>view=next);await store.start(key);
 assert.equal(view.state.activeBoardId,key);
 // The account backup is owned-only; an explicit export can include this board.
 assert.equal((await store.exportBoards()).boards.length,1);
 assert.equal((await store.exportBoards(key)).boards[0].id,key);
 offline=true;store.dispatch({type:'updateTask',taskId:'shared-card',updates:{description:'Private unsent recovery draft'}});await store.sync();await store.stop();
 store=new KanbanBrowserStore(storage,'offline-editor',api,next=>view=next);await store.start();
 assert.match(store.recovery(),/Private unsent recovery draft/);
 await changeBoardSharing('owner',key,'remove','offline-editor',db.pool);offline=false;await store.sync();
 assert.equal(view.status,'synced',view.message);assert.equal(view.pending,0);assert.equal(view.recovered,1);
 assert.equal(view.state.boards.some(b=>b.id===key),false);
 const cached=JSON.parse(store.recovery());assert.equal(cached.loaded[key],undefined);assert.equal(cached.summaries.some(b=>b.boardKey===key),false);
 assert.match(JSON.stringify(cached.recovery),/Private unsent recovery draft/);
 await store.sync();await store.sync();assert.equal(posts,0);
 store.dispatch({type:'addTask',listId:'todo',id:'owned-after-revocation',title:'My own work continues'});await store.sync();assert.equal(view.pending,0);assert.equal(view.status,'synced');
 await store.stop();
});

test('an uncertain successful operation is reauthorized on retry after removal', async () => {
 const {KanbanBrowserStore}=await import('../../lib/kanban-browser-store.ts');const {KanbanBrowserApi}=await import('../../lib/kanban-browser-api.ts');
 await acceptBoardInvite('lost-editor',(await getBoardSharing('owner',key,db.pool)).invitePath.split('/').at(-1),db.pool);
 const values=new Map();let lose=true,view,posts=0;
 const api=new KanbanBrowserApi(async(path,init)=>{const url=new URL(path,'http://localhost');if(init?.method==='POST'){posts++;const response=await kanbanOperationResponse('lost-editor',new Request(url,init),db.pool);if(lose){lose=false;throw new TypeError('Lost reply');}return response;}return kanbanReadResponse('lost-editor',url.pathname.split('/').at(-1),url.searchParams,db.pool);});
 const store=new KanbanBrowserStore({getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},'lost-editor',api,next=>view=next);
 await store.start(key);store.dispatch({type:'updateTask',taskId:'shared-card',updates:{title:'Committed before removal'}});await store.sync();assert.equal(view.pending,1);
 await changeBoardSharing('owner',key,'remove','lost-editor',db.pool);await store.sync();assert.equal(view.pending,0);assert.equal(view.recovered,1);assert.equal(view.state.boards.some(b=>b.id===key),false);
 await store.sync();assert.equal(posts,2);await store.stop();
});

test('board locking serializes revocation with a pending write and invalidates join after rotation',async()=>{
 await acceptBoardInvite('racing-editor',(await getBoardSharing('owner',key,db.pool)).invitePath.split('/').at(-1),db.pool);
 const client=await db.pool.connect();
 try{
  await client.query('BEGIN');await client.query('SELECT 1 FROM "KanbanBoard" WHERE "boardKey"=$1 FOR UPDATE',[key]);
  const card=(await getV2Card('racing-editor',{boardKey:key,id:'shared-card'},db.pool)).result.card;
  const pending=applyKanbanOperation('racing-editor',operation('card.update',{cardId:'shared-card',expectedContentVersion:card.contentVersion,changes:{title:'Should never commit'}}),db.pool);
  const rejected=assert.rejects(pending,{code:'not_found'});
  await client.query('DELETE FROM "KanbanBoardMember" WHERE "boardKey"=$1 AND "userId"=\'racing-editor\'',[key]);await client.query('COMMIT');await rejected;
  assert.notEqual((await getV2Card('owner',{boardKey:key,id:'shared-card'},db.pool)).result.card.title,'Should never commit');
 }finally{await client.query('ROLLBACK');client.release();}
});

test('shared identities and invite tokens survive an owner rollback and re-cutover',async()=>{
 const {checkpointOwner,rollbackOwner,cutoverOwner,retireCompatibilityMirror}=await import('../../lib/kanban-migration.ts');
 const {reconcileRolledBackOwner}=await import('../../lib/kanban-legacy-bridge.ts');
 const token=(await getBoardSharing('owner',key,db.pool)).invitePath.split('/').at(-1);
 await acceptBoardInvite('recovery-editor',token,db.pool);
 await checkpointOwner(db.pool,'owner');await rollbackOwner(db.pool,'owner');
 await assert.rejects(getV2Card('recovery-editor',{boardKey:key,id:'shared-card'},db.pool),{code:'not_found'});
 assert.equal(await previewBoardInvite(token,db.pool),null);
 await reconcileRolledBackOwner(db.pool,'owner');await cutoverOwner(db.pool,'owner');await retireCompatibilityMirror(db.pool,'owner');
 assert.equal((await getV2Card('recovery-editor',{boardKey:key,id:'shared-card'},db.pool)).result.kind,'card');
 assert.equal((await getBoardSharing('owner',key,db.pool)).invitePath,'/i/'+token);
});

test('resetting a last owned board preserves joined boards and queued edits target the new owned board',async()=>{
 const {KanbanBrowserStore}=await import('../../lib/kanban-browser-store.ts');const {KanbanBrowserApi}=await import('../../lib/kanban-browser-api.ts');
 const actor='reset-editor';await acceptBoardInvite(actor,(await getBoardSharing('owner',key,db.pool)).invitePath.split('/').at(-1),db.pool);
 const own=(await listV2Boards(actor,{},db.pool)).items.find(b=>b.accessLevel==='owner');
 const values=new Map();let view;
 const api=new KanbanBrowserApi(async(path,init)=>{const url=new URL(path,'http://localhost');return init?.method==='POST'?kanbanOperationResponse(actor,new Request(url,init),db.pool):kanbanReadResponse(actor,url.pathname.split('/').at(-1),url.searchParams,db.pool);});
 const store=new KanbanBrowserStore({getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},actor,api,next=>view=next);await store.start(own.id);
 store.dispatch({type:'deleteActiveBoard',replacementId:'reset-own-replacement'});store.dispatch({type:'addTask',listId:'todo',id:'after-owned-reset',title:'Owned after reset'});await store.sync();
 assert.equal(view.status,'synced',view.message);assert.equal(view.pending,0);assert.equal(view.state.boards.length,2);assert.equal(view.state.boards.find(b=>b.id==='reset-own-replacement').tasks[0].id,'after-owned-reset');await store.stop();
});

test('an invite scanned before disable cannot join after disable wins the board lock',async()=>{
 await initializeNewKanbanAccount('join-racer',db.pool);
 const token=(await getBoardSharing('owner',key,db.pool)).invitePath.split('/').at(-1);
 const client=await db.pool.connect();
 try {
  await client.query('BEGIN');await client.query('SELECT 1 FROM "KanbanBoard" WHERE "boardKey"=$1 FOR UPDATE',[key]);
  const pending=assert.rejects(acceptBoardInvite('join-racer',token,db.pool),{code:'not_found'});
  let blocked=false;
  for(let i=0;i<100;i++){
   blocked=(await db.pool.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked',[client.processID])).rows[0].blocked;
   if(blocked)break;await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(blocked,true,'Join reached its serialized acceptance boundary');
  await client.query('UPDATE "KanbanBoard" SET "inviteNonce"=NULL WHERE "boardKey"=$1',[key]);await client.query('COMMIT');await pending;
  assert.equal((await db.pool.query('SELECT 1 FROM "KanbanBoardMember" WHERE "boardKey"=$1 AND "userId"=\'join-racer\'',[key])).rowCount,0);
 }finally{await client.query('ROLLBACK');client.release();}
});
