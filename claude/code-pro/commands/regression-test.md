---
description: Verify recent changes broke nothing — impact analysis + test runs, report-only
---

Use the **regression-test** skill on: $ARGUMENTS (default: the latest uncommitted changes / most recent commits)

Follow the skill exactly: identify the change, delegate to the regression-tester agent for blast-radius mapping + suite runs + missing regression tests, and return the fixed report (what was analyzed / tests run / new tests / found breakage NOT fixed / needs manual verification). Never fix what it finds — recommend /bug-fix.
