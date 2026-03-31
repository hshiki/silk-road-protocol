/// Silk Road Protocol — Decentralised Gate Network Protocol
///
/// Contributors lock a GateCap in the FoundationTreasury, receive SRP_Share tokens,
/// and earn uptime rewards + dividends from transit toll revenue.

module silk_road::silk_road {

    use std::string;
    use sui::{
        balance::{Self, Balance},
        clock::Clock,
        coin::{Self, Coin},
        event,
        table::{Self, Table},
    };
    use assets::EVE::EVE;
    use sui::transfer::Receiving;
    use world::{
        access::{Self, OwnerCap},
        character::{Self, Character},
        energy::EnergyConfig,
        gate::{Self, Gate},
        network_node::{Self, NetworkNode},
    };

    // =========================================================================
    // Constants
    // =========================================================================

    /// Precision multiplier for the F1 dividend accumulator.
    const PRECISION: u128 = 1_000_000_000;

    // Default protocol parameters — all admin-adjustable post-deployment.
    const DEFAULT_TOLL:                  u64 = 1_000_000_000; // 1 EVE (9 decimals) per single-use trip
    const DEFAULT_DISCOUNT_BPS:          u64 = 8_000;         // prepaid users pay 80 %
    const DEFAULT_DIV_SPLIT_BPS:         u64 = 7_500;         // 75 % of toll → dividends
    const DEFAULT_UPTIME_REWARD_PER_MS:  u64 = 1;             // base units per ms; tune once economy matures
    const DEFAULT_SHARES_PER_GATE:       u64 = 1_000;         // shares minted per submitted gate
    const DEFAULT_PERMIT_TTL_MS:         u64 = 9_999_999_999_999; // effectively permanent (~317 years)

    // Bulk transit discount tiers.
    const BULK_QTY_10:    u64 = 10;
    const BULK_QTY_100:   u64 = 100;
    const BULK_PRICE_10:  u64 = 9_000_000_000;   // 9 EVE for 10 permits (10% off)
    const BULK_PRICE_100: u64 = 80_000_000_000;  // 80 EVE for 100 permits (20% off)

    // =========================================================================
    // Errors
    // =========================================================================

    const EInsufficientPayment: u64 = 0;
    const ENoAccount:           u64 = 1;
    const EInsufficientBalance: u64 = 2;
    const ETransferDisabled:    u64 = 3;
    const EBadBps:              u64 = 4;
    const EGateNotRegistered:   u64 = 5;
    const ENodeMismatch:        u64 = 6;
    const EGateOffline:         u64 = 7;
    const ENodeOffline:         u64 = 8;
    const EGateNoEnergySource:  u64 = 9;
    const EInvalidBulkQuantity: u64 = 10;

    // =========================================================================
    // Structs
    // =========================================================================

    /// Typed witness — proof-of-authority for `gate::issue_jump_permit<SilkRoadAuth>`.
    public struct SilkRoadAuth has drop {}

    /// Singleton admin capability (deployer). Guards all parameter-mutation functions.
    public struct AdminCap has key { id: UID }

    /// Share certificate. Transfer gated by `shares_transferable` flag.
    public struct SRP_Share has key {
        id: UID,
        shares: u64,
        /// F1 debt baseline — prevents claiming dividends accrued before issuance.
        reward_debt: u128,
    }

    /// Shared object — single source of truth for all protocol state.
    public struct FoundationTreasury has key {
        id: UID,

        // Prepaid transit accounts
        prepaid_escrow:   Balance<EVE>,     // EVE held in escrow
        prepaid_accounts: Table<address, u64>, // address → credited amount

        // Revenue pools
        dividend_pool:      Balance<EVE>,
        uptime_reward_pool: Balance<EVE>,

        // F1 dividend state
        global_reward_per_share: u128, // accumulator × PRECISION
        total_shares_issued:     u64,

        // Gate registry
        gate_contributors:   Table<ID, address>, // gate_id → contributor
        gate_last_reward_at: Table<ID, u64>,     // gate_id → last claim ms

        // Protocol parameters (admin-adjustable)
        base_toll_fee:        u64,
        discount_bps:         u64,
        div_split_bps:        u64, // toll fraction → dividend_pool; remainder → uptime pool
        uptime_reward_per_ms: u64,
        shares_per_gate:      u64,
        permit_ttl_ms:        u64,

