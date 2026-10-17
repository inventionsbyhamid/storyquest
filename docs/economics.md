# Economics

Video generation is the main cost. Everything else (server on our own VPS, bandwidth, the story director, safety checks) is small.

## Cost per filmed scene

| Item | Cost |
| --- | --- |
| MiniMax H3 Max Turbo, 768p, 8 seconds at $0.04 per second | $0.32 |
| Claude story director on Amazon Bedrock | about $0.04 |
| **Scene** | **about $0.36** |

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
