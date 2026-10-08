import {test} from "node:test";
import assert from "node:assert/strict";
import {StealthBridgeClient,ApiError} from "../dist/index.js";
const undeployed={
 schemaVersion:1,network:"testnet",status:"not-deployed",verified:false,
 contractAddresses:{},assetIssuers:{},txHashes:[],
 notes:"No contract deployment asserted"
};
const response={network:"testnet",source:"stealthbridge-contracts/deployments/testnet/manifest.json",
 manifest:undeployed,on_chain_verified:false,payment_execution_enabled:false};
function client(payload){
 return new StealthBridgeClient({network:"testnet",apiBaseUrl:"https://api.example",
  fetchImpl:async()=>new Response(JSON.stringify(payload),{headers:{"content-type":"application/json"}})});
}
test("SDK discovers actual undeployed contracts without synthesizing IDs",async()=>{
 const discovered=await client(response).contracts();
 assert.equal(discovered.manifest.status,"not-deployed");
 assert.deepEqual(discovered.manifest.contractAddresses,{});
 assert.equal(discovered.on_chain_verified,false);
});
test("a false on-chain verification or payment claim fails closed",async()=>{
 for(const value of [
 {...response,on_chain_verified:true},
 {...response,payment_execution_enabled:true},
 {...response,manifest:{...undeployed,verified:true}},
 {...response,manifest:{...undeployed,status:"deployed"}},
 {...response,network:"public"},
 ]){
  await assert.rejects(client(value).contracts(),e=>e instanceof ApiError&&e.status===502);
 }
});
