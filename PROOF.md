# On-chain proof — CargoClaw on Arc Testnet

All transactions below are **live on Arc Testnet** (chain `5042002`), executed by
the CargoClaw autonomous agent through Circle Developer-Controlled Wallets. No raw
private keys were used for any signature — every call was signed via Circle MPC.

**Network:** Arc Testnet · chain `5042002`
**Explorer:** https://testnet.arcscan.app
**CargoEscrow contract:** [`0x3307CDA181bc306c6a7Be3848D46217052Aaa761`](https://testnet.arcscan.app/address/0x3307CDA181bc306c6a7Be3848D46217052Aaa761)
**Arbiter (agent wallet):** `0x9Ff0c1b46e57dE0603A5dE52920452A9dF03F3d8`
**USDC (Arc native, ERC-20 iface):** `0x3600000000000000000000000000000000000000`

---

## Flow A — verified delivery → RELEASE

Shipment `SHPMT-DXB-004` · 12 industrial pallets → **7.2 LDM**, 1 truck · 5 USDC
Carrier: `0x2f225F8A538e7fD613e8ba79DCDdC7D1422AEd1C`

| Step | Action | Tx |
|---|---|---|
| 1 | `createShipment` (buyer) | [`0xba9a0474…998709`](https://testnet.arcscan.app/tx/0xba9a047455ac76af7b1ff73782ec483cd3b47aecfe4f3da3b61bb23bac998709) |
| 2 | `approve` + `fundEscrow` (buyer) | [`0x08a3b6c4…9f79fb`](https://testnet.arcscan.app/tx/0x08a3b6c4a97fb3f18169635c2fbc0149a828200fa6577998820a995dc89f79fb) |
| 3 | agent verdict: **RELEASE** (verified, quantities match) | _off-chain reasoning_ |
| 4 | `confirmDelivery` (agent) → carrier paid 5 USDC | [`0xe11c0ffa…8c1235`](https://testnet.arcscan.app/tx/0xe11c0ffacefdb3f850ae64b895082eb965063add45eb00f90ac7f3edf98c1235) |

## Flow B — manifest mismatch → DISPUTE

Shipment `SHPMT-DXB-005` · 10 pallets → **4.8 LDM**, 1 truck · 3 USDC
Proof-of-delivery reported **7** pallets vs **10** on the manifest.

| Step | Action | Tx |
|---|---|---|
| 1 | `createShipment` (buyer) | [`0x8094c973…53baa`](https://testnet.arcscan.app/tx/0x8094c973214c6fda89634ceb8dbae8609bfa275321bc3b9bddedfa8c6fd53baa) |
| 2 | `approve` + `fundEscrow` (buyer) | [`0x4d952968…d15d4`](https://testnet.arcscan.app/tx/0x4d9529687131da0d40f4f11376d22f11270a862a005ef2d0c06eac55078d15d4) |
| 3 | agent verdict: **DISPUTE** ("expected 10 pallets, delivered 7") | _off-chain reasoning_ |
| 4 | `raiseDispute` (agent) → funds held, not released | [`0x8fa72e48…3d12ac`](https://testnet.arcscan.app/tx/0x8fa72e48dc6d248e850ada5836075ae88f21dbb7f6618e6b770b589b203d12ac) |

---

> The contrast between Flow A and Flow B is the point: the same agent, given two
> different proof-of-delivery events, autonomously releases payment in one case and
> withholds it in the other — enforcing the integrity invariant that USDC is only
> released against verified, matching delivery.
