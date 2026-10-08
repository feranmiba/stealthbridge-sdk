import {test} from "node:test";
import assert from "node:assert/strict";
import {StealthBridgeClient,ApiError} from "../dist/index.js";

const HASH="a".repeat(64);
const jsonHeaders={"content-type":"application/json"};
const client=(handler,opts={})=>new StealthBridgeClient({apiBaseUrl:"https://api.example",
 network:"testnet",fetchImpl:handler,...opts});

test("rejects incorrect network returned by a compromised service",async()=>{
 const api=client(async()=>new Response(JSON.stringify({network:"public",passphrase:"Public Global Stellar Network ; September 2015",
 source:"stellar-rpc",protocol_version:27,ledger_sequence:1,ledger_hash:HASH,ledger_closed_at_unix:"1"}),{headers:jsonHeaders}));
 await assert.rejects(api.network(),e=>e instanceof ApiError&&e.status===502);
});

test("surfaces malformed, excessive, or unexpected JSON, or wrong content-type",async()=>{
 for(const body of ["broken json",JSON.stringify({payments_enabled:true}),"x".repeat(65537)]){
  const api=client(async()=>new Response(body,{headers:jsonHeaders}));
  await assert.rejects(api.capabilities(),e=>e instanceof ApiError&&e.status===502);
 }
 const apiWrongType=client(async()=>new Response(JSON.stringify({payments_enabled:true,confidential_token_verified:true,private_payments_verified:true,fiat_payouts_enabled:true}),{headers:{"content-type":"text/html"}}));
 await assert.rejects(apiWrongType.capabilities(),e=>e instanceof ApiError&&e.status===502);
});

test("explicit abort is propagated without any fabricated response",async()=>{
 const controller=new AbortController();
 const api=client((_url,options)=>new Promise((_resolve,reject)=>{
  options.signal.addEventListener("abort",()=>reject(options.signal.reason),{once:true});
 }));
 const pending=api.corridors({signal:controller.signal});
 controller.abort();
 await assert.rejects(pending);
});

test("rejects credentials in API endpoint and unreasonable timeouts or retry parameters",()=>{
 assert.throws(()=>client(fetch,{timeoutMs:99}),/timeoutMs/);
 assert.throws(()=>client(fetch,{maxRetries:6}),/maxRetries/);
 assert.throws(()=>client(fetch,{retryBackoffMs:-1}),/retryBackoffMs/);
 assert.throws(()=>new StealthBridgeClient({apiBaseUrl:"https://user:password@api.example",
  network:"testnet"}),/credentials/);
});

test("classifies 400, 404, 429 and 503 errors without retries when maxRetries is 0",async()=>{
 for(const status of [400, 404, 429, 503]){
  let calls=0;
  const api=client(async()=>{
   calls++;
   return new Response("error",{status});
  },{maxRetries:0});
  await assert.rejects(api.corridors(),e=>e instanceof ApiError&&e.status===status);
  assert.equal(calls,1);
 }
});

test("honors opt-in bounded retries for GET requests on 429, 503, and 502",async()=>{
 let calls=0;
 const api=client(async()=>{
  calls++;
  if(calls<3){
   return new Response("busy",{status:503});
  }
  return new Response(JSON.stringify([]),{status:200,headers:jsonHeaders});
 },{maxRetries:3,retryBackoffMs:5});

 const res=await api.corridors();
 assert.deepEqual(res,[]);
 assert.equal(calls,3);
});

test("respects retry cap when server continuously returns 429 or 503",async()=>{
 let calls=0;
 const api=client(async()=>{
  calls++;
  return new Response("rate limited",{status:429});
 },{maxRetries:2,retryBackoffMs:5});

 await assert.rejects(api.corridors(),e=>e instanceof ApiError&&e.status===429);
 assert.equal(calls,3);
});

test("does not retry 400 or 404 even if maxRetries > 0",async()=>{
 let calls=0;
 const api=client(async()=>{
  calls++;
  return new Response("not found",{status:404});
 },{maxRetries:3,retryBackoffMs:5});

 await assert.rejects(api.corridors(),e=>e instanceof ApiError&&e.status===404);
 assert.equal(calls,1);
});

test("abort during retry backoff cancels remaining retries",async()=>{
 let calls=0;
 const controller=new AbortController();
 const api=client(async()=>{
  calls++;
  if(calls===1){
   setTimeout(()=>controller.abort(),10);
   return new Response("unavailable",{status:503});
  }
  return new Response(JSON.stringify([]),{status:200,headers:jsonHeaders});
 },{maxRetries:3,retryBackoffMs:50});

 await assert.rejects(api.corridors({signal:controller.signal}));
 assert.equal(calls,1);
});
