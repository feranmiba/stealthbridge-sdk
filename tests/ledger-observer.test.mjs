import {test} from "node:test";
import assert from "node:assert/strict";
import {StealthBridgeClient,ApiError} from "../dist/index.js";
const head={ledger_sequence:100,ledger_hash:"a".repeat(64),
 ledger_closed_at_unix:"1760000000",source:"stellar-rpc"};
test("reads only a persisted Testnet ledger cursor",async()=>{
 const api=new StealthBridgeClient({apiBaseUrl:"https://api.example",network:"testnet",
  fetchImpl:async()=>new Response(JSON.stringify(head))});
 assert.deepEqual(await api.observerHead(),head);
});
test("does not treat a fabricated or malformed observation as a valid cursor",async()=>{
 const api=new StealthBridgeClient({apiBaseUrl:"https://api.example",network:"testnet",
  fetchImpl:async()=>new Response(JSON.stringify({...head,ledger_hash:"not-hex"}))});
 await assert.rejects(api.observerHead(),e=>e instanceof ApiError&&e.status===502);
});
test("reports missing observer state honestly",async()=>{
 const api=new StealthBridgeClient({apiBaseUrl:"https://api.example",network:"testnet",
  fetchImpl:async()=>new Response("",{status:404})});
 await assert.rejects(api.observerHead(),e=>e instanceof ApiError&&e.status===404);
});
