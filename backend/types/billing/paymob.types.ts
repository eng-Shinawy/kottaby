/**
 * Paymob vendor DTOs — the provider's own wire shapes, mirrored with the
 * vendor's exact field names (snake_case) so a reviewer can diff this file
 * against the provider documentation key by key.
 *
 * These types live at the boundary only: gateway adapters translate them to
 * and from the camelCase domain contracts in `payment-gateway.types.ts`, and
 * nothing past the adapter ever reads a vendor field. Members the
 * integration never consumes are omitted on purpose — the vendor payloads
 * carry more keys than this integration reads, and every member here is one
 * the adapters, mappers, or verifiers actually touch.
 */

/**
 * The payer identity block of a checkout intention. The provider requires
 * first/last/email and rejects deliveries missing a phone number, so the
 * adapter boundary fills unknown members with the documented `"NA"`
 * placeholder convention — this type carries exactly the vendor's members.
 */
export interface PaymobBillingData {
  readonly apartment: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly street: string;
  readonly building: string;
  readonly phone_number: string;
  readonly city: string;
  readonly country: string;
  readonly email: string;
  readonly floor: string;
  readonly state: string;
}

/** One purchasable line item of a checkout intention. */
interface PaymobIntentionItem {
  readonly name: string;
  readonly amount: number;
  readonly description?: string;
  readonly quantity?: number;
}

/**
 * `POST v1/intention/` request body. Amounts are INTEGER cents; the
 * payment-method members are integer integration IDs; the
 * `special_reference` is the merchant-side correlation key the provider
 * echoes back on every callback as `order.merchant_order_id`.
 */
export interface PaymobIntentionRequest {
  readonly amount: number;
  readonly currency: string;
  readonly payment_methods: number[];
  readonly items: PaymobIntentionItem[];
  readonly billing_data: PaymobBillingData;
  readonly special_reference: string;
  readonly notification_url?: string;
  readonly redirection_url?: string;
}

/**
 * `POST v1/intention/` response — the subset the checkout flow consumes:
 * the intention identity (`id`), the hosted-checkout secret
 * (`client_secret`), and the echo fields used for response sanity checks.
 * The vendor additionally returns payment-key and method descriptors this
 * integration never reads.
 */
export interface PaymobIntentionResponse {
  readonly id: string;
  readonly intention_order_id: number;
  readonly client_secret: string;
  readonly special_reference: string;
  readonly status: string;
  readonly confirmed: boolean;
  readonly intention_detail: {
    readonly amount: number;
    readonly currency: string;
  };
  readonly created: string;
  readonly object: string;
}

/** The order object embedded in transaction callbacks and inquiry results. */
export interface PaymobTransactionOrder {
  readonly id: number;
  readonly merchant_order_id: string | null;
  readonly amount_cents: number;
  readonly currency: string;
}

/** Payment-instrument descriptor carried with transaction payloads. */
export interface PaymobTransactionSourceData {
  readonly pan: string;
  readonly sub_type: string;
  readonly type: string;
}

/**
 * The transaction object of a processed (POST) callback. The vendor's
 * signed HMAC message values (dotted members read from the nested
 * objects) are all present, so the HMAC verifier consumes this shape
 * directly; the remaining members are the action flags and totals the
 * reconciliation path routes on. The
 * `error_occured` member name is the vendor's documented spelling.
 */
export interface PaymobTransactionCallbackObj {
  readonly id: number;
  readonly pending: boolean;
  readonly success: boolean;
  readonly amount_cents: number;
  readonly created_at: string;
  readonly currency: string;
  readonly error_occured: boolean;
  readonly has_parent_transaction: boolean;
  readonly integration_id: number;
  readonly is_3d_secure: boolean;
  readonly is_auth: boolean;
  readonly is_capture: boolean;
  readonly is_refund: boolean;
  readonly is_refunded: boolean;
  readonly is_standalone_payment: boolean;
  readonly is_void: boolean;
  readonly is_voided: boolean;
  readonly owner: number;
  readonly refunded_amount_cents: number;
  readonly captured_amount: number;
  readonly order: PaymobTransactionOrder;
  readonly source_data: PaymobTransactionSourceData;
}

/**
 * Processed-callback POST body. The vendor delivers `{ type, obj }` with a
 * transaction or card-token object under `obj`; the `type` discriminator is
 * NOT documented as guaranteed, so receivers must dispatch on payload
 * shape — this type models the transaction-shaped delivery.
 */
export interface PaymobProcessedCallbackBody {
  readonly type?: string;
  readonly obj: PaymobTransactionCallbackObj;
}

/**
 * The card-token object of a saved-card (TOKEN) callback — the eight
 * members below are exactly the signed HMAC message values. Received on
 * the same notification URL as transaction callbacks; this integration
 * verifies and deliberately ignores them (no saved-card scope).
 */
export interface PaymobTokenCallbackObj {
  readonly card_subtype: string;
  readonly created_at: string;
  readonly email: string;
  readonly id: number;
  readonly masked_pan: string;
  readonly merchant_id: number;
  readonly order_id: string;
  readonly token: string;
  readonly user_added?: boolean;
  readonly next_payment_intention?: string | null;
}

/** Card-token (TOKEN) callback POST body. */
export interface PaymobTokenCallbackBody {
  readonly type?: string;
  readonly obj: PaymobTokenCallbackObj;
}

/**
 * `POST api/auth/tokens` response — only the minted token is consumed (it
 * authenticates server-to-server follow-up calls such as transaction
 * inquiries); the vendor also returns a merchant profile descriptor.
 */
export interface PaymobAuthTokenResponse {
  readonly token: string;
}

/**
 * `POST api/ecommerce/orders/transaction_inquiry` result — the last
 * transaction recorded for an order. The subset below carries everything
 * the reconciliation path needs to route an outcome (success/pending
 * flags, the cents amount, the order's merchant reference, and the
 * refunded/voided/captured action flags); the vendor additionally returns
 * deep merchant, shipping, and payment-key-claim objects this integration
 * never reads.
 */
export interface PaymobTransactionInquiryResult {
  readonly id: number;
  readonly pending: boolean;
  readonly success: boolean;
  readonly amount_cents: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly currency: string;
  readonly error_occured: boolean;
  readonly has_parent_transaction: boolean;
  readonly integration_id: number;
  readonly profile_id: number;
  readonly is_3d_secure: boolean;
  readonly is_auth: boolean;
  readonly is_capture: boolean;
  readonly is_captured: boolean;
  readonly captured_amount: number;
  readonly is_refund: boolean;
  readonly is_refunded: boolean;
  readonly refunded_amount_cents: number;
  readonly is_standalone_payment: boolean;
  readonly is_void: boolean;
  readonly is_voided: boolean;
  readonly owner: number;
  readonly order: PaymobTransactionOrder;
  readonly source_data: PaymobTransactionSourceData;
}

/**
 * The resolved provider configuration the adapter operates with: the
 * typed environment snapshot after the adapter's fail-closed guard has
 * verified every required member (the nullable environment members narrow
 * to concrete values; the wallet integration ID stays optional because a
 * wallet deployment is a legitimate operator choice, not a misconfig).
 * camelCase — this is the provider-independent seam, one translation away
 * from the vendor's snake_case wire fields.
 */
export interface PaymobResolvedConfig {
  readonly secretKey: string;
  readonly publicKey: string;
  readonly hmacSecret: string;
  readonly apiKey: string;
  readonly integrationIdCard: number;
  readonly integrationIdWallet: number | null;
  readonly apiBaseUrl: string;
  readonly checkoutBaseUrl: string;
  readonly httpTimeoutMs: number;
}
