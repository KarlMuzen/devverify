# Live verification

Items in this table require human verification or a live check. Do not treat an open item as verified.

| Item | Question | How to verify | Result | Status |
| --- | --- | --- | --- | --- |
| GitHub Actions: actions/checkout@v4 | Is the workflow using the current major tag required by the build plan? | Review the workflow reference and current GitHub Actions documentation; record the commit SHA used for pinning when the project reaches the human verification gate. | CI references `actions/checkout@v4`. | open |
| GitHub Actions: actions/setup-node@v4 | Is the workflow using the current major tag required by the build plan? | Review the workflow reference and current GitHub Actions documentation; record the commit SHA used for pinning when the project reaches the human verification gate. | CI references `actions/setup-node@v4`. | open |
