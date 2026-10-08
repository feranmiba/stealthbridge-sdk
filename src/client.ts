import type {Capabilities,Corridor,Network,NetworkStatus,TransactionObservation,CorridorPage,LedgerCheckpoint} from "./types.js";

export interface ClientConfig {
 apiBaseUrl:string;
 network:Network;
 fetchImpl?:typeof fetch;
 /** Timeout for read-only API calls; defaults to 10s. */
 timeoutMs?:number;
}
export interface RequestOptions {signal?:AbortSignal; /** GET-only retries after 429, 502 or 503. Default 0, maximum 2. */ retries?:0|1|2;}
export interface CorridorPageOptions extends RequestOptions { after?:string; limit?:number; }
export class ApiError extends Error {
 constructor(public readonly status:number,public readonly path:string) {
  super("StealthBridge API returned HTTP "+status+" for "+path);this.name="ApiError";
 }
}
function object(value:unknown):value is Record<string,unknown>{
 return value!==null && typeof value==="object" && !Array.isArray(value);
}
function networkStatus(value:unknown):value is NetworkStatus{
 return object(value) && value.network==="testnet" &&
  value.passphrase==="Test SDF Network ; September 2015" &&
  value.source==="stellar-rpc" &&
  Number.isSafeInteger(value.protocol_version) && Number.isSafeInteger(value.ledger_sequence) &&
  typeof value.ledger_hash==="string" && /^[0-9a-f]{64}$/i.test(value.ledger_hash) &&
  typeof value.ledger_closed_at_unix==="string";
}
function ledgerCheckpoint(value:unknown):value is LedgerCheckpoint {
 return object(value)&&Number.isSafeInteger(value.ledger_sequence)&&
  typeof value.ledger_sequence==="number"&&value.ledger_sequence>0&&
  typeof value.ledger_hash==="string"&&/^[0-9a-f]{64}$/i.test(value.ledger_hash)&&
  typeof value.ledger_closed_at_unix==="string"&&/^[0-9]{1,20}$/.test(value.ledger_closed_at_unix)&&
  value.source==="stellar-rpc";
}
function capabilities(value:unknown):value is Capabilities{
 return object(value) && ["payments_enabled","confidential_token_verified",
  "private_payments_verified","fiat_payouts_enabled"].every(k=>typeof value[k]==="boolean");
}
function corridor(value:unknown):value is Corridor {
 return object(value)&&typeof value.id==="string"&&
  typeof value.origin_country==="string"&&/^[A-Z]{2}$/.test(value.origin_country)&&
  typeof value.destination_country==="string"&&/^[A-Z]{2}$/.test(value.destination_country)&&
  typeof value.asset_code==="string"&&
  (value.asset_issuer===null||typeof value.asset_issuer==="string")&&
  ["confidential-token","private-payments"].includes(String(value.privacy_rail));
}
function observation(value:unknown):value is TransactionObservation {
 return object(value)&&typeof value.hash==="string"&&/^[a-f0-9]{64}$/i.test(value.hash)&&
  ["SUCCESS","FAILED"].includes(String(value.status)) &&
  Number.isSafeInteger(value.ledger)&&Number.isSafeInteger(value.latest_ledger)&&
  typeof value.closed_at_unix==="string"&&value.source==="stellar-rpc";
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
 /** Last persisted opt-in observer head. 404 means no checkpoint, not a fictional ledger. */
 observerHead(options?:RequestOptions):Promise<LedgerCheckpoint>{
  return this.read("/v1/observer",ledgerCheckpoint,options);
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
  return this.read("/v1/corridors/page?"+params.toString(),(v):v is CorridorPage=>
   object(v)&&Array.isArray(v.items)&&v.items.length<=limit&&v.items.every(corridor)&&
   (v.next_cursor===null||(typeof v.next_cursor==="string"&&
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v.next_cursor)) ), options);
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
