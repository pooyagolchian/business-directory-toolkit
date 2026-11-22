# Overview

Why this toolkit exists and where to start reading.

Most "how to scrape Google Maps" tutorials stop at one API call and a
`console.log`. This one goes to a working product: a crawl that survives a hard
result ceiling, a deduplicated dataset, a taxonomy pass that costs almost
nothing, real search-demand measurement, and a browsable site over ~15,000
businesses.

## What you might want from this

| You are here to…                                                        | Go to                                                                                                                                                     |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Read what a real crawl measured**, and what it cost                   | [What the crawl actually measured](./findings.md#what-the-crawl-actually-measured) · [Five ideas worth stealing](./findings.md#five-ideas-worth-stealing) |
| **Run it on my own city**                                               | [Add your own city](./add-a-city.md#add-your-own-city) · [Why tiling exists](./crawl-cost.md#why-tiling-exists-and-what-a-crawl-costs)                    |
| **Steal one piece** — the ranking, the phone parsing, the taxonomy pass | [What each `packages/core` module decides](./pipeline.md#what-each-packagescore-module-decides). It is pure, dependency-light and fully tested            |
| **Deploy the whole thing**                                              | [Architecture and deployment](./deployment.md#architecture-and-deployment)                                                                                |
| **Get unstuck** — an error message, a build that will not start         | [Troubleshooting](./development.md#troubleshooting)                                                                                                       |
