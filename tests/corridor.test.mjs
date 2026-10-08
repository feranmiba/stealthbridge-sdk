import {test} from "node:test";
import assert from "node:assert/strict";
import {StealthBridgeClient,ApiError} from "../dist/index.js";
const id="a1b2c3d4-1a2b-4a2a-8b1b-a1b2c3d4e5f6";
test("corridor detail uses an actual, strictly formatted ID",async()=>{
 const urls=[];
 const client=new StealthBridgeClient({network:"testnet",apiBaseUrl:"https://api.example",
  fetchImpl:async url=>{
   urls.push(url);
   return new Response(JSON.stringify({id,origin_country:"NG",destination_country:"KE",
    asset_code:"TEST_ASSET",asset_issuer:null,privacy_rail:"confidential-token"}),{headers:{"content-type":"application/json"}});
  }});
 const result=await client.corridor(id);
 assert.equal(result.id,id);
 assert.deepEqual(urls,["https://api.example/v1/corridors/"+id]);
 assert.throws(()=>client.corridor("not-id"),/UUID/);
});
test("missing enabled corridor returns 404 instead of a fake record",async()=>{
 const client=new StealthBridgeClient({network:"testnet",apiBaseUrl:"https://api.example",
  fetchImpl:async()=>new Response("",{status:404})});
 await assert.rejects(client.corridor(id),e=>e instanceof ApiError&&e.status===404);
});