        shares_transferable: bool, // default false; flip via set_shares_transferable
    }

    // =========================================================================
    // Events
    // =========================================================================

    public struct GateAssimilatedEvent has copy, drop {
        gate_id:         ID,
        /// Derived from gate::energy_source_id at assimilation time.
        network_node_id: ID,
        submitter:       address,
        shares_minted:   u64,
    }

    public struct TransitPermitIssuedEvent has copy, drop {
        source_gate_id:      ID,
        destination_gate_id: ID,
        payer:               address,
        toll_paid:           u64,
        prepaid:             bool,
    }

    public struct UptimeRewardClaimedEvent has copy, drop {
        gate_id:      ID,
        node_id:      ID,
        contributor:  address,
        elapsed_ms:   u64,
        reward_paid:  u64,
    }

    public struct DividendClaimedEvent has copy, drop {
        claimer: address,
        amount:  u64,
    }

    public struct GateBroughtOnlineEvent has copy, drop {
        gate_id:      ID,
        node_id:      ID,
        triggered_by: address,
    }

    // =========================================================================
    // Initialisation
    // =========================================================================

    fun init(ctx: &mut TxContext) {
        let deployer = ctx.sender();

        transfer::transfer(AdminCap { id: object::new(ctx) }, deployer);

        transfer::share_object(FoundationTreasury {
            id:                      object::new(ctx),
            prepaid_escrow:          balance::zero(),
            prepaid_accounts:        table::new(ctx),
            dividend_pool:           balance::zero(),
            uptime_reward_pool:      balance::zero(),
            global_reward_per_share: 0,
            total_shares_issued:     0,
            gate_contributors:       table::new(ctx),
            gate_last_reward_at:     table::new(ctx),
            base_toll_fee:           DEFAULT_TOLL,
            discount_bps:            DEFAULT_DISCOUNT_BPS,
            div_split_bps:           DEFAULT_DIV_SPLIT_BPS,
            uptime_reward_per_ms:    DEFAULT_UPTIME_REWARD_PER_MS,
            shares_per_gate:         DEFAULT_SHARES_PER_GATE,
            permit_ttl_ms:           DEFAULT_PERMIT_TTL_MS,
            shares_transferable:     false,
        });
    }

    // =========================================================================
    // Gate Management
    // =========================================================================

    /// Lock a GateCap in the treasury, register the gate, and mint SRP_Share to the caller.
    /// PTB: transfer_owner_cap(gate_cap, treasury_addr) → assimilate_gate(...).
    public fun assimilate_gate(
        treasury:  &mut FoundationTreasury,
        gate_obj:  &mut Gate,
        gate_cap:  OwnerCap<Gate>,
        clock:     &Clock,
        ctx:       &mut TxContext,
    ) {
        let treasury_addr = object::id_address(treasury);
        let gate_id = gate::id(gate_obj);

        // energy_source_id is the on-chain ground truth for the powering node.
        let energy_source_opt = gate::energy_source_id(gate_obj);
        assert!(option::is_some(energy_source_opt), EGateNoEnergySource);
        let node_id = *option::borrow(energy_source_opt);

        // Register SilkRoadAuth and immediately freeze the extension config.
        // After freeze_extension_config the gate is permanently bound to Silk Road
        // rules — the OwnerCap cannot override this.
        gate::authorize_extension<SilkRoadAuth>(gate_obj, &gate_cap);
        gate::freeze_extension_config(gate_obj, &gate_cap);
        gate::update_metadata_name(gate_obj, &gate_cap, string::utf8(b"SRP Gate"));

        // Park the GateCap inside the treasury.
        access::transfer_owner_cap(gate_cap, treasury_addr);

        // Register for uptime rewards.
        let submitter = ctx.sender();
        table::add(&mut treasury.gate_contributors, gate_id, submitter);
        table::add(&mut treasury.gate_last_reward_at, gate_id, clock.timestamp_ms());

        // Reward the contributor with protocol shares.
        let shares = treasury.shares_per_gate;
        mint_shares_to(treasury, shares, submitter, ctx);

        event::emit(GateAssimilatedEvent {
            gate_id,
            network_node_id: node_id,
            submitter,
            shares_minted: shares,
        });
    }

