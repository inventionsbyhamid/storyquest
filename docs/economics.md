# Economics

Video generation is the main cost. Everything else (server on our own VPS, bandwidth, the story director, safety checks) is small.

## Cost per filmed scene

| Item | Cost |
| --- | --- |
| MiniMax H3 Max Turbo, 768p, at $0.04 per second | $0.48 for 12 seconds ($0.32 for 8) |
| Story director (DeepSeek V4.1 Flash on OpenRouter) | about $0.001 (Claude on Bedrock: about $0.04) |
| **Scene** | **about $0.48** |

Stories now use four 12 second scenes, so a whole shared tree is 15 scenes (about $7.20) instead of 63 (about $20 at 8 seconds). A 10 Spark pack at $11.99 is about $0.96 a Spark after Amazon's 20%, against about $0.62 of filming per Spark (1.3 scenes made per scene watched). The simulation below was run with 8 second scenes and Claude, so its costs are on the high side for trees and on the low side for private scenes.

Private scenes are prepared ahead only for the choice a family focuses on, so we budget 1.3 scenes made per scene watched.

## Model

* **Free:** the daily stories. A shared story tree (63 scenes for six scenes with two choices each) is filmed once and reused by every family, so its cost is fixed no matter how many families play.
* **One free filmed scene per new user, for life.**
* **Paid:** 1 Spark per scene filmed only for your family, sold as Amazon In App Purchasing consumables.
* **Amazon's share:** 20% under the Appstore Small Business Accelerator (under $1M annual revenue), otherwise 30%.

## Simulation: 1000 daily users, 15% new each day, 2% buy a 10 Spark pack each day

| Scenario | Per Spark | 10 Sparks | Fixed cost per day | Profit per month | Break even conversion |
| --- | --- | --- | --- | --- | --- |
| 60% markup, free scene for every user every day, 6 stories a day | $0.94 | $9.36 | $606 | minus $16,500 | 21.6% |
| 60% markup, free scene once per new user, 2 stories a day | $0.94 | $9.36 | $117 | minus $1,800 | 4.2% |
| 100% markup, once per new user, 2 stories a day | $1.17 | $11.70 | $117 | minus $700 | 2.5% |
| 150% markup, once per new user, 2 stories a day | $1.46 | $14.62 | $117 | plus $700 | 1.7% |
| 150% markup, once per new user, 1 story a day, 6 second scenes | $1.14 | $11.37 | $74 | plus $1,060 | 1.4% |

## Decisions

* One free scene per new user for life. Daily free allowances are only for judging and promotions (`DAILY_FREE_SPARKS`).
* Price at about 150% markup: packs of 10 for $11.99 and 25 for $24.99.
* Few shared stories that live for a week (for example 2 new a day, each available for 7 days) instead of many one day stories.
* Because shared trees are a fixed cost, profit grows faster than the audience.

## Growth simulation: 1000 new signups a day

Packs: 70% buy 10 Sparks for $11.99, 30% buy 25 for $24.99 (average $15.89 for 14.5 Sparks, about $5.90 profit per purchase after Amazon's share and video cost, assuming every Spark gets used). Shared stories about $1,400 a month, VPS $50.

| Scenario | Month 1 profit | Month 6 revenue | Month 6 profit | 6 month total |
| --- | --- | --- | --- | --- |
| 2% buy once, 60% use the free scene, no repeat buys | minus $4,300 | $9,500 | minus $4,300 | minus $26,000 |
| 2% buy, 60% use the free scene, buyers buy 1 pack a month, 60% stay each month | minus $4,300 | $22,700 | plus $600 | minus $6,700 |
| 1.8% buy, same as above | minus $4,700 | $20,500 | minus $300 | minus $10,800 |
| 2% buy, free scene unlocked after 3 watched scenes (30% use it), 1 pack a month, 60% stay | minus $1,100 | $22,700 | plus $3,800 | plus $12,700 |
| Same, 1.5 packs a month, 70% stay | minus $1,100 | $37,300 | plus $9,300 | plus $31,500 |

The free scene is the largest cost at this signup rate (about $6,500 a month at 60% use). Offering it only after a family has watched a few scenes, plus repeat purchases, is what makes the model profitable.
