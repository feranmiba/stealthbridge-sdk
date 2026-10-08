import { parseDeploymentManifest } from "./manifest.js";
import type {Capabilities,Corridor,Network,NetworkStatus,TransactionObservation,CorridorPage,LedgerCheckpoint,Readiness,ContractDiscovery,PublicSorobanInterface} from "./types.js";

export interface ClientConfig {
 apiBaseUrl:string;
 network:Network;
 fetchImpl?:typeof fetch;
 /** Timeout for read-only API calls; defaults to 10s. */
 timeoutMs?:number;
}
export interface RequestOptions {signal?:AbortSignal; /** GET-only retries after 429, 502 or 503. Default 0, maximum 2. */ retries?:0|1|2;}
export interface CorridorPageOptions extends RequestOptions { after?:string; limit?:number; }
/** Hard-capped iteration: protects UI services from unbounded catalog scans. */
export interface CorridorScanOptions extends RequestOptions { pageSize?:number; maxPages?:number; }

export class ApiError extends Error {
 constructor(public readonly status:number,public readonly path:string) {
  super("StealthBridge API returned HTTP "+status+" for "+path);this.name="ApiError";
 }
}
function object(value:unknown):value is Record<string,unknown>{
 return value!==null && typeof value==="object" && !Array.isArray(value);
}
/** Do not interpret a method inventory as proof of an on-chain instance. */
function sourceInterface(value:unknown):value is PublicSorobanInterface {
 if(!object(value)||value.schemaVersion!==1||value.network!=="testnet"||
    value.status!=="source-interface-only"||!object(value.contracts))return false;
 const expected={
  "corridor-registry":["get_admin","pending_admin","is_paused","is_enabled"],
  "policy-registry":["admin","pending_admin","is_paused","get_rule","is_effective"],
 } as const;
 for(const [name,methods] of Object.entries(expected)){
  const row=value.contracts[name];
  if(!object(row)||!object(row.reads)||!Array.isArray(row.writes)||
     typeof row.source!=="string")return false;
  if(Object.keys(row.reads).sort().join(",")!==[...methods].sort().join(","))
   return false;
  for(const method of methods){
   const item=row.reads[method];
   if(!object(item)||!Array.isArray(item.args)||
      !item.args.every((arg:unknown)=>typeof arg==="string")||
      typeof item.returns!=="string")return false;
  }
 }
 return true;
}
/** Distinguishes upstream manifest claims from independently proven execution. */
function contractDiscovery(value:unknown):value is ContractDiscovery{
 if(!object(value)||value.network!=="testnet" ||
    value.source!=="stealthbridge-contracts/deployments/testnet/manifest.json" ||
    value.on_chain_verified!==false || value.payment_execution_enabled!==false ||
    !sourceInterface(value.public_interface))
   return false;
 try{
   const manifest=parseDeploymentManifest(value.manifest);
   return manifest.status==="not-deployed" && manifest.verified===false &&
     Object.keys(manifest.contractAddresses).length===0 &&
     manifest.txHashes.length===0;
 }catch{return false;}
}
function networkStatus(value:unknown):value is NetworkStatus{
 return object(value) && value.network==="testnet" &&
  value.passphrase==="Test SDF Network ; September 2015" &&
  value.source==="stellar-rpc" &&
  Number.isSafeInteger(value.protocol_version) && Number(value.protocol_version)>0 &&
  Number.isSafeInteger(value.ledger_sequence) && Number(value.ledger_sequence)>0 &&
  typeof value.ledger_hash==="string" && /^[0-9a-f]{64}$/i.test(value.ledger_hash) &&
  typeof value.ledger_closed_at_unix==="string" && /^[0-9]{1,20}$/.test(value.ledger_closed_at_unix);
}
function ledgerCheckpoint(value:unknown):value is LedgerCheckpoint {
 return object(value)&&Number.isSafeInteger(value.ledger_sequence)&&
  typeof value.ledger_sequence==="number"&&value.ledger_sequence>0&&
  typeof value.ledger_hash==="string"&&/^[0-9a-f]{64}$/i.test(value.ledger_hash)&&
  typeof value.ledger_closed_at_unix==="string"&&/^[0-9]{1,20}$/.test(value.ledger_closed_at_unix)&&
  value.source==="stellar-rpc";
}
function readiness(value:unknown):value is Readiness {
 return object(value)&&["ready","degraded"].includes(String(value.status)) &&
  ["connected","unavailable"].includes(String(value.stellar_rpc)) &&
  ["connected","unavailable"].includes(String(value.database)) &&
  value.payments==="disabled" &&
  (value.status==="ready") ===
   (value.stellar_rpc==="connected"&&value.database==="connected");
}
function capabilities(value:unknown):value is Capabilities{
 return object(value) && ["payments_enabled","confidential_token_verified",
  "private_payments_verified","fiat_payouts_enabled"].every(k=>typeof value[k]==="boolean");
}
function corridor(value:unknown):value is Corridor {
 return object(value)&&typeof value.id==="string"&&
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value.id)&&
  typeof value.origin_country==="string"&&/^[A-Z]{2}$/.test(value.origin_country)&&
  typeof value.destination_country==="string"&&/^[A-Z]{2}$/.test(value.destination_country)&&
  value.origin_country!==value.destination_country&&
  typeof value.asset_code==="string"&&/^[a-zA-Z0-9_:-]{1,64}$/.test(value.asset_code)&&
  (value.asset_issuer===null||(typeof value.asset_issuer==="string"&&
   value.asset_issuer.length>0&&value.asset_issuer.length<=128))&&
  ["confidential-token","private-payments"].includes(String(value.privacy_rail));
}
function observation(value:unknown):value is TransactionObservation {
 return object(value)&&typeof value.hash==="string"&&/^[a-f0-9]{64}$/i.test(value.hash)&&
  ["SUCCESS","FAILED"].includes(String(value.status)) &&
  Number.isSafeInteger(value.ledger)&&typeof value.ledger==="number"&&value.ledger>0&&
  Number.isSafeInteger(value.latest_ledger)&&typeof value.latest_ledger==="number"&&value.latest_ledger>=value.ledger&&
  typeof value.closed_at_unix==="string"&&/^[0-9]{1,20}$/.test(value.closed_at_unix)&&
  value.source==="stellar-rpc";
}