    /// Assimilate a gate whose GateCap is held inside a Character object.
    ///
    /// Standard entry point for in-game dApp use.
    /// Borrow-use-receipt is handled atomically inside this function.
    public fun assimilate_gate_from_character(
        treasury:         &mut FoundationTreasury,
        gate_obj:         &mut Gate,
        character:        &mut Character,
        gate_cap_receive: Receiving<OwnerCap<Gate>>,
        clock:            &Clock,
        ctx:              &mut TxContext,
    ) {
        let treasury_addr = object::id_address(treasury);

        // Borrow GateCap from Character — enforces character_address == ctx.sender().
        let (gate_cap, receipt) = character::borrow_owner_cap<Gate>(character, gate_cap_receive, ctx);

        let gate_id = gate::id(gate_obj);
        let energy_source_opt = gate::energy_source_id(gate_obj);
        assert!(option::is_some(energy_source_opt), EGateNoEnergySource);
        let node_id = *option::borrow(energy_source_opt);

        // Permanently bind Silk Road extension.
        gate::authorize_extension<SilkRoadAuth>(gate_obj, &gate_cap);
        gate::freeze_extension_config(gate_obj, &gate_cap);
        gate::update_metadata_name(gate_obj, &gate_cap, string::utf8(b"SRP Gate"));

        // Transfer GateCap to treasury, consuming the receipt atomically.
        access::transfer_owner_cap_with_receipt(gate_cap, receipt, treasury_addr, ctx);

        // Register contributor and mint shares.
        let submitter = ctx.sender();
        table::add(&mut treasury.gate_contributors, gate_id, submitter);
        table::add(&mut treasury.gate_last_reward_at, gate_id, clock.timestamp_ms());
        let shares = treasury.shares_per_gate;
        mint_shares_to(treasury, shares, submitter, ctx);

        event::emit(GateAssimilatedEvent {
            gate_id,
            network_node_id: node_id,
            submitter,
            shares_minted: shares,
        });
    }

    // =========================================================================
    // Transit — Toll Collection
    // =========================================================================

    /// Purchase a single-use JumpPermit at the full toll rate. Overpayment is refunded.
    #[allow(lint(self_transfer))]
    public fun buy_transit_permit(
        treasury:         &mut FoundationTreasury,
        source_gate:      &Gate,
        destination_gate: &Gate,
        character:        &Character,
        payment:          Coin<EVE>,
        clock:            &Clock,
        ctx:              &mut TxContext,
    ) {
        let sender = ctx.sender();
        let toll   = treasury.base_toll_fee;
        assert!(coin::value(&payment) >= toll, EInsufficientPayment);

        let mut bal = coin::into_balance(payment);

        let paid = balance::value(&bal);
        if (paid > toll) {
            let change = balance::split(&mut bal, paid - toll);
            transfer::public_transfer(coin::from_balance(change, ctx), sender);
        };
        split_and_pool(treasury, bal, toll);
        do_issue_permit(treasury, source_gate, destination_gate, character, clock, ctx);

        event::emit(TransitPermitIssuedEvent {
            source_gate_id:      gate::id(source_gate),
            destination_gate_id: gate::id(destination_gate),
            payer:               sender,
            toll_paid:           toll,
            prepaid:             false,
        });
    }

    /// Purchase JumpPermits in bulk (10 → 9 EVE, 100 → 80 EVE). Overpayment is refunded.
    #[allow(lint(self_transfer))]
    public fun buy_transit_permit_bulk(
        treasury:         &mut FoundationTreasury,
        source_gate:      &Gate,
        destination_gate: &Gate,
        character:        &Character,
        payment:          Coin<EVE>,
        quantity:         u64,
        clock:            &Clock,
        ctx:              &mut TxContext,
    ) {
        assert!(
            quantity == BULK_QTY_10 || quantity == BULK_QTY_100,
            EInvalidBulkQuantity,
        );
        let total_price = if (quantity == BULK_QTY_10) { BULK_PRICE_10 } else { BULK_PRICE_100 };

        let sender = ctx.sender();
        assert!(coin::value(&payment) >= total_price, EInsufficientPayment);

        let mut bal = coin::into_balance(payment);
        let paid = balance::value(&bal);
        if (paid > total_price) {
            let change = balance::split(&mut bal, paid - total_price);
            transfer::public_transfer(coin::from_balance(change, ctx), sender);
        };

        let per_permit = total_price / quantity;
        let mut i = 0;
        while (i < quantity - 1) {
            let permit_bal = balance::split(&mut bal, per_permit);
            split_and_pool(treasury, permit_bal, per_permit);
            do_issue_permit(treasury, source_gate, destination_gate, character, clock, ctx);
            i = i + 1;
        };
        // Last permit absorbs rounding dust.
        let last_amount = balance::value(&bal);
        split_and_pool(treasury, bal, last_amount);
        do_issue_permit(treasury, source_gate, destination_gate, character, clock, ctx);

        event::emit(TransitPermitIssuedEvent {
            source_gate_id:      gate::id(source_gate),
            destination_gate_id: gate::id(destination_gate),
            payer:               sender,
            toll_paid:           total_price,
            prepaid:             false,
        });
    }

