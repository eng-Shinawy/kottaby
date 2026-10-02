---
title: "Glossary"
url: https://developers.paymob.com/paymob-docs/need-help/glossary
tab: documentation
breadcrumbs: "Need Help? > Glossary"
---

# Glossary
## **A**

  - **Acquirer:** A bank or processor that acquires card transactions and settles funds to the merchant.

  - **Accept (Paymob Accept / Checkout)**

    - Paymob’s online checkout supports cards, wallets, and BNPL.

    - Available via hosted pages, plugins, SDKs, or APIs.

  - **API Keys (Secret / Public)**

    - Credentials used for API authentication.

    - **Secret Key:** Server-side only.

    - **Public Key:** Safe for client-side initialization.

    - Rotate keys on go-live and during security incidents.

  - **Apple Pay:** Wallet-based payment method using tokenized credentials from Apple devices.

  - **Authorization (Auth):** Real-time approval from the issuer that reserves funds. Can later be captured or voided.

  - **Auth / Capture (Two-Step Payments):** Allows funds to be authorized first and captured later (full or partial). Useful when fulfillment happens after order placement.

## **B**

  - **BNPL (Buy Now, Pay Later):** Installment payment providers such as Valu, Souhoola, Symple, Tabby and Tamara. Terms vary by region and currency.

  - **BIN / IIN (Bank Identification Number):** First 6–8 digits of a card number. Used for routing, issuer identification, and eligibility checks.

## **C**

  - **Callback (Webhook / HMAC-Signed)**

    - Server-to-server notifications for payment state changes.

    - Must verify HMAC, support retries, and ensure idempotency.

  - **Capture**

    - Converts an approved authorization into a settled transaction.

    - Can be full or partial.

  - **Card on File (CoF)**

    - Tokenized card reference stored for future charges (CIT or MIT).

    - PANs must never be stored — use Paymob tokens only.

  - **Chargeback / Dispute**

    - Issuer or cardholder-initiated reversal after settlement.

    - Different from refunds; involves reason codes and timelines.

  - **Checkout (Hosted Checkout)**

    - Paymob-hosted payment page.

    - Handles payment methods, 3DS, and redirects users back to your app or site.

  - **CIT**

    - **CIT:** Customer-Initiated Transaction/Cardholder-Initiated-Transaction

## **D**

  - **Descriptor**

    - Text shown on the cardholder’s statement.

    - Must comply with acquirer length and character rules.

## **E**

  - **Environments (Test / Live)**

    - Separate base URLs, API keys, and Integration IDs.

    - Never mix test and live credentials.

## **G**

  - **Google Pay**

    - Wallet payment method for Android and web.

    - Requires gateway configuration and regional enablement.

## **H**

  - **HMAC (Hash-based Message Authentication Code)**

    - Cryptographic signature used to verify webhook authenticity and integrity.

## **I**

  - **Integration ID**

    - Unique identifier linking your account to a specific payment method and environment.

    - Required for API calls.

  - **Intention (Payment Intention / Intent)**

    - Defines what the customer intends to pay (amount, currency, method, return URLs).

    - Manages redirects, 3DS, and callbacks.

  - **Issuer (Issuing Bank)**

    - The cardholder’s bank that approves or declines transactions.

## **K**

  - **KYC (Know Your Customer)**

    - Compliance checks are required for onboarding and payment method activation.

  - **KSA**

    - Regional marker for Saudi Arabia-specific behavior and requirements.

## **L**

  - **Live Mode (Production)**

    - Real-money environment.

    - Verify descriptors, callbacks, and 3DS before enabling.

## **M**

  - **MCC (Merchant Category Code)**

    - Four-digit code defining the merchant’s business type.

    - Impacts risk rules and payment method availability.

  - **MIT (Merchant-Initiated Transaction)**

    - Off-session charges, such as subscriptions.

    - Often 3DS-exempt after an initial authenticated CIT.

  - **MPGS (Mastercard Payment Gateway Services)**

    - Mastercard’s modern gateway is used by many acquirers.

  - **MIGS (Mastercard Internet Gateway Service)**

    - Legacy Mastercard gateway, largely replaced by MPGS.

  - **MOTO (Mail Order / Telephone Order)**

    - Charge cards remotely using securely stored tokens.

    - **Use Cases:**

      - Hotels: Post-checkout charges.

      - Service providers: Follow-up billing.

      - Medical clinics: Charges without re-presenting the card.

## **N**

  - **Network Token (Scheme Token)**

    - Token issued by card schemes to replace PANs and improve authorization rates.

## **O**

  - **Order vs. Transaction**

    - **Order:** Your business reference (cart or invoice).

    - **Transaction:** The payment event (auth, capture, or refund).

    - Always reconcile both.

## **P**

  - **PCI DSS**

    - Security standard for handling card data.

    - Hosted checkout and tokenization reduce PCI scope.

  - **Pixel (Native Payment Experience / JS SDK)**

    - Embedded payment component for web or mobile.

    - Keeps secrets server-side.

    - **Use Cases:**

      - E-commerce embedded checkout.

      - Mobile apps.

      - Subscriptions.

  - **Public Key**

    - Client-side initialization key.

    - Cannot authorize payments on its own.

  - **Payment Link (Quick Link)**

  - Hosted URL to collect payments without a website.

    - **Use Cases:**

      - Freelancers

      - Small businesses

      - Events

      - Delivery services

## **R**

  - **Refund**

    - Merchant-initiated return of captured funds.

    - BNPL and wallets may impose restrictions.

  - **Reconciliation**

    - Matching Orders, Transactions, and Payouts.

    - Log `merchant_order_id` and `transaction_id`.

## **S**

  - **Saved Card Token**

    - A token representing a card for future charges.

    - Scope and expiry depend on Paymob and the acquirer.

  - **Settlement / Payout**

    - Transfer of funds from the acquirer to the merchant.

    - Timing varies by payment method and currency.

  - **Split Payments**

    - Distribute one payment across multiple beneficiaries.

    - Impacts settlement and reconciliation.

  - **Subscriptions**

    - Recurring billing using an initial CIT followed by MITs.

    - **Use Cases:**

      - Streaming platforms

      - Gyms

      - Education services

## **T**

  - **Tamara / Tabby – UAE & KSA**

    - Regional BNPL providers with unique onboarding, settlement, and refund rules.

  - **Tokenization**

    - Replacing PANs with tokens to reduce PCI scope and enable saved cards.

  - **Transaction Reference IDs**

    - Identifiers such as `merchant_order_id` and Paymob `transaction_id`.

    - Always log both.

## **U**

  - **UAE**

    - Regional marker for United Arab Emirates-specific behavior.

## **V**

  - **Void**

    - Cancels an authorization before capture.

    - Releases funds immediately.

    - Not the same as a refund.

## **W**

  - **Wallets (Apple Pay, Google Pay, etc.)**

    - Tokenized device or browser payments.

    - Require region-specific setup and merchant/domain verification.

  - **Webhooks (Events)**

    - Payment lifecycle notifications (authorized, captured, failed, refunded, etc.).

    - Verify HMAC, retry safely, and log all events.
