# Exact asset values

Use decimal strings at API boundaries and bigint minor units internally; never convert financial values to JavaScript numbers. An amount is bound to its network, token kind, identifier and verified scale. Classic Stellar assets have seven fractional digits and signed 64-bit representational bounds; Soroban contract tokens declare their own decimals and use signed 128-bit bounds. These bounds do not establish that a token or transfer is actually supported.

Parsing rejects scientific notation, commas, negatives, excess decimals and overflowing amounts rather than rounding. Formatting removes insignificant trailing zeros; comparisons and arithmetic fail on different assets, scales or networks. There is no implicit FX conversion and no signed transaction API. Identifiers must be obtained from separately authenticated contract/issuer metadata; basic syntax validation does not prove authenticity.
