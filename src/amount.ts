/**
 * Exact amount arithmetic for a single on-chain asset. No FX rates, fiat
 * assumptions, or JavaScript floating point in this module.
 */
export interface AssetIdentity {
  readonly network: "testnet";
  readonly kind: "stellar-classic" | "soroban-token";
  /** Canonical, verified asset identifier supplied by its integrating system. */
  readonly identifier: string;
  /** Actual decimals reported for this asset or contract. */
  readonly decimals: number;
}
export class AmountError extends Error {
  constructor(message: string) { super(message); this.name = "AmountError"; }
}
export function assertAsset(asset: AssetIdentity): AssetIdentity {
  if (asset.network !== "testnet" || !["stellar-classic","soroban-token"].includes(asset.kind))
    throw new AmountError("Unsupported asset network or kind");
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(asset.identifier))
    throw new AmountError("Asset identifier must be validated and nonempty");
  if (!Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 38)
    throw new AmountError("Asset decimals must be an integer between 0 and 38");
  if (asset.kind === "stellar-classic" && asset.decimals !== 7) throw new AmountError("Classic Stellar precision must be 7");
  return Object.freeze({...asset});
}
function sameAsset(a:AssetIdentity,b:AssetIdentity):boolean {
  return a.network===b.network && a.kind===b.kind &&
    a.identifier===b.identifier && a.decimals===b.decimals;
}
const CLASSIC_MAX = (1n << 63n) - 1n;
const SOROBAN_MAX = (1n << 127n) - 1n;
function units(value:bigint, asset:AssetIdentity):bigint {
  if(value<0n)throw new AmountError("Negative transfer amounts are not supported");
  // Arbitrary high values are not implicitly legal for any Stellar token.
  if(value > (asset.kind === "stellar-classic" ? CLASSIC_MAX : SOROBAN_MAX)) throw new AmountError("Amount exceeds on-chain integer range");
  return value;
}
/** Never accepts a number: callers must supply decimal strings or bigint units. */
export class AssetAmount {
  readonly asset: AssetIdentity;
  readonly minorUnits: bigint;
  constructor(asset:AssetIdentity, minorUnits:bigint) {
    this.asset=assertAsset(asset);
    if(typeof minorUnits!=="bigint") throw new AmountError("Minor units must be bigint");
    this.minorUnits=units(minorUnits,this.asset);
    Object.freeze(this);
  }
  static parse(asset:AssetIdentity, input:string):AssetAmount {
    const verified=assertAsset(asset);
    if(typeof input!=="string" || input.length>128 || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(input))
      throw new AmountError("Expected unsigned plain decimal string with no separators");
    if(input.length>170) throw new AmountError("Decimal input too long");
    const [whole,fraction=""]=input.split(".");
    if(fraction.length>verified.decimals) throw new AmountError("Input exceeds asset precision");
    const base=10n**BigInt(verified.decimals);
    const integer=BigInt(whole)*base;
    const decimal=fraction.length?BigInt(fraction.padEnd(verified.decimals,"0")):0n;
    return new AssetAmount(verified,integer+decimal);
  }
  format():string {
    const base=10n**BigInt(this.asset.decimals);
    const whole=(this.minorUnits/base).toString();
    const rest=(this.minorUnits%base).toString().padStart(this.asset.decimals,"0")
      .replace(/0+$/,"");
    return rest?whole+"."+rest:whole;
  }
  add(other:AssetAmount):AssetAmount {
    if(!sameAsset(this.asset,other.asset))throw new AmountError("Asset identity mismatch");
    return new AssetAmount(this.asset,this.minorUnits+other.minorUnits);
  }
  subtract(other:AssetAmount):AssetAmount {
    if(!sameAsset(this.asset,other.asset))throw new AmountError("Asset identity mismatch");
    return new AssetAmount(this.asset,units(this.minorUnits-other.minorUnits,this.asset));
  }
  compare(other:AssetAmount): -1 | 0 | 1 {
    if(!sameAsset(this.asset,other.asset))throw new AmountError("Asset identity mismatch");
    return this.minorUnits<other.minorUnits?-1:this.minorUnits>other.minorUnits?1:0;
  }
  toJSON():{asset:AssetIdentity;minorUnits:string} {
    return {asset:this.asset,minorUnits:this.minorUnits.toString()};
  }
}
