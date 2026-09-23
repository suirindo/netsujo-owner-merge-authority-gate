# Netsujo Owner Merge Authority Gate

External control-plane gate for `suirindo/netsujo-orchestrator`.

- Separate Owner approval environments for READY and MERGE.
- Uses the dedicated `netsujo-owner-merge-gate-0923` GitHub App.
- Verifies exact PR/base/head/tree before emitting authority checks.
- MERGE is one-shot: an existing successful merge-authority check switches the workflow to readback-only and never issues a second merge mutation.
- The target repository candidate branch cannot modify this repository or its workflows.
