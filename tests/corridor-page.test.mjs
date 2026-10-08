import {test} from "node:test";
import assert from "node:assert/strict";
import {StealthBridgeClient,ApiError} from "../dist/index.js";

const cursor="a1b2c3d4-1a2b-4a2a-8b1b-a1b2c3d4e5f6";
const second="b1b2c3d4-1a2b-4a2a-8b1b-a1b2c3d4e5f6";
const fixture=(id)=>({id,origin_country:"NG",destination_country:"KE",
 asset_code:"TEST_ONLY",asset_issuer:null,privacy_rail:"confidential-token"});
test("corridor pages are bounded and carry validated cursors",async()=>{
 const calls=[];
 const api=new StealthBridgeClient({network:"testnet",apiBaseUrl:"https://api.example",
 fetchImpl:async url=>{
  calls.push(String(url));
  return new Response(JSON.stringify(calls.length===1?
   {items:[fixture(cursor)],next_cursor:cursor}:
   {items:[fixture(second)],next_cursor:null}),{status:200});
 }});
 const one=await api.corridorsPage({limit:1});
 assert.equal(one.next_cursor,cursor);
 const two=await api.corridorsPage({limit:1,after:one.next_cursor});
 assert.equal(two.items[0].id,second);
 assert.equal(two.next_cursor,null);
 assert.deepEqual(calls,[
  "https://api.example/v1/corridors/page?limit=1",
  "https://api.example/v1/corridors/page?limit=1&after="+cursor
 ]);
});
test("query validation rejects oversized pages and injection attempts",()=>{
 const api=new StealthBridgeClient({network:"testnet",apiBaseUrl:"https://api.example"});
 for(const limit of [0,101,-1,1.5,NaN])
  assert.throws(()=>api.corridorsPage({limit}),RangeError);
 assert.throws(()=>api.corridorsPage({after:"../../health"}),TypeError);
});
test("malformed page results cannot bypass runtime schema guard",async()=>{
 const api=new StealthBridgeClient({network:"testnet",apiBaseUrl:"https://api.example",
 fetchImpl:async()=>new Response(JSON.stringify({items:[fixture(cursor)],next_cursor:"bad"}))});
 await assert.rejects(api.corridorsPage(),e=>e instanceof ApiError&&e.status===502);
});

test("scanCorridors iterates only actual keyset data with finite page caps",async()=>{
 const seen=[];
 const api=new StealthBridgeClient({network:"testnet",apiBaseUrl:"https://api.example",
  fetchImpl:async url=>{
   seen.push(String(url));
   return new Response(JSON.stringify(seen.length===1?
     {items:[fixture(cursor)],next_cursor:cursor}:
     {items:[fixture(second)],next_cursor:null}));
  }});
 const ids=[];
 for await(const c of api.scanCorridors({pageSize:1,maxPages:3}))ids.push(c.id);
 assert.deepEqual(ids,[cursor,second]);
 assert.equal(seen.length,2);
});
test("scanCorridors cannot silently scan unlimited pages",async()=>{
 let calls=0;
 const api=new StealthBridgeClient({network:"testnet",apiBaseUrl:"https://api.example",
 fetchImpl:async ()=>{
   calls++;
   const id=(calls.toString(16).padStart(8,"0"))+"-1111-1111-1111-111111111111";
   return new Response(JSON.stringify({items:[fixture(id)],next_cursor:id}));
 }});
 const items=[];
 for await(const c of api.scanCorridors({pageSize:1,maxPages:2}))items.push(c);
 assert.equal(items.length,2);
 assert.equal(calls,2);
 await assert.rejects(api.scanCorridors({maxPages:10000}).next(),RangeError);
});
test("rejects cursor mismatches instead of reusing a forged page",async()=>{
 const api=new StealthBridgeClient({network:"testnet",apiBaseUrl:"https://api.example",
  fetchImpl:async()=>new Response(JSON.stringify({items:[fixture(cursor)],next_cursor:second}))});
 await assert.rejects(api.corridorsPage(),e=>e instanceof ApiError&&e.status===502);
});
