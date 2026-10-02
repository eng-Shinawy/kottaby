---
title: "Capture"
url: https://developers.paymob.com/paymob-docs/payments-and-features/managing-payments/capture
tab: documentation
breadcrumbs: "Payments & Features > Managing Payments > Capture"
---

# Capture
![](https://d24lr4zqs1tgqh.cloudfront.net/e221bfee-f8b8-4164-b9bf-1fa91abf1500-696e9edc0acf4f5a50bce69f.svg)

**Who is this for -** Product managers, business owners, and stakeholders who need a high-level understanding of capture transactions and when to use them

**Outcome -** Understand what capture is, how it works at a high level, and when to capture the authorized amount or a lesser amount before it is automatically voided

* * *

### What is Capture?

Capture is the step that **finalizes an authorized transaction**. While authorization reserves the funds on the customer’s account, capture is what transfers the money to the merchant.

Captures can be:

  - **Full capture** – capturing the entire transaction amount 

  - **Partial captures** – capturing only part of the authorized amount.

![](https://d24lr4zqs1tgqh.cloudfront.net/907b8d4d-fe1c-4c8e-905d-de432a258385-696e9edc0acf4f5a50bce69f.svg)

### Common Use Cases Capture is typically used when:

  - Services are confirmed after authorization

  - Partial fulfillment is possible

![](https://d24lr4zqs1tgqh.cloudfront.net/18648cf9-dfd2-4d0e-a6c2-3e839c6a20af-696e9edc0acf4f5a50bce69f.svg)

### Payment methods that capture is supported for:

**Card** payment method with the **Auth** transaction type only

### Important Considerations

  - Captures must occur **before the authorization expires**

  - Partial captures cannot exceed the authorized amount

### Dashboard Capture

###### 1

Select the successful **Auth** transaction you want to **capture**

###### 2

Click the **capture** button, which will show the capture pop-up

###### 3

Fill in the amount you want to **capture**

###### 4

Click the **capture** button in the capture pop-up

![](https://d24lr4zqs1tgqh.cloudfront.net/aa084d29-91d1-4db7-85fe-53932bb0d643.jpg)