/** Narrow the untrusted backend payload before ordering/cursor checks. */
function corridorPageValid(value:unknown,limit:number,after?:string):value is CorridorPage{
 if(!object(value)||!Array.isArray(value.items)||value.items.length>limit ||
    !value.items.every(corridor))return false;
 const items:Corridor[]=value.items;
 const cursor=value.next_cursor;
 if(cursor!==null&&(typeof cursor!=="string"||
   !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(cursor)))return false;
 if(cursor!==null&&(items.length===0 ||
   cursor.toLowerCase()!==items[items.length-1].id.toLowerCase()))return false;
 return items.every((item,index)=> (index===0 ||
   items[index-1].id.toLowerCase()<item.id.toLowerCase()) &&
   (after===undefined||item.id.toLowerCase()>after.toLowerCase()));
}
const MAX_JSON_BYTES=65536;
export class StealthBridgeClient {
 private readonly base:string;
 private readonly transport:typeof fetch;
 private readonly timeoutMs:number;
 constructor(config:ClientConfig) {
  if(config.network!=="testnet")throw new Error("Only Stellar testnet is supported");
  const url=new URL(config.apiBaseUrl);
  if(!["https:","http:"].includes(url.protocol))throw new Error("Unsupported API URL protocol");
  if(url.protocol!=="https:"&&!["localhost","127.0.0.1"].includes(url.hostname))
   throw new Error("Non-local API connections must use HTTPS");
  if(url.username||url.password||url.hash||url.search)
   throw new Error("API URL must not contain credentials, fragments or query parameters");
  this.base=url.toString().replace(/\/$/,"");
  this.transport=config.fetchImpl??fetch;
  const timeout=config.timeoutMs??10000;
  if(!Number.isSafeInteger(timeout)||timeout<100||timeout>60000)
   throw new Error("timeoutMs must be a whole number between 100 and 60000");
  this.timeoutMs=timeout;
 }
 private async read<T>(path:string,guard:(value:unknown)=>value is T,options:RequestOptions={}):Promise<T>{
  const attempts=options.retries??0;
  if(!Number.isInteger(attempts)||attempts<0||attempts>2)
   throw new RangeError("GET retries must be an integer from 0 to 2");
  // The budget includes all retries, backoff and response streaming.
  const timeout=AbortSignal.timeout(this.timeoutMs);
  const signal=options.signal?AbortSignal.any([options.signal,timeout]):timeout;
  for(let attempt=0;;attempt++){
   signal.throwIfAborted();
   try{
    const response=await this.transport(this.base+path,{
     method:"GET",headers:{accept:"application/json"},cache:"no-store",signal,
    });
    if(!response.ok)throw new ApiError(response.status,path);
    const declared=response.headers.get("content-length");
    if(declared!==null&&Number(declared)>MAX_JSON_BYTES)throw new ApiError(502,path);
    const raw=await this.readBoundedBody(response,signal,path);
    let parsed:unknown;
    try{parsed=JSON.parse(raw);}catch{throw new ApiError(502,path);}
    if(!guard(parsed))throw new ApiError(502,path);
    return parsed;
   }catch(error){
    if(signal.aborted)throw signal.reason;
    // Automatic retry is opt-in and limited to safe, idempotent GET reads.
    const recoverable=error instanceof ApiError && [429,502,503].includes(error.status);
    if(!recoverable||attempt>=attempts)throw error;
    await StealthBridgeClient.backoff(150*(2**attempt),signal);
   }
  }
 }
 private async readBoundedBody(response:Response,signal:AbortSignal,path:string):Promise<string>{
  if(!response.body)return "";
  const reader=response.body.getReader();
  const decoder=new TextDecoder("utf-8",{fatal:true});
  let size=0,body="";
  try{
   while(true){
    signal.throwIfAborted();
    const {done,value}=await reader.read();
    if(done)break;
    size+=value.byteLength;
    if(size>MAX_JSON_BYTES)throw new ApiError(502,path);
    body+=decoder.decode(value,{stream:true});
   }
   return body+decoder.decode();
  }finally{
   reader.releaseLock();
   // Closing stream when over budget avoids reading the remaining XDR/JSON.
   if(size>MAX_JSON_BYTES)void response.body.cancel().catch(()=>{});
  }
 }
 private static backoff(ms:number,signal:AbortSignal):Promise<void>{
  return new Promise((resolve,reject)=>{
   if(signal.aborted){reject(signal.reason);return;}
   const cleanup=()=>signal.removeEventListener("abort",abort);
   const abort=()=>{clearTimeout(timer);cleanup();reject(signal.reason);};
   const timer=setTimeout(()=>{cleanup();resolve();},ms);
   signal.addEventListener("abort",abort,{once:true});
  });
 }
 /** Read the authoritative *undeployed* contract snapshot, never a claimed payout. */
 contracts(options?:RequestOptions):Promise<ContractDiscovery>{
  return this.read("/v1/contracts",contractDiscovery,options);
 }
 /** Last persisted opt-in observer head. 404 means no checkpoint, not a fictional ledger. */
 observerHead(options?:RequestOptions):Promise<LedgerCheckpoint>{
  return this.read("/v1/observer",ledgerCheckpoint,options);
 }
 /** Read dependency health, explicitly not evidence of live payment capability. */
 readiness(options?:RequestOptions):Promise<Readiness>{
  return this.read("/ready",readiness,options);
 }
 health(options?:RequestOptions):Promise<{service:string;status:string}>{
  return this.read("/health",(v):v is {service:string;status:string}=>
   object(v)&&typeof v.service==="string"&&typeof v.status==="string",options);
 }
 network(options?:RequestOptions):Promise<NetworkStatus>{
  return this.read("/v1/network",networkStatus,options);
 }
 capabilities(options?:RequestOptions):Promise<Capabilities>{
  return this.read("/v1/capabilities",capabilities,options);
 }
 corridors(options?:RequestOptions):Promise<Corridor[]>{
  return this.read("/v1/corridors",(v):v is Corridor[]=>
   Array.isArray(v)&&v.length<=10000&&v.every(corridor),options);
 }
 /** Bounded keyset pagination; cursor comes only from a real API response. */
 corridorsPage(options:CorridorPageOptions={}):Promise<CorridorPage>{
  const limit=options.limit??25;
  if(!Number.isInteger(limit)||limit<1||limit>100)
   throw new RangeError("Page limit must be between 1 and 100");
  const after=options.after;
  if(after!==undefined&&!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(after))
   throw new TypeError("Cursor must be a UUID returned by the corridor API");
  const params=new URLSearchParams({limit:String(limit)});
  if(after)params.set("after",after.toLowerCase());
  return this.read("/v1/corridors/page?"+params.toString(),
   (value):value is CorridorPage=>corridorPageValid(value,limit,after),options);
 }