    /// Purchase a JumpPermit at the prepaid discount rate. Requires a funded prepaid account.
    public fun buy_transit_permit_prepaid(
        treasury:         &mut FoundationTreasury,
        source_gate:      &Gate,
        destination_gate: &Gate,
        character:        &Character,
        clock:            &Clock,
        ctx:              &mut TxContext,
    ) {
        let sender     = ctx.sender();
        let discounted = calc_discounted_toll(treasury);

        assert!(table::contains(&treasury.prepaid_accounts, sender), ENoAccount);
        let acct = table::borrow_mut(&mut treasury.prepaid_accounts, sender);
        assert!(*acct >= discounted, EInsufficientBalance);
        *acct = *acct - discounted;

        let toll_bal = balance::split(&mut treasury.prepaid_escrow, discounted);
        split_and_pool(treasury, toll_bal, discounted);

        do_issue_permit(treasury, source_gate, destination_gate, character, clock, ctx);

        event::emit(TransitPermitIssuedEvent {
            source_gate_id:      gate::id(source_gate),
            destination_gate_id: gate::id(destination_gate),
            payer:               sender,
            toll_paid:           discounted,
            prepaid:             true,
        });
    }

    /// Deposit EVE into a personal prepaid account for discounted tolls. No expiry.
    public fun recharge_account(
        treasury: &mut FoundationTreasury,
        payment:  Coin<EVE>,
        ctx:      &mut TxContext,
    ) {
        let sender = ctx.sender();
        let amount = coin::value(&payment);
        balance::join(&mut treasury.prepaid_escrow, coin::into_balance(payment));

        if (table::contains(&treasury.prepaid_accounts, sender)) {
            let bal = table::borrow_mut(&mut treasury.prepaid_accounts, sender);
            *bal = *bal + amount;
        } else {
            table::add(&mut treasury.prepaid_accounts, sender, amount);
        };
    }

    // =========================================================================
    // Gate Online Recovery
    // =========================================================================

    /// Re-online a registered gate after node fuel recovery. Resets uptime clock.
    /// Anyone may call (contributor or keeper bot).
    public fun bring_gate_online(
        treasury:         &mut FoundationTreasury,
        gate_obj:         &mut Gate,
        node_obj:         &mut NetworkNode,
        energy_config:    &EnergyConfig,
        gate_cap_receive: Receiving<OwnerCap<Gate>>,
        clock:            &Clock,
        ctx:              &mut TxContext,
    ) {
        let gate_id = gate::id(gate_obj);
        assert!(table::contains(&treasury.gate_contributors, gate_id), EGateNotRegistered);

        let gate_cap = access::receive_owner_cap(&mut treasury.id, gate_cap_receive);
        gate::online(gate_obj, node_obj, energy_config, &gate_cap);

        let treasury_addr = object::id_address(treasury);
        access::transfer_owner_cap(gate_cap, treasury_addr);

        let now = clock.timestamp_ms();
        *table::borrow_mut(&mut treasury.gate_last_reward_at, gate_id) = now;

        event::emit(GateBroughtOnlineEvent {
            gate_id,
            node_id:      object::id(node_obj),
            triggered_by: ctx.sender(),
        });
    }

    // =========================================================================
    // Uptime Rewards
    // =========================================================================

