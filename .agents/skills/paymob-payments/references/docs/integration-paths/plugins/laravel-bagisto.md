---
title: "Laravel-Bagisto"
url: https://developers.paymob.com/paymob-docs/integration-paths/plugins/laravel-bagisto
tab: documentation
breadcrumbs: "Integration Paths > Plugins > Laravel-Bagisto"
---

# Laravel-Bagisto
**Who is this for -** For developers working with Laravel Bagisto stores who want to add Paymob as a payment option.

**Outcome -** Explore, Install, and Configure Paymob's **Laravel-Bagisto** plugin

* * *

### Overview

The Paymob Laravel Bagisto plugin enables merchants to accept online payments through Paymob within Bagisto’s Laravel-based e-commerce framework, integrating smoothly with Bagisto’s checkout flow.

### Installation Steps for Bagisto 1.x

###### 1

Install the Paymob Payment package for Laravel Bagisto 1.x e-commerce via [**paymob/laravel-bagisto1.x**](https://packagist.org/packages/paymob/laravel-bagisto1.x) composer.

In the server CMD terminal, run the following command to install the Paymob Payment Package

```powershell
composer require paymob/laravel-bagisto1.x
``` 

###### 2

Then, run the commands below

```powershell
php artisan migratephp artisan optimize
``` 

###### 3

Go to `**app/Http/Middleware/VerifyCsrfToken.php**` file. Then, add `**paymob/callback**` in the protected array `**$except**` as below

```powershell
protected $except = ['paymob/callback',];
``` 

###### 4

After that, run the following command

```powershell
php artisan config:cache
``` 

### Installation Steps for Bagisto 2.x

###### 1

Install the Paymob Payment module for Laravel Bagisto 2.x e-commerce via [**paymob/laravel-bagisto2.x**](https://packagist.org/packages/paymob/laravel-bagisto2.x) composer.

In the server cmd terminal, run the following command to install the Paymob Payment Package

```powershell
composer require paymob/laravel-bagisto2.x
``` 

###### 2

Run the commands below

```powershell
php artisan vendor:publish --force --tag=paymob
php artisan migrate
php artisan optimize
``` 

###### 3

Go to `**app/Http/Middleware/VerifyCsrfToken.php**` file. Then, add `**paymob/callback**` in the protected array `**$except**` as below

```powershell
protected $except = ['paymob/callback',];
``` 

###### 4

After that, run the following command

```powershell
php artisan config:cache
``` 

### Plugin Configuration

###### 1

In the **Bagisto** Admin Panel Menu, **configuration** ⇒ **sales** ⇒ **payment methods** , search for**Paymob payment** , then paste each key in its place in the settings page.

![](https://d24lr4zqs1tgqh.cloudfront.net/6786e43a-1d66-49ea-bba4-808e5b009a2b.jpg)

> **Info:**
> 
> You can get all the credentials from your Paymob dashboard. Check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials).

###### 2

Enter the**integration IDs** separated by a comma (**,**).

###### 3

Copy the integration callback URL that exists in the Paymob **Bagisto** setting page, then paste it into each payment integration/method in the Paymob account.

> **Info:**
> 
> You check the [**Getting Integration Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/getting-integration-credentials) page for more guidance on how to update the callback URLs on the Paymob dashboard.

###### 4

**Save** the changes

> **Info:**
> 
> To test the payment cycle, you need to use test credentials for Card and Wallet. Please check the [**Test Credentials**](https://developers.paymob.com/paymob-docs/need-help/faq/test-credentials) page.
