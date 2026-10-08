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

test("opt-in retries 503 GETs only until a live response succeeds",async()=>{
 let calls=0;
 const api=client(async()=>{
  calls++;
  if(calls<3)return new Response("",{status:503});
  return new Response(JSON.stringify({payments_enabled:false,confidential_token_verified:false,
   private_payments_verified:false,fiat_payouts_enabled:false}),{status:200});
 });
 const result=await api.capabilities({retries:2});
 assert.equal(calls,3);
 assert.equal(result.payments_enabled,false);
});
test("non-retryable 404 does not repeat a GET",async()=>{
 let calls=0;
 const api=client(async()=>{calls++;return new Response("",{status:404});});
 await assert.rejects(api.corridors({retries:2}),e=>e instanceof ApiError&&e.status===404);
 assert.equal(calls,1);
});
test("streaming response is capped before reading unlimited bytes",async()=>{
 let pulled=0;
 const stream=new ReadableStream({
  pull(controller){
   pulled++;
   controller.enqueue(new Uint8Array(32768));
   if(pulled>10)controller.close();
  }
 });
 const api=client(async()=>new Response(stream));
 await assert.rejects(api.capabilities(),e=>e instanceof ApiError&&e.status===502);
 assert.ok(pulled<11,"response reader must cancel before consuming the entire body");
});
test("abort during retry delay stops further network requests",async()=>{
 const controller=new AbortController();
 let attempts=0;
 const api=client(async()=>{attempts++;return new Response("",{status:503});});
 const pending=api.corridors({retries:2,signal:controller.signal});
 setTimeout(()=>controller.abort(new Error("cancelled by user")),15);
 await assert.rejects(pending,/cancelled by user/);
 assert.equal(attempts,1);
});

test("rejects malformed public corridor identity instead of returning unsafe records",async()=>{
 const api=client(async()=>new Response(JSON.stringify([{
  id:"../../private",origin_country:"US",destination_country:"US",
  asset_code:"CORRUPT",asset_issuer:null,privacy_rail:"private-payments"
 }])));
 await assert.rejects(api.corridors(),e=>e instanceof ApiError&&e.status===502);
});
test("rejects impossible transaction ledger order and malformed timestamp",async()=>{
 const api=client(async()=>new Response(JSON.stringify({
  hash:HASH,status:"SUCCESS",ledger:100,latest_ledger:90,
  closed_at_unix:"now",source:"stellar-rpc"
 })));
 await assert.rejects(api.transaction(HASH),e=>e instanceof ApiError&&e.status===502);
});
