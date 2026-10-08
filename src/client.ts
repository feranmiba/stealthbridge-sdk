import type {Capabilities,Corridor,Network,NetworkStatus,TransactionObservation} from "./types.js";

export interface ClientConfig {
 apiBaseUrl:string;
 network:Network;
 fetchImpl?:typeof fetch;
 /** Timeout for read-only API calls; defaults to 10s. */
 timeoutMs?:number;
 /** Maximum retry attempts for GET requests; defaults to 0 (no retries). */
 maxRetries?:number;
 /** Initial retry backoff in milliseconds; defaults to 100ms. */
 retryBackoffMs?:number;
}
export interface RequestOptions {
 signal?:AbortSignal;
 maxRetries?:number;
 retryBackoffMs?:number;
}
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
 private readonly maxRetries:number;
 private readonly retryBackoffMs:number;

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

  const maxRetries=config.maxRetries??0;
  if(!Number.isSafeInteger(maxRetries)||maxRetries<0||maxRetries>5)
   throw new Error("maxRetries must be a whole number between 0 and 5");
  this.maxRetries=maxRetries;

  const retryBackoffMs=config.retryBackoffMs??100;
  if(!Number.isSafeInteger(retryBackoffMs)||retryBackoffMs<0||retryBackoffMs>5000)
   throw new Error("retryBackoffMs must be a whole number between 0 and 5000");
  this.retryBackoffMs=retryBackoffMs;
 }

 private sleep(ms:number,signal?:AbortSignal):Promise<void>{
  if(signal?.aborted)return Promise.reject(signal.reason);
  if(ms<=0)return Promise.resolve();
  return new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>{
    signal?.removeEventListener("abort",onAbort);
    resolve();
   },ms);
   const onAbort=()=>{
    clearTimeout(timer);
    reject(signal?.reason);
   };
   signal?.addEventListener("abort",onAbort,{once:true});
  });
 }

 private validateRequestOptions(options:RequestOptions):{maxRetries:number;retryBackoffMs:number}{
  const maxRetries=options.maxRetries??this.maxRetries;
  if(!Number.isSafeInteger(maxRetries)||maxRetries<0||maxRetries>5)
   throw new Error("maxRetries must be a whole number between 0 and 5");
  const retryBackoffMs=options.retryBackoffMs??this.retryBackoffMs;
  if(!Number.isSafeInteger(retryBackoffMs)||retryBackoffMs<0||retryBackoffMs>5000)
   throw new Error("retryBackoffMs must be a whole number between 0 and 5000");
  return {maxRetries,retryBackoffMs};
 }

 private async read<T>(path:string,guard:(value:unknown)=>value is T,options:RequestOptions={}):Promise<T>{
  const {maxRetries,retryBackoffMs}=this.validateRequestOptions(options);
  let lastError:unknown;

  for(let attempt=0;attempt<=maxRetries;attempt++){
   if(options.signal?.aborted)throw options.signal.reason;

   const attemptTimeout=AbortSignal.timeout(this.timeoutMs);
   const signal=options.signal?AbortSignal.any([options.signal,attemptTimeout]):attemptTimeout;

   try{
    const response=await this.transport(this.base+path,{
     method:"GET",headers:{accept:"application/json"},cache:"no-store",signal,
    });

    if(!response.ok){
     const status=response.status;
     const isRetryable=[429,502,503,504].includes(status);
     if(isRetryable && attempt<maxRetries && !options.signal?.aborted){
      await this.sleep(retryBackoffMs * Math.pow(2,attempt),options.signal);
      continue;
     }
     throw new ApiError(status,path);
    }

    const contentType=response.headers.get("content-type");
    if(!contentType||!contentType.toLowerCase().includes("application/json")){
     throw new ApiError(502,path);
    }

    const declaredLength=Number(response.headers.get("content-length"));
    if(declaredLength>MAX_JSON_BYTES)throw new ApiError(502,path);

    const raw=await response.text();
    if(raw.length>MAX_JSON_BYTES)throw new ApiError(502,path);

    let parsed:unknown;
    try{parsed=JSON.parse(raw);}catch{throw new ApiError(502,path);}

    if(!guard(parsed))throw new ApiError(502,path);

    return parsed;
   }catch(err){
    lastError=err;
    if(options.signal?.aborted)throw options.signal.reason;
    if(err instanceof ApiError){
     if(err.status===502 && attempt<maxRetries && !options.signal?.aborted){
      await this.sleep(retryBackoffMs * Math.pow(2,attempt),options.signal);
      continue;
     }
     throw err;
    }
    if(attempt<maxRetries && !options.signal?.aborted){
     await this.sleep(retryBackoffMs * Math.pow(2,attempt),options.signal);
     continue;
    }
    throw err;
   }
  }
  throw lastError;
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
 corridor(id:string,options?:RequestOptions):Promise<Corridor>{
  if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id))
    throw new TypeError("Corridor ID must be a valid UUID");
  return this.read("/v1/corridors/"+id.toLowerCase(),corridor,options);
 }
 transaction(hash:string,options?:RequestOptions):Promise<TransactionObservation>{
  if(!/^[a-f0-9]{64}$/i.test(hash))
    throw new TypeError("Transaction hash must be exactly 64 hexadecimal characters");
  return this.read("/v1/transactions/"+hash.toLowerCase(),observation,options);
 }
}
