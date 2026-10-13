# Vian — Van Schalkwyk Holdings Intelligence Network

## Status
**Implemented in the draft development branch. Not deployed, connected to a production OpenAI key or live-tested yet.**

Vian uses the visitor-approved gold-and-white robot image (glasses and clipboard), an OpenAI Netlify Function, and approved facts about every business in the Holdings family.

## Exactly where Vian appears
- `index.html`: chat bubble plus a friendly first-time-only welcome popup.
- `grannys-little-bakery.html`: chat bubble, NO proactive intro popup.
- `clever-cubs-learning.html`: chat bubble, NO proactive intro popup.
- No Vian widget is embedded in `puress.html` or `cricut.html` until requested, and **no Vian code is added to the separate NUVETRIQ website** at `nuvetriq.com`.
- He can answer public questions about NUVETRIQ and link visitors to it, but he does not operate on that external site.

## Welcome-popup and chat rules
- The greeting popup is only on the Holdings landing page, approximately one second after a visitor's first visit.
- A browser-local flag means it shows only once on that site's browser/device (unless browser storage is cleared).
- Clicking the welcome message opens the chat; dismissing leaves the small Vian launcher.
- Chat remains available as a compact launcher across the three pages.
- Messages in the current browser tab are kept in `sessionStorage` so chat can continue between Holdings, Granny's and Clever Cubs; they are **not intentionally written to a visitor-chat database**.
- Widget repositions above cart buttons in stores and hides while the book checkout overlay is open.

## Knowledge / scope
- Holds approved public information about Granny's, Clever Cubs Learning, Nuvetriq, PurEss (coming soon) and Cricut (coming soon).
- Reads published catalogue entries from the Netlify product store as supplementary context, never drafts or private PDF files.
- Never invents pricing, stock, services, launch dates or claims that unlaunched payments work.
- Doesn't have admin or order access, cannot take payments, send books or reveal private data.
- Responds in Afrikaans or English based on the visitor's message.
- Update the public facts in `netlify/lib/vian-knowledge.mjs` whenever a business changes its description, services or public contacts. Keep Vian's description of checkout/test-only features aligned with what is actually deployed.

## Netlify setup and security
In the **Van Schalkwyk Holdings** Netlify project, add:
- `OPENAI_API_KEY`: a private OpenAI Platform project API key. **Do not put this in frontend code, GitHub, screenshots or chat**. A ChatGPT Plus subscription does not automatically cover API usage; check your OpenAI Platform billing.
- Optional `VIAN_OPENAI_MODEL`: defaults to `gpt-4.1-mini` if not supplied.
- Optional `VIAN_RATE_LIMIT_SALT`: a randomly generated private string used when hashing visitor IPs for usage limits.

The Netlify Function is at `/.netlify/functions/vian-chat`. It requests OpenAI responses server-side with `store: false`, a bounded recent chat history and capped output tokens.

### Prepaid OpenAI billing — manual top-ups like Nia

1. Use a **dedicated Vian project** in the same OpenAI API organization (or a separately billed organization if financial separation is required). API credit is purchased for the **organization**, not as a fixed number of conversations for a project.
2. At **OpenAI Platform → Billing**, purchase a small initial prepaid amount (currently the minimum is **US$5**). Turn **Use auto-reload OFF**. With no auto-reload, additional credit is purchased **manually by the owner**.
3. Under the **Vian project → Limits → Spend**, set a suitable **monthly spend limit** and explicitly select **Enforce a hard limit**. A spend alert alone is NOT a spending cutoff. Set early alerts to warn before exhaustion.
4. OpenAI's prepaid balance and enforced hard spend limits may stop requests **with a short delay**, so small overages are possible. Don't represent either as a guaranteed exact spending cutoff. Projects within the same organization can draw from its common credit balance.
5. Never place the OpenAI secret key in the public website or commit it to the repo. Add it only in the **Holdings Netlify project** as `OPENAI_API_KEY`, available to Functions.

### Vian usage and anti-bot caps — added to the draft

| Protection | Default | Notes |
|---|---:|---|
| Netlify network edge per visitor IP | **4 requests per 60 seconds** | Returns HTTP 429 under excessive bursts; enforcement may lag a few seconds |
| Vian server per visitor IP per hour | **10 requests** | Netlify Blobs atomic usage counter |
| Vian server per visitor IP per day | **20 requests** | Resets by UTC date |
| Vian server across the entire site per day | **100 requests** | Controls total paid API calls even across many different IPs |
| OpenAI response limit | **420 output tokens** | Server-side |
| Conversation context | **8 recent messages** | Stored only in visitor tab, not server transcript database |

The hourly and daily server limits can be adjusted in Netlify using `VIAN_IP_HOURLY_LIMIT`, `VIAN_IP_DAILY_LIMIT`, and `VIAN_DAILY_REQUEST_LIMIT` (all optional). The edge 4/minute setting is in `netlify/functions/vian-chat.mjs`.

These protect against ordinary spam/abuse, **but are not an absolute anti-hacking guarantee**; a malicious distributed botnet can still try to bypass per-IP limits. Combined with project hard spend limits, manual recharge, and Netlify's additional bot/WAF controls, risk is reduced considerably. Review monitoring and usage regularly. The server returns a friendly unavailable message if OpenAI reports prepaid credits or spend limits are exhausted.

Official resources:
- https://help.openai.com/en/articles/8264644-how-can-i-set-up-prepaid-billing
- https://developers.openai.com/api/docs/guides/spend-limits
- https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/


The OpenAI key **must be configured before the AI answers can work**. Without it, Vian can appear as a bubble and show an informative unavailable message, but cannot chat.

## Pre-deployment checks
- [ ] Verify avatar displays properly (on homepage, Granny's and Clever Cubs, desktop and mobile).
- [ ] Homepage on new browser: small welcome popup once only; dismiss/reload: no repeat.
- [ ] Direct visit to Granny's or Clever Cubs: no unsolicited welcome.
- [ ] Check conversation follows between pages; New chat works; close and reopen.
- [ ] Confirm Vian knows Granny's and Clever Cubs, including their contact details and product categories.
- [ ] Confirm Vian can explain NUVETRIQ but links externally and does not appear on its website.
- [ ] Ask about PurEss and Cricut, confirm he clearly says coming soon.
- [ ] Prompt-injection and unrelated trivia tests: stays within business scope.
- [ ] Ensure no OpenAI API key is exposed in frontend scripts, browser responses or GitHub.
- [ ] Verify prepaid billing with automatic recharge OFF, Vian's enforced project hard spend limit, and early spend alerts.\n- [ ] Test rate limits (4/min, 10/hour/IP, 20/day/IP and 100/day/site) without using billable calls.\n- [ ] Review privacy notice to cover AI chat processing and costs/abuse limits.
- [ ] Test mobile basket interaction and screen-reader/accessibility basics.
- [ ] Test with real Netlify branch deploy using your own configured OpenAI key before merging PR #2.

All changes stay unmerged on `feature/unified-product-admin` until the full pre-deployment checklist is complete.
