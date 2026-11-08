# 21. Recommended HackFest Demo

The demo should show a business with messy existing data.

### Step 1: Create UMKM

``` text
Toko Kopi Nusantara
```

### Step 2: Import Excel

Upload:

``` text
products.xlsx
```

Containing:

``` text
Product | Price | Stock
Arabica 250g | 85000 | 12
Robusta 250g | 65000 | 8
```

### Step 3: Connect Google Sheets

Connect a sheet containing updated inventory.

The platform detects and maps:

``` text
Nama Produk -> Product
Stok -> Inventory
```

### Step 4: Add knowledge

Upload:

``` text
return-policy.pdf
shipping-policy.pdf
```

### Step 5: Configure agent

``` text
Customer Service Agent

Read:
✓ Products
✓ Prices
✓ Stock
✓ Policies

Write:
✓ Create Order
✓ Update Stock

Approval:
✓ Refund
✓ Price Change
```

### Step 6: Deploy WhatsApp

Agent becomes active.

### Step 7: Customer interaction

Customer:

> "Kak, arabica 250g masih ada?"

Agent checks live business data.

> "Masih ada 12 pcs, Kak. Harganya Rp85.000."

Customer:

> "Saya mau 2."

Agent:

1.  Creates order.
2.  Updates stock from 12 to 10.
3.  Logs the mutation.
4.  Confirms order.

### Step 8: Demonstrate safety

Customer:

> "Ubah harga arabica jadi Rp50.000."

Agent refuses to perform the change because the agent lacks the
price-write capability.

This single moment demonstrates that the agent is not merely a chatbot;
it is an **AI worker operating under business-defined permissions**.

------------------------------------------------------------------------

# 22. Success Metrics

For the HackFest MVP:

### Agent effectiveness

-   = 90% correct answers on seeded business questions.

-   = 95% correct product/stock lookup.

-   100% of unauthorized write operations blocked.

-   100% of successful write operations logged.

### Setup

A new UMKM should be able to:

-   Import a product spreadsheet.
-   Add business policies.
-   Configure capabilities.
-   Deploy an agent.

Target setup time:

**\< 10 minutes for a prepared demo tenant.**

### Agent autonomy

The agent should be able to complete an order workflow without human
intervention when all required permissions are enabled.

------------------------------------------------------------------------

# 22A. Self-Hosted Deployment Model

The HackFest product is **not designed as a SaaS product**.

The intended model is:

```text
UMKM owns/runs a server
        |
        v
Install the application
        |
        +-- Dashboard
        +-- Business database
        +-- Data connectors
        +-- OpenClaw Gateway
        +-- Agent workspaces
        +-- Channel credentials
```

The UMKM admin can deploy the system to:

- VPS.
- Cloud VM.
- On-premise server.
- A supported Docker environment.

The user remains responsible for the server, connected accounts, and business data. A single user can create and manage multiple businesses without deploying the application again.

## 22A.1 Installation

The MVP should aim for a simple installation flow, ideally:

```text
1. Provision server
2. Install application once
3. Configure environment
4. Open dashboard
5. Create user account
6. Create Business A
7. Configure OpenClaw
8. Create agents for Business A
9. Connect Business A data sources
10. Connect Business A WhatsApp
11. Deploy agents
12. Optionally create Business B under the same user account
```

## 22A.2 Why Self-Hosted

Self-hosting is intentional for the HackFest version because it:

- Avoids solving commercial SaaS multi-tenancy.
- Keeps business data under the UMKM's control.
- Makes deployment architecture easier to demonstrate.
- Reduces the amount of infrastructure needed for the MVP.
- Fits the concept of an AI employee that operates inside the business's own environment.

## 22A.3 Future Hosted Version

A future SaaS version may introduce:

```text
Hosted Platform
|
+-- Business A -> isolated OpenClaw cell
+-- Business B -> isolated OpenClaw cell
+-- Business C -> isolated OpenClaw cell
```

However, this is explicitly out of scope for the HackFest MVP.


