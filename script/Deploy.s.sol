// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CargoEscrow} from "../contracts/CargoEscrow.sol";

/**
 * Deploys CargoEscrow on Arc Testnet.
 *
 * Reads from env:
 *   DEPLOYER_PRIVATE_KEY  one-time throwaway key, funded with Arc USDC for gas.
 *                         NOT the agent's signing key — the agent uses Circle MPC.
 *   USDC_ADDRESS          0x3600000000000000000000000000000000000000 (Arc USDC ERC-20)
 *   AGENT_WALLET_ADDRESS  the Circle developer-controlled wallet that acts as arbiter.
 *
 * Run:
 *   forge script script/Deploy.s.sol:Deploy \
 *     --rpc-url $ARC_RPC_URL --broadcast \
 *     --verify --verifier sourcify
 */
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address agent = vm.envAddress("AGENT_WALLET_ADDRESS");

        require(usdc != address(0) && agent != address(0), "set USDC_ADDRESS and AGENT_WALLET_ADDRESS");

        vm.startBroadcast(pk);
        CargoEscrow escrow = new CargoEscrow(usdc, agent);
        vm.stopBroadcast();

        console2.log("CargoEscrow deployed at:", address(escrow));
        console2.log("  USDC token:  ", usdc);
        console2.log("  arbiterAgent:", agent);
    }
}