    /// Claim uptime rewards for a registered gate. Both gate and node must be online.
    /// Payout goes to the registered contributor. Anyone may call (keeper-friendly).
    public fun claim_uptime_reward(
        treasury: &mut FoundationTreasury,
        gate_obj: &Gate,
        node_obj: &NetworkNode,
        clock:    &Clock,
        ctx:      &mut TxContext,
    ) {
        let gate_id = gate::id(gate_obj);

        assert!(table::contains(&treasury.gate_contributors, gate_id), EGateNotRegistered);
        assert!(
            option::contains(gate::energy_source_id(gate_obj), &object::id(node_obj)),
            ENodeMismatch,
        );
        assert!(gate::is_online(gate_obj), EGateOffline);
        assert!(network_node::is_network_node_online(node_obj), ENodeOffline);

        let now  = clock.timestamp_ms();
        let last = *table::borrow(&treasury.gate_last_reward_at, gate_id);
        let elapsed_ms = now - last;

        if (elapsed_ms == 0) { return };

        let reward = elapsed_ms * treasury.uptime_reward_per_ms;
        let available = balance::value(&treasury.uptime_reward_pool);

        let payout = if (reward <= available) { reward } else { available };
        if (payout == 0) { return };

        // Advance clock even on partial payout — no re-claiming the same window.
        *table::borrow_mut(&mut treasury.gate_last_reward_at, gate_id) = now;

        let contributor = *table::borrow(&treasury.gate_contributors, gate_id);
        let reward_coin = coin::from_balance(
            balance::split(&mut treasury.uptime_reward_pool, payout), ctx,
        );
        transfer::public_transfer(reward_coin, contributor);

        event::emit(UptimeRewardClaimedEvent {
            gate_id,
            node_id:     object::id(node_obj),
            contributor,
            elapsed_ms,
            reward_paid: payout,
        });

        let _ = ctx; // suppress unused warning
    }

    // =========================================================================
    // Dividend Claiming
    // =========================================================================

    /// Withdraw accumulated dividends for an SRP_Share (F1 algorithm). Idempotent.
    #[allow(lint(self_transfer))]
    public fun claim_dividend(
        treasury: &mut FoundationTreasury,
        share:    &mut SRP_Share,
        ctx:      &mut TxContext,
    ) {
        let amount = claimable_dividend(treasury, share);
        if (amount == 0) { return };

        share.reward_debt = (share.shares as u128) * treasury.global_reward_per_share;

        let payout  = coin::from_balance(
            balance::split(&mut treasury.dividend_pool, amount), ctx,
        );
        let claimer = ctx.sender();
        transfer::public_transfer(payout, claimer);

        event::emit(DividendClaimedEvent { claimer, amount });
    }

    // =========================================================================
    // Admin
    // =========================================================================

    public fun admin_transfer_cap(cap: AdminCap, recipient: address) {
        transfer::transfer(cap, recipient);
    }

    public fun set_toll_fee(
        _: &AdminCap, t: &mut FoundationTreasury, fee: u64,
    ) { t.base_toll_fee = fee; }

    public fun set_discount_bps(
        _: &AdminCap, t: &mut FoundationTreasury, bps: u64,
    ) { assert!(bps <= 10_000, EBadBps); t.discount_bps = bps; }

    public fun set_div_split_bps(
        _: &AdminCap, t: &mut FoundationTreasury, bps: u64,
    ) { assert!(bps <= 10_000, EBadBps); t.div_split_bps = bps; }

    public fun set_uptime_reward_per_ms(
        _: &AdminCap, t: &mut FoundationTreasury, rate: u64,
    ) { t.uptime_reward_per_ms = rate; }

    public fun set_shares_per_gate(
        _: &AdminCap, t: &mut FoundationTreasury, shares: u64,
    ) { t.shares_per_gate = shares; }

    public fun set_permit_ttl_ms(
        _: &AdminCap, t: &mut FoundationTreasury, ttl: u64,
    ) { t.permit_ttl_ms = ttl; }

    public fun set_shares_transferable(
        _: &AdminCap, t: &mut FoundationTreasury, enabled: bool,
    ) { t.shares_transferable = enabled; }

