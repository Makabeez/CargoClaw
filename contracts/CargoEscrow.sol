// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  CargoEscrow
 * @author Makabeez (Geiserjoe) — Ignyte Stablecoins Commerce Stack Challenge
 * @notice Milestone-based USDC escrow for SME freight settlement on Circle Arc.
 *
 *  Roles are deliberately separated so no single party both pays and releases:
 *    - sender   (buyer / importer)  : creates and funds the escrow
 *    - carrier  (freight provider)  : receives settlement on confirmed delivery
 *    - arbiter  (CargoClaw agent)   : the autonomous agent that confirms delivery
 *                                     or resolves a dispute. Set explicitly at
 *                                     deploy time to the agent's Circle wallet.
 *
 *  Safety properties:
 *    - Funds are never locked forever: after `deadline` an unconfirmed, funded
 *      shipment can be refunded to the sender by anyone (permissionless rescue).
 *    - Release happens at most once (status state machine + reentrancy guard).
 *    - The arbiter can never move funds anywhere except to the named carrier
 *      (release) or back to the sender (refund on dispute). It has no withdraw.
 */
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract CargoEscrow {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------
    enum Status {
        None,       // 0 - never created
        Pending,    // 1 - created, awaiting funding
        InTransit,  // 2 - funded, escrow holds USDC
        Delivered,  // 3 - released to carrier (terminal)
        Refunded,   // 4 - returned to sender (terminal)
        Disputed    // 5 - flagged, awaiting arbiter resolution
    }

    struct Shipment {
        address sender;
        address carrier;
        uint256 amount;     // USDC, 6 decimals
        uint64  deadline;   // unix seconds; refundable after this if not delivered
        Status  status;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------
    address public immutable arbiterAgent; // the CargoClaw autonomous agent
    IERC20  public immutable usdcToken;

    mapping(bytes32 => Shipment) public shipments;

    uint256 private _locked = 1; // reentrancy guard (1 = unlocked, 2 = locked)

    // ---------------------------------------------------------------------
    // Events  (rich, indexed — the agent and the UI read these as proof)
    // ---------------------------------------------------------------------
    event ShipmentCreated(bytes32 indexed shipmentId, address indexed sender, address indexed carrier, uint256 amount, uint64 deadline);
    event EscrowFunded(bytes32 indexed shipmentId, uint256 amount);
    event ShipmentDelivered(bytes32 indexed shipmentId, address indexed carrier, uint256 amountReleased);
    event ShipmentRefunded(bytes32 indexed shipmentId, address indexed sender, uint256 amountReturned);
    event ShipmentDisputed(bytes32 indexed shipmentId, address indexed raisedBy);

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------
    modifier onlyAgent() {
        require(msg.sender == arbiterAgent, "CargoEscrow: caller is not the agent");
        _;
    }

    modifier nonReentrant() {
        require(_locked == 1, "CargoEscrow: reentrant call");
        _locked = 2;
        _;
        _locked = 1;
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------
    /**
     * @param _usdcToken    USDC token address on Arc.
     * @param _arbiterAgent The CargoClaw agent wallet (a Circle developer-controlled
     *                      wallet). Passed explicitly so the contract can be deployed
     *                      from any address while the agent role stays with Circle.
     */
    constructor(address _usdcToken, address _arbiterAgent) {
        require(_usdcToken != address(0) && _arbiterAgent != address(0), "CargoEscrow: zero address");
        usdcToken    = IERC20(_usdcToken);
        arbiterAgent = _arbiterAgent;
    }

    // ---------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------

    /// @notice Buyer registers a shipment and the price the carrier will be paid.
    function createShipment(
        bytes32 _shipmentId,
        address _carrier,
        uint256 _amount,
        uint64  _deadline
    ) external {
        require(shipments[_shipmentId].status == Status.None, "CargoEscrow: shipment exists");
        require(_carrier != address(0), "CargoEscrow: zero carrier");
        require(_amount > 0, "CargoEscrow: zero amount");
        require(_deadline > block.timestamp, "CargoEscrow: deadline in past");

        shipments[_shipmentId] = Shipment({
            sender:   msg.sender,
            carrier:  _carrier,
            amount:   _amount,
            deadline: _deadline,
            status:   Status.Pending
        });

        emit ShipmentCreated(_shipmentId, msg.sender, _carrier, _amount, _deadline);
    }

    /// @notice Buyer funds the escrow. Requires prior USDC approval to this contract.
    function fundEscrow(bytes32 _shipmentId) external nonReentrant {
        Shipment storage s = shipments[_shipmentId];
        require(s.status == Status.Pending, "CargoEscrow: not fundable");
        require(msg.sender == s.sender, "CargoEscrow: only sender funds");

        s.status = Status.InTransit;
        require(usdcToken.transferFrom(msg.sender, address(this), s.amount), "CargoEscrow: USDC pull failed");

        emit EscrowFunded(_shipmentId, s.amount);
    }

    /// @notice Agent confirms verified delivery and releases USDC to the carrier.
    /// @dev    Only the autonomous agent may call. Effects-before-interactions + guard.
    function confirmDelivery(bytes32 _shipmentId) external onlyAgent nonReentrant {
        Shipment storage s = shipments[_shipmentId];
        require(s.status == Status.InTransit, "CargoEscrow: not in transit");

        uint256 amount = s.amount;
        address carrier = s.carrier;
        s.status = Status.Delivered;

        require(usdcToken.transfer(carrier, amount), "CargoEscrow: settlement failed");
        emit ShipmentDelivered(_shipmentId, carrier, amount);
    }

    /// @notice Sender or agent flags a shipment for arbiter resolution.
    function raiseDispute(bytes32 _shipmentId) external {
        Shipment storage s = shipments[_shipmentId];
        require(s.status == Status.InTransit, "CargoEscrow: not disputable");
        require(msg.sender == s.sender || msg.sender == arbiterAgent, "CargoEscrow: not a party");

        s.status = Status.Disputed;
        emit ShipmentDisputed(_shipmentId, msg.sender);
    }

    /// @notice Agent resolves a dispute: true = pay carrier, false = refund sender.
    function resolveDispute(bytes32 _shipmentId, bool releaseToCarrier) external onlyAgent nonReentrant {
        Shipment storage s = shipments[_shipmentId];
        require(s.status == Status.Disputed, "CargoEscrow: not disputed");

        uint256 amount = s.amount;
        if (releaseToCarrier) {
            address carrier = s.carrier;
            s.status = Status.Delivered;
            require(usdcToken.transfer(carrier, amount), "CargoEscrow: settlement failed");
            emit ShipmentDelivered(_shipmentId, carrier, amount);
        } else {
            address sender = s.sender;
            s.status = Status.Refunded;
            require(usdcToken.transfer(sender, amount), "CargoEscrow: refund failed");
            emit ShipmentRefunded(_shipmentId, sender, amount);
        }
    }

    /// @notice Permissionless rescue: after the deadline, a funded-but-undelivered
    ///         shipment can always be refunded to the sender. Funds are never stuck.
    function refundExpired(bytes32 _shipmentId) external nonReentrant {
        Shipment storage s = shipments[_shipmentId];
        require(s.status == Status.InTransit || s.status == Status.Disputed, "CargoEscrow: not refundable");
        require(block.timestamp > s.deadline, "CargoEscrow: not expired");

        uint256 amount = s.amount;
        address sender = s.sender;
        s.status = Status.Refunded;

        require(usdcToken.transfer(sender, amount), "CargoEscrow: refund failed");
        emit ShipmentRefunded(_shipmentId, sender, amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------
    function getShipment(bytes32 _shipmentId)
        external
        view
        returns (address sender, address carrier, uint256 amount, uint64 deadline, Status status)
    {
        Shipment storage s = shipments[_shipmentId];
        return (s.sender, s.carrier, s.amount, s.deadline, s.status);
    }

    function escrowBalance() external view returns (uint256) {
        return usdcToken.balanceOf(address(this));
    }
}
