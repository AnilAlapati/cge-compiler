# Repository Token & Cost Metrics

> Cost model: gpt-4o-mini @ $0.15/1M input tokens. Token estimate: 1 token ≈ 4 chars.

## Context Compression

| Repository | Raw Tokens | Map Tokens | Raw+Map Tokens | Compression | Reduction |
| ---------- | ---------- | ---------- | -------------- | ----------- | --------- |
| domain-driven-hexagon | 22,616 | 3,267 | 25,883 | 6.9x | 85.6% |
| ghostfolio | 336,111 | 58,405 | 394,516 | 5.8x | 82.6% |
| nestjs-boilerplate | 43,023 | 10,940 | 53,963 | 3.9x | 74.6% |
| nestjs-prisma-starter | 7,848 | 2,079 | 9,927 | 3.8x | 73.5% |
| nestjs-real | 8,535 | 2,333 | 10,868 | 3.7x | 72.7% |
| nestjs-realworld | 8,535 | 2,333 | 10,868 | 3.7x | 72.7% |

## Cost Per Query (Single Question)

| Repository | Cost (Raw) | Cost (Map Only) | Saving/Query | Saving/100 Queries |
| ---------- | ---------- | --------------- | ------------ | ------------------ |
| domain-driven-hexagon | $0.00339 | $0.00049 | $0.00290 | $0.2902 |
| ghostfolio | $0.0504 | $0.00876 | $0.0417 | $4.1656 |
| nestjs-boilerplate | $0.00645 | $0.00164 | $0.00481 | $0.4812 |
| nestjs-prisma-starter | $0.00118 | $0.00031 | $0.00086 | $0.0865 |
| nestjs-real | $0.00128 | $0.00035 | $0.00093 | $0.0930 |
| nestjs-realworld | $0.00128 | $0.00035 | $0.00093 | $0.0930 |

## Key Takeaways

- Average token reduction across repos: **76.9%**
- Average compression ratio: **4.6x**
- A map-only agent query costs roughly **77% less** than a raw code query.
