| Condition | Final Behavior | Final Architecture | Total Initial Context | Total Input Tokens | Total Output Tokens | Total Cost | Total Time | Total Turns | Total Tools | Total Edit Rounds | Total Files Changed | Total Lines +/- | Regressions Introduced | Regressions Remaining |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A (4 stages) | PASS 106/106 | PASS | 71,747 B | 8,546,626 | 105,872 | $1.776 | 974 s | 181 | 177 | 6 | 18 | +2302 / -8 | 0 | 0 |
| B (4 stages) | PASS 106/106 | FAIL | 22,468 B | 6,570,315 | 91,582 | $1.446 | 888 s | 160 | 156 | 4 | 22 | +2267 / -11 | 0 | 0 |
| C (4 stages) | FAIL 102/106 | FAIL | 4,715 B | 17,412,612 | 161,453 | $3.120 | 2079 s | 290 | 286 | 29 | 19 | +617 / -20 | 0 | 3 |

| Stage | Condition | Behavior | Architecture | Initial Context | Total Input Tokens | Output Tokens | Cost | Time | Turns | Tools | Edit Rounds | Files Changed | Lines +/- | Regressions Introduced | Old Checks Failing |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | A | PASS 87/87 | PASS | 15,480 B / 25,377 tok | 2,729,895 | 39,163 | $0.580 | 343 s | 56 | 55 | 3 | 5 | +398 / -3 | 0 | 0 |
| 1 | B | PASS 87/87 | PASS | 4,897 B / 22,850 tok | 1,582,586 | 21,727 | $0.334 | 210 s | 46 | 45 | 1 | 5 | +370 / -2 | 0 | 0 |
| 1 | C | FAIL 86/87 | PASS | 1,102 B / 21,758 tok | 8,044,529 | 51,232 | $1.251 | 739 s | 118 | 117 | 12 | 5 | +35 / -4 | 0 | 0 |
| 2 | A | PASS 96/96 | PASS | 17,084 B / 25,776 tok | 1,318,807 | 23,837 | $0.346 | 218 s | 34 | 33 | 1 | 6 | +1025 / -0 | 0 | 0 |
| 2 | B | PASS 96/96 | PASS | 5,248 B / 22,947 tok | 1,227,945 | 22,157 | $0.320 | 212 s | 32 | 31 | 1 | 5 | +884 / -0 | 0 | 0 |
| 2 | C | FAIL 93/96 | PASS | 1,021 B / 21,740 tok | 2,343,505 | 38,756 | $0.567 | 425 s | 49 | 48 | 8 | 2 | +18 / -6 | 0 | 1 |
| 3 | A | PASS 96/96 | PASS | 18,605 B / 26,174 tok | 730,924 | 7,226 | $0.158 | 65 s | 22 | 21 | 1 | 2 | +12 / -5 | 0 | 0 |
| 3 | B | PASS 96/96 | FAIL | 6,063 B / 23,161 tok | 1,097,461 | 12,015 | $0.228 | 124 s | 31 | 30 | 1 | 6 | +267 / -9 | 0 | 0 |
| 3 | C | FAIL 93/96 | FAIL | 1,528 B / 21,874 tok | 1,224,427 | 16,396 | $0.263 | 181 s | 35 | 34 | 2 | 2 | +15 / -5 | 0 | 3 |
| 4 | A | PASS 106/106 | PASS | 20,578 B / 26,671 tok | 3,767,000 | 35,646 | $0.692 | 348 s | 69 | 68 | 1 | 5 | +867 / -0 | 0 | 0 |
| 4 | B | PASS 106/106 | FAIL | 6,260 B / 23,221 tok | 2,662,323 | 35,683 | $0.563 | 341 s | 51 | 50 | 1 | 6 | +746 / -0 | 0 | 0 |
| 4 | C | FAIL 102/106 | FAIL | 1,064 B / 21,747 tok | 5,800,151 | 55,069 | $1.039 | 735 s | 88 | 87 | 7 | 10 | +549 / -5 | 0 | 3 |