    /// Transfer a share certificate. Resets recipient's reward_debt to current accumulator.
    public fun transfer_shares(
        t:         &FoundationTreasury,
        mut share: SRP_Share,
        recipient: address,
    ) {
        assert!(t.shares_transferable, ETransferDisabled);
        share.reward_debt = (share.shares as u128) * t.global_reward_per_share;
        transfer::transfer(share, recipient);
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    public fun claimable_dividend(t: &FoundationTreasury, s: &SRP_Share): u64 {
        let gross = (s.shares as u128) * t.global_reward_per_share;
        if (gross <= s.reward_debt) { return 0 };
        ((gross - s.reward_debt) / PRECISION) as u64
    }

    public fun prepaid_balance(t: &FoundationTreasury, addr: address): u64 {
        if (table::contains(&t.prepaid_accounts, addr)) {
            *table::borrow(&t.prepaid_accounts, addr)
        } else { 0 }
    }

    public fun pending_uptime_reward(
        t:        &FoundationTreasury,
        gate_obj: &Gate,
        node_obj: &NetworkNode,
        clock:    &Clock,
    ): u64 {
        let gate_id = gate::id(gate_obj);
        if (!table::contains(&t.gate_contributors, gate_id)) { return 0 };
        if (!option::contains(gate::energy_source_id(gate_obj), &object::id(node_obj))) {
            return 0
        };
        if (!gate::is_online(gate_obj)) { return 0 };
        if (!network_node::is_network_node_online(node_obj)) { return 0 };

        let last      = *table::borrow(&t.gate_last_reward_at, gate_id);
        let elapsed   = clock.timestamp_ms() - last;
        let reward    = elapsed * t.uptime_reward_per_ms;
        let available = balance::value(&t.uptime_reward_pool);
        if (reward <= available) { reward } else { available }
    }

    public fun gate_contributor(t: &FoundationTreasury, gate_id: ID): address {
        *table::borrow(&t.gate_contributors, gate_id)
    }

    public fun gate_last_reward_at(t: &FoundationTreasury, gate_id: ID): u64 {
        *table::borrow(&t.gate_last_reward_at, gate_id)
    }

    public fun share_count(s: &SRP_Share): u64 { s.shares }

    public fun total_shares_issued(t: &FoundationTreasury): u64 { t.total_shares_issued }

    public fun base_toll_fee(t: &FoundationTreasury): u64 { t.base_toll_fee }

    public fun discounted_toll(t: &FoundationTreasury): u64 { calc_discounted_toll(t) }

    // =========================================================================
    // Internal Helpers
    // =========================================================================

    fun split_and_pool(
        t:       &mut FoundationTreasury,
        mut bal: Balance<EVE>,
        toll:    u64,
    ) {
        let uptime_cut = (toll as u128 * (10_000 - t.div_split_bps as u128) / 10_000) as u64;
        let div_cut    = toll - uptime_cut;

        if (uptime_cut > 0) {
            balance::join(&mut t.uptime_reward_pool, balance::split(&mut bal, uptime_cut));
        };
        balance::join(&mut t.dividend_pool, bal);

        if (t.total_shares_issued > 0 && div_cut > 0) {
            t.global_reward_per_share = t.global_reward_per_share +
                (div_cut as u128) * PRECISION / (t.total_shares_issued as u128);
        };
    }

    fun do_issue_permit(
        t:                &FoundationTreasury,
        source_gate:      &Gate,
        destination_gate: &Gate,
        character:        &Character,
        clock:            &Clock,
        ctx:              &mut TxContext,
    ) {
        let expires_at = clock.timestamp_ms() + t.permit_ttl_ms;
        gate::issue_jump_permit<SilkRoadAuth>(
            source_gate,
            destination_gate,
            character,
            SilkRoadAuth {},
            expires_at,
            ctx,
        );
    }

    fun calc_discounted_toll(t: &FoundationTreasury): u64 {
        ((t.base_toll_fee as u128) * (t.discount_bps as u128) / 10_000) as u64
    }

    fun mint_shares_to(
        t:         &mut FoundationTreasury,
        shares:    u64,
        recipient: address,
        ctx:       &mut TxContext,
    ) {
        let reward_debt = (shares as u128) * t.global_reward_per_share;
        t.total_shares_issued = t.total_shares_issued + shares;
        transfer::transfer(
            SRP_Share { id: object::new(ctx), shares, reward_debt },
            recipient,
        );
    }
}
