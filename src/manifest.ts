/**
 * Read-only contract artifact discovery. A registry status does not establish
 * issuer endorsement, audited privacy or deployment authenticity.
 */
export interface DeploymentManifest {
  schemaVersion:1;
  network:"testnet";
  status:"not-deployed"|"deployed";
  verified:boolean;
  contractAddresses:Record<string,string>;
  assetIssuers:Record<string,string>;
  txHashes:string[];
  notes?:string;
}
export class ManifestError extends Error {
 constructor(message:string){super(message);this.name="ManifestError";}
}
const hashPattern=/^[0-9a-f]{64}$/i;
// Strkey validation must eventually be delegated to official Stellar SDK.
const contractPattern=/^C[A-Z2-7]{55}$/;
function isObject(input:unknown):input is Record<string,unknown>{
 return !!input && typeof input==="object" && !Array.isArray(input);
}
export function parseDeploymentManifest(input:unknown):DeploymentManifest {
 if(!isObject(input))throw new ManifestError("Expected manifest object");
 if(input.schemaVersion!==1||input.network!=="testnet" ||
   !["not-deployed","deployed"].includes(String(input.status)) ||
   typeof input.verified!=="boolean")
    throw new ManifestError("Unsupported manifest version or network");
 if(!isObject(input.contractAddresses)||!isObject(input.assetIssuers)||
   !Array.isArray(input.txHashes))throw new ManifestError("Invalid manifest fields");
 const addresses=input.contractAddresses;
 const assets=input.assetIssuers;
 const hashes=input.txHashes;
 if(Object.keys(addresses).some(k=>!/^[a-z][a-z0-9-]{0,63}$/.test(k) ||
    typeof addresses[k]!=="string" || !contractPattern.test(addresses[k])) ||
   Object.values(assets).some(v=>typeof v!=="string"||!/^G[A-Z2-7]{55}$/.test(v)) ||
   hashes.some(v=>typeof v!=="string"||!hashPattern.test(v)))
     throw new ManifestError("Malformed contract or evidence identifiers");
 if(input.status==="not-deployed" &&
    (input.verified!==false || Object.keys(addresses).length!==0 || hashes.length!==0))
      throw new ManifestError("Undeployed manifest cannot advertise verified contracts");
 if(input.status==="deployed" && (!input.verified || !hashes.length || !Object.keys(addresses).length))
      throw new ManifestError("Deployed manifest requires explicit verification evidence");
 if(input.notes!==undefined && typeof input.notes!=="string")
      throw new ManifestError("Invalid notes");
 return {
   schemaVersion:1,network:"testnet",
   status:input.status as DeploymentManifest["status"],verified:input.verified,
   contractAddresses:Object.freeze({...addresses}) as Record<string,string>,
   assetIssuers:Object.freeze({...assets}) as Record<string,string>,
   txHashes:Object.freeze([...hashes]) as string[],
   ...(typeof input.notes==="string"?{notes:input.notes}:{})
 };
}
/** Returns no contract for unverified/not-deployed manifests; never guesses. */
export function getVerifiedContract(manifest:DeploymentManifest,name:string):string {
 if(manifest.status!=="deployed"||!manifest.verified)
   throw new ManifestError("Contract not independently verified as deployed");
 if(!manifest.contractAddresses[name])
   throw new ManifestError("No declared contract for requested name");
 // A JSON flag or valid-looking StrKey does not verify code hash, WASM,
 // network, or on-chain existence. Keep this intentionally unavailable
 // until a trusted Stellar RPC attestation is implemented.
 throw new ManifestError("On-chain contract attestation is required before resolving any address");
}
