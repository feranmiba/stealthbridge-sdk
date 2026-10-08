import {test} from "node:test";
import assert from "node:assert/strict";
import {StealthBridgeClient,ApiError} from "../dist/index.js";
const api=(body,status=200)=>new StealthBridgeClient({
 network:"testnet",apiBaseUrl:"https://api.example",
 fetchImpl:async()=>new Response(JSON.stringify(body),{status})
});
test("readiness is dependency status, and always states payments are disabled",async()=>{
 const result=await api({status:"ready",stellar_rpc:"connected",database:"connected",
  payments:"disabled"}).readiness();
 assert.equal(result.status,"ready");
 assert.equal(result.payments,"disabled");
});
test("unavailable database is an explicit 503, never faked as ready",async()=>{
 await assert.rejects(api({status:"degraded",stellar_rpc:"connected",database:"unavailable",
  payments:"disabled"},503).readiness(),e=>e instanceof ApiError&&e.status===503);
});
test("contradictory readiness cannot be misrepresented as healthy",async()=>{
 for(const body of [
  {status:"ready",stellar_rpc:"unavailable",database:"connected",payments:"disabled"},
  {status:"ready",stellar_rpc:"connected",database:"connected",payments:"enabled"}
 ]){
  await assert.rejects(api(body).readiness(),e=>e instanceof ApiError&&e.status===502);
 }
});
