import {test} from "node:test";
import assert from "node:assert/strict";
import {StealthBridgeClient,ApiError} from "../dist/index.js";
const undeployed={
 schemaVersion:1,network:"testnet",status:"not-deployed",verified:false,
 contractAddresses:{},assetIssuers:{},txHashes:[],
 notes:"No contract deployment asserted"
};
const interfaceData={
  "schemaVersion": 1,
  "network": "testnet",
  "status": "source-interface-only",
  "disclaimer": "Soroban source method inventory only; not proof of deployed contracts or private transfers",
  "contracts": {
    "corridor-registry": {
      "source": "contracts/corridor-registry/src/lib.rs",
      "reads": {
        "get_admin": {
          "args": [],
          "returns": "Address"
        },
        "pending_admin": {
          "args": [],
          "returns": "Option<Address>"
        },
        "is_paused": {
          "args": [],
          "returns": "bool"
        },
        "is_enabled": {
          "args": [
            "String"
          ],
          "returns": "bool"
        }
      },
      "writes": [
        "propose_admin",
        "cancel_admin_proposal",
        "accept_admin",
        "set_paused",
        "set_enabled"
      ]
    },
    "policy-registry": {
      "source": "contracts/policy-registry/src/lib.rs",
      "reads": {
        "admin": {
          "args": [],
          "returns": "Address"
        },
        "pending_admin": {
          "args": [],
          "returns": "Option<Address>"
        },
        "is_paused": {
          "args": [],
          "returns": "bool"
        },
        "get_rule": {
          "args": [
            "String"
          ],
          "returns": "Option<PolicyRecord>"
        },
        "is_effective": {
          "args": [
            "String"
          ],
          "returns": "bool"
        }
      },
      "writes": [
        "propose_admin",
        "cancel_admin_proposal",
        "accept_admin",
        "set_paused",
        "set_rule"
      ]
    }
  }
};
const response={public_interface:interfaceData,network:"testnet",source:"stealthbridge-contracts/deployments/testnet/manifest.json",
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

test("source method inventory is validated and rejects invented signatures",async()=>{
 const item=await client(response).contracts();
 assert.ok(item.public_interface.contracts["corridor-registry"].reads.is_enabled);
 const forged=JSON.parse(JSON.stringify(response));
 forged.public_interface.contracts["corridor-registry"].reads.transfer_funds={args:["String"],returns:"bool"};
 await assert.rejects(client(forged).contracts(),e=>e instanceof ApiError&&e.status===502);
});
