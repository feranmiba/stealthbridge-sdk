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
