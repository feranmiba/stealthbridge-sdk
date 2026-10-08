import {test} from "node:test";
import assert from "node:assert/strict";
import {ManifestError,parseDeploymentManifest,getVerifiedContract} from "../dist/index.js";
const noDeployment={schemaVersion:1,network:"testnet",status:"not-deployed",verified:false,
 contractAddresses:{},assetIssuers:{},txHashes:[]};
test("actual undeployed schema is honestly accepted but cannot resolve contracts",()=>{
 const a=parseDeploymentManifest(noDeployment);
 assert.equal(a.status,"not-deployed");
 assert.throws(()=>getVerifiedContract(a,"corridor-registry"),ManifestError);
});
test("rejects unsupported networks or fabricated deployed claims",()=>{
 assert.throws(()=>parseDeploymentManifest({...noDeployment,network:"public"}),ManifestError);
 assert.throws(()=>parseDeploymentManifest({...noDeployment,verified:true}),ManifestError);
 assert.throws(()=>parseDeploymentManifest({...noDeployment,contractAddresses:{registry:"C".repeat(56)}}),ManifestError);
 assert.throws(()=>parseDeploymentManifest({...noDeployment,status:"deployed"}),ManifestError);
});
test("rejects invalid IDs even in explicitly verified claims",()=>{
 assert.throws(()=>parseDeploymentManifest({...noDeployment,status:"deployed",verified:true,
 contractAddresses:{registry:"not_an_address"},txHashes:["f".repeat(64)]}),ManifestError);
});

test("a claimed deployment can never yield a contract ID without independent attestation",()=>{
 const claimed={
  schemaVersion:1,network:"testnet",status:"deployed",verified:true,
  contractAddresses:{"corridor-registry":"C"+"A".repeat(55)},assetIssuers:{},
  txHashes:["a".repeat(64)]
 };
 const parsed=parseDeploymentManifest(claimed);
 assert.throws(()=>getVerifiedContract(parsed,"corridor-registry"),/attestation/);
});
