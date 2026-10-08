import {test} from "node:test";
import assert from "node:assert/strict";
import {AssetAmount, AmountError} from "../dist/index.js";
const asset={network:"testnet",kind:"soroban-token",identifier:"contract:verifiedtoken",decimals:7};
test("exact fractional conversion has no floating-point rounding",()=>{
  const a=AssetAmount.parse(asset,"0.1"),b=AssetAmount.parse(asset,"0.2");
  assert.equal(a.add(b).format(),"0.3");
  assert.equal(a.minorUnits,1000000n);
  assert.equal(AssetAmount.parse(asset,"0").format(),"0");
  assert.equal(AssetAmount.parse(asset,"100.0000001").minorUnits,1000000001n);
});
test("rejects ambiguous or too precise amounts",()=>{
 for(const v of ["-1","+1","01","1e5","1,000"," 1","1.","0.12345678","NaN",""]){
  assert.throws(()=>AssetAmount.parse(asset,v),AmountError);
 }
});
test("asset comparisons and subtraction are strongly scoped",()=>{
 const a=AssetAmount.parse(asset,"2.4"),b=AssetAmount.parse(asset,"1.5");
 assert.equal(a.subtract(b).format(),"0.9");
 assert.equal(a.compare(b),1);
 assert.throws(()=>b.subtract(a),/Negative/);
 assert.throws(()=>a.add(AssetAmount.parse({...asset,identifier:"another-issuer"},"1")),/mismatch/);
 assert.throws(()=>new AssetAmount(asset,1),/bigint/);
});
test("serialization never loses bigint precision",()=>{
 const large=AssetAmount.parse(asset,"99999999999999999999999.0000001");
 assert.deepEqual(JSON.parse(JSON.stringify(large)),{
  asset,minorUnits:large.minorUnits.toString()
 });
});
test("rejects unverified scale or identity",()=>{
 assert.throws(()=>AssetAmount.parse({...asset,decimals:1.5},"1"),/decimals/);
 assert.throws(()=>AssetAmount.parse({...asset,identifier:""},"1"),/identifier/);
});

const classic={network:'testnet',kind:'stellar-classic',identifier:'native',decimals:7};
test('classic and Soroban enforce their separate integer limits',()=>{
 assert.equal(new AssetAmount(classic,(1n<<63n)-1n).minorUnits,(1n<<63n)-1n);
 assert.throws(()=>new AssetAmount(classic,1n<<63n),/range/);
 assert.equal(new AssetAmount(asset,(1n<<127n)-1n).minorUnits,(1n<<127n)-1n);
 assert.throws(()=>new AssetAmount(asset,1n<<127n),/range/);
 assert.throws(()=>AssetAmount.parse({...classic,decimals:6},'1'),/precision/);
});
test('exact arithmetic detects overflow and formatting round trips',()=>{
 const max=new AssetAmount(classic,(1n<<63n)-1n);
 assert.throws(()=>max.add(new AssetAmount(classic,1n)),/range/);
 for(let i=0n;i<1000n;i++){
  const amount=new AssetAmount(classic,i*i*12345n);
  assert.equal(AssetAmount.parse(classic,amount.format()).minorUnits,amount.minorUnits);
 }
});