 /**
  * Iterate verified, actual operator-configured corridor pages, with a hard
  * upper bound and a replay/loop guard. The caller owns cancellation.
  *
  * This does NOT establish a live payment provider or available liquidity.
  */
 async *scanCorridors(options:CorridorScanOptions={}):AsyncGenerator<Corridor,void,void>{
  const pageSize=options.pageSize??25,maxPages=options.maxPages??20;
  if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>100)
   throw new RangeError("maxPages must be between 1 and 100");
  if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)
   throw new RangeError("pageSize must be between 1 and 100");
  let after:string|undefined;
  const visited=new Set<string>();
  for(let pageNumber=0;pageNumber<maxPages;pageNumber++){
   options.signal?.throwIfAborted();
   const pageOptions:CorridorPageOptions={limit:pageSize};
   if(after!==undefined)pageOptions.after=after;
   if(options.signal!==undefined)pageOptions.signal=options.signal;
   if(options.retries!==undefined)pageOptions.retries=options.retries;
   const page=await this.corridorsPage(pageOptions);
   for(const item of page.items){
    if(visited.has(item.id))throw new ApiError(502,"/v1/corridors/page");
    visited.add(item.id);
    yield item;
   }
   if(page.next_cursor===null)return;
   if(page.next_cursor===after)throw new ApiError(502,"/v1/corridors/page");
   after=page.next_cursor;
  }
  // A finite page cap is intentional; consumers can use explicit cursors
  // for larger catalogs rather than silently fetching forever.
 }
 /** Inspect one enabled, operator-configured corridor from real database state. */
 corridor(id:string,options?:RequestOptions):Promise<Corridor>{
  if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id))
    throw new TypeError("Corridor ID must be a valid UUID");
  return this.read("/v1/corridors/"+id.toLowerCase(),corridor,options);
 }
 /** Hash lookup proves inclusion only, never fiat payout or private-transfer success. */
 transaction(hash:string,options?:RequestOptions):Promise<TransactionObservation>{
  if(!/^[a-f0-9]{64}$/i.test(hash))
    throw new TypeError("Transaction hash must be exactly 64 hexadecimal characters");
  return this.read("/v1/transactions/"+hash.toLowerCase(),observation,options);
 }
 /** No signing, quoting, settlement or wallet-key functions in this client. */
}
