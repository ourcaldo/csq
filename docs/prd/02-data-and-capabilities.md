# 8. Data Sources

The MVP should support three primary ingestion methods.

## 8.1 Manual Data

Owner can manually create or edit:

-   Products.
-   Prices.
-   Stock.
-   Policies.
-   FAQs.

## 8.2 Excel / CSV

Owner uploads a spreadsheet.

The system:

1.  Reads the file.
2.  Detects columns.
3.  Infers their meaning.
4.  Shows a mapping preview.
5.  Asks for confirmation if ambiguous.
6.  Imports the data.
7.  Records the source and last synchronization time.

Example:

``` text
Nama Barang -> product.name
Harga Jual  -> product.price
Sisa        -> inventory.quantity
```

## 8.3 Google Sheets

Owner connects a spreadsheet.

The system:

1.  Authenticates the account.
2.  Lets the owner select a spreadsheet.
3.  Detects sheets and columns.
4.  Maps the data.
5.  Stores the connection configuration.
6.  Reads the latest data when the agent needs it.

Dated note 2026-11-09 (PRD 16 OPS-4): step 7 "optionally writes back
when write access is explicitly enabled" is REMOVED. No tenant has ever
used Sheets write-back and no tool wires it; if a future round needs it,
it gets its own PRD with a per-source opt-in flag. Google Sheets is
read-only in CSQ.

------------------------------------------------------------------------

# 9. Agent Capability Model

This is a critical product feature.

The owner should not simply choose "AI has access to data."

The owner should configure **what the agent is allowed to do**.

Each capability has at least:

-   Read.
-   Write.
-   Approval required.

Example:

  Capability        Read   Write      Approval
  --------------- ------ ------- -------------
  Products           Yes     Yes      Optional
  Price              Yes     Yes   Recommended
  Stock              Yes     Yes   Recommended
  Orders             Yes     Yes   Recommended
  Customer data      Yes     Yes   Recommended
  FAQ                Yes     Yes      Optional
  Policies           Yes     Yes   Recommended

The final permission model should be tool-based rather than file-based.

For example:

``` text
product.read
product.update

inventory.read
inventory.update

order.read
order.create
order.cancel

customer.read
customer.update
```

This is safer than giving the agent unrestricted access to a
spreadsheet.

------------------------------------------------------------------------

# 10. Read vs Write Access

## Recommended default

**Agents should be read-only by default.**

This is important for trust and safety.

For example, after connecting Google Sheets:

``` text
Google Sheets
|
+-- Read product data       ON
+-- Read stock              ON
+-- Update stock            OFF
+-- Update price            OFF
+-- Create order            OFF
```

The owner can explicitly enable write capabilities.

## Why?

A customer message should not automatically give the agent unrestricted
permission to modify business data.

Example:

Customer:

> "Kak, stoknya ubah jadi 100 ya."

The agent should not update inventory simply because a customer asked.

Instead:

``` text
Customer request
      |
      v
Agent
      |
      v
Does this action have permission?
      |
   NO -> refuse / escalate
   YES
      |
      v
Does it require approval?
      |
   YES -> ask owner
   NO  -> execute
```

------------------------------------------------------------------------

# 11. Write Operations

The agent should be capable of updating business data when the
capability is explicitly enabled.

Example:

Customer purchases 2 units.

Agent:

1.  Checks stock.
2.  Creates order.
3.  Updates inventory.
4.  Records the transaction.
5.  Confirms the customer.

``` text
Stock before: 10

Order: 2 units

Stock after: 8
```

The system should record:

``` text
Action:
inventory.update

Agent:
Customer Service Agent

Business:
Toko Budi

Source:
Order #1234

Before:
10

After:
8

Timestamp:
...

Approval:
Not required
```

This creates an auditable action trail.

------------------------------------------------------------------------

# 12. External Data Write Strategy

Dated note 2026-11-09 (PRD 16 OPS-4): this section describes a target that
was never built. Google Sheets is read-only in CSQ today: external writes
were removed from the product scope because no tenant asked for them. The
principle below (separate write capability, controlled tools, no raw
credentials) still governs any future external write feature.

For external sources such as Google Sheets, the platform should treat
write access as a separate capability.

Example:

``` text
Google Sheets
|
+-- Read Products       ✓
+-- Read Stock          ✓
+-- Write Stock         ✓
+-- Write Price         ✕
```

The agent should never receive raw spreadsheet credentials.

Instead, your platform exposes controlled tools:

``` text
get_stock(product_id)
update_stock(product_id, quantity)
get_product(product_id)
update_product_price(product_id, price)
```

The backend validates the request and performs the actual spreadsheet
operation.

This creates an authorization layer between the agent and the external
system.

------------------------------------------------------------------------

# 13. Data Authority and Conflict Handling

Different sources may contain conflicting information.

Example:

``` text
Internal database:
Stock = 5
Updated 3 days ago

Google Sheets:
Stock = 3
Updated 10 minutes ago
```

The platform should maintain:

-   Source.
-   Timestamp.
-   Last synchronization.
-   Authority/priority.
-   Confidence.

The owner can define a source priority:

``` text
1. Internal inventory
2. Google Sheets
3. Imported Excel
4. Agent memory
```

The agent should prefer authoritative sources over memories or stale
documents.

If the system cannot confidently determine the correct value, it should
ask for human clarification rather than inventing an answer.

------------------------------------------------------------------------

