import re, glob, os, sys
os.chdir(sys.argv[1])
dups = {
 "getting-started": "getting-started/overview",
 "integration-paths": "integration-paths/overview",
 "payments-and-features": "payments-and-features/overview",
 "intention-apis": "intention-apis/overview",
 "checkout-experiences": "checkout-experiences/overview",
 "mobile-sdks": "mobile-sdks/overview",
 "webhook-callbacks-and-hmac": "webhook-callbacks-and-hmac/overview",
 "manage-payment-apis": "manage-payment-apis/refund",
 "subscription": "subscription/create-subscription-plan",
 "pay-with-saved-cards": "pay-with-saved-cards/create-card-token",
 "quicklink-apis": "quicklink-apis/overview",
 "transaction-inquiry-apis": "transaction-inquiry-apis/by-transaction-id",
}
for parent, child in dups.items():
    title = parent.replace("-", " ").title()
    open(parent + ".md", "w").write(f"""---
title: "{title} (section)"
url: https://developers.paymob.com/paymob-docs/{parent}
---

# {title}

Section landing page — the live URL serves the first child page. See [{child}]({child}.md) and the other pages under `{parent}/`.
""")
BASE = "https://developers.paymob.com/paymob-docs"
amap = {
    "payment links": "integration-paths/no-code/payment-links",
    "the callbacks guide": "webhook-callbacks-and-hmac/transaction-callbacks",
    "processed, response": "webhook-callbacks-and-hmac/transaction-callbacks",
    "unified checkout": "checkout-experiences/unified-checkout-redirection",
    "pixel": "checkout-experiences/pixel-embedded",
    "creating a payment intention": "intention-apis/create-intention",
    "create an intention": "intention-apis/create-intention",
    "refund": "manage-payment-apis/refund",
    "void": "manage-payment-apis/void",
    "capture": "manage-payment-apis/capture",
    "card integration": "payments-and-features/payment-methods/cards-all-regions",
    "dashboard": "getting-started/dashboard",
    "transaction inquiry apis guide under the developers reference sections": "transaction-inquiry-apis",
}
pat = re.compile(r'\[([^\]]+)\]\(([0-9a-f]{24}(?:/[0-9a-f]{24}){0,2})\)')
changed = 0; unresolved = []
for f in glob.glob("**/*.md", recursive=True):
    src = open(f).read()
    def sub(m):
        global changed
        anchor = re.sub(r'\*+', '', m.group(1)).strip().lower()
        slug = amap.get(anchor)
        if not slug:
            for k, v in amap.items():
                if k in anchor:
                    slug = v; break
        if slug:
            changed += 1
            return f'[{m.group(1)}]({BASE}/{slug})'
        unresolved.append((f, m.group(1)))
        return m.group(1)
    out = pat.sub(sub, src)
    if out != src:
        open(f, "w").write(out)
print("links rewritten:", changed, "| unresolved:", unresolved)
