# Submission latency and diagnostics

Authentication hooks can have a fixed deadline that includes the caller, networking, Narada, and the response. For example, a consumer with a five-second total hook budget needs Narada acceptance comfortably below two seconds, including cold starts. Delivery is asynchronous and does not establish that the originating authentication transaction completed or its token is valid.

## Acceptance contract

`POST /api/v1/emails` returns `202` with a message ID only after DynamoDB commits the queued message, acceptance metrics, and (when supplied) the idempotency record in one transaction. The durable message is picked up by the existing dispatcher/queue pipeline. SES sending is not part of this synchronous request.

The synchronous path consists of runtime initialization (including SSM configuration on first use), API-key authentication, rate limiting, input/template resolution, an idempotency read, strongly consistent eligibility reads, and the acceptance transaction. Key-usage metadata overlaps request processing but is still awaited. Domain verification, suppression, and paused-sending checks remain enforced. Batched eligibility reads are strongly consistent, not a transactional snapshot; the prior individual reads were not a snapshot either.

A timeout is an **unknown outcome**. Do not acknowledge an authentication hook early, automatically switch providers, or generate a new idempotency key and resend. Persist the logical attempt's idempotency key and use the same payload/key when the upstream protocol safely permits reconciliation. Replaying after an authentication transaction has failed does not make its original token valid. Never lengthen a timeout past the upstream hook's budget.

Narada retries only a DynamoDB transaction explicitly cancelled solely for transaction conflicts, at most twice with bounded jitter and the same writes. Conditional failures retain the existing replay/conflict logic. This wrapper does not retry ambiguous network failures. AWS SDK retry behavior is unchanged.

## Correlation and privacy

Instrumented submissions return `x-request-id` and `Server-Timing` containing `setup`, `handler`, and `cold`. `handler` includes setup; do not add them together. `cold` means the first handler invocation in that execution environment, not a measured Lambda INIT duration. Lambda REPORT records provide INIT separately.

Structured application logs contain only:

- `email_submission`: application, Lambda and Gateway request IDs; HTTP status; accepted message ID; replay flag; total application time; fixed stage timings.
- `email_submission_response`: Lambda request ID, first-invocation flag, setup time, handler time and status.
- API Gateway access logs: request IDs, timestamp, route template, status and integration/response latency, retained for one week.

These records deliberately exclude bodies, subjects, recipients, authorization headers, idempotency keys, query strings and source IPs. Store consumer-side request ID, Gateway request ID, message ID and elapsed time for correlation. Server logs can establish that a response was generated; only the caller can establish that it received it. Requests that fail before initialization completes may have only platform/access logs.

## Measure safely

Use a dedicated sending key scoped to a verified sender domain. The utility always addresses the SES success simulator and never sends authentication links or contacts real recipients. It still creates real Narada message/metric records and consumes normal API throughput. Revoke/delete the temporary key afterward.

```sh
# Supply NARADA_API_KEY through your local secret mechanism; do not paste it into logs.
pnpm exec tsx scripts/benchmark-submission.ts \
  --origin https://mail.example.com \
  --from 'Latency test <probe@example.com>' \
  --count 100
```

The script requires an HTTPS origin, sends sequential fresh-connection probes, records DNS/TCP/TLS/TTFB/total timings and correlation metadata, and writes a private report to ignored `.local/`. It does not print credentials or response bodies. `--replay` reuses one logical request's key to measure idempotent replay separately; do not mix those results with new acceptances. Timeouts or unreadable `202` bodies count as unknown outcomes, not accepted samples. There are no automatic request retries.

Report p50/p95/p99 **with sample count, failures, origin, caller location, cold/warm classification and new-vs-replay distinction**. Small-cohort p99 is effectively the maximum and is not a reliability guarantee. Workstation probes are not equivalent to the actual Supabase Edge Function. Capture end-to-end timings from the actual consuming runtime as the final validation.

Do not force cold starts by redeploying the production API repeatedly. Use an isolated temporary function/API, a frozen artifact, a simulator recipient and explicit cleanup. Vary one factor at a time for memory comparisons, then test the complete intended route. Exercise bursts and after-deployment behavior separately from sequential steady-state probes.

## Capacity and routing

The latency configuration gives only the API Lambda 1,024 MB; worker allocations remain unchanged. Higher memory also allocates more CPU. It is a measured capacity choice, not evidence of memory exhaustion. Evaluate execution duration and billed GB-seconds together rather than assuming faster requests are cheaper.

CloudFront uses all price-class regions so Australian callers can use Australian edges. Price Class 100 excludes Australia and can add a long network path even when the API and caller run in the same AWS region. Inspect `x-amz-cf-pop` and compare the distribution with the stack's regional `ApiUrl` output. Enabling a region does not guarantee a particular edge or latency. Regional HTTPS API access can be evaluated as an integration endpoint; changing the public distribution also needs verification with the actual caller.

Provisioned concurrency is a possible later option if measured cold tails remain too high. It requires a version/alias integration and ongoing capacity cost. Merely enabling it does not pre-run configuration loaded lazily inside the handler. Measure the first accepted request after initialization, deployment, scaling and idle periods before claiming the budget is met.

## Rollout and acceptance checks

1. Deploy the isolated change to staging, verify metadata-only logs, and test new acceptance, same-key replay, conflicting payload rejection, suppression, paused sending and domain restrictions.
2. Confirm API memory, access-log delivery/retention and CloudFront routing in the deployed stack. Repeat cold and warm probes through the real configured hostname.
3. Run a controlled authentication flow from the actual consumer, including after idle/deployment. Record time to `202`, message ID and request IDs; confirm the upstream hook completed and its resulting sign-in link works. Use a controlled account and never log the link/code.
4. Promote the reviewed revision to production, then repeat those checks. Watch latency tails, unknown outcomes, transaction conflicts, throttles and queue age. Roll back code/configuration through the normal deployment workflow if needed; a rollback must not delete accepted messages or idempotency records.

The acceptance transaction still updates shared metric rows. A concurrent baseline probe exposed a transaction conflict, so bounded conflict recovery is included; this is not a proof of high-concurrency capacity. If load testing shows sustained contention, design asynchronous/partitioned aggregation with explicit durability and idempotency tests rather than removing transactional writes ad hoc.

References: [Lambda memory and CPU](https://docs.aws.amazon.com/lambda/latest/dg/configuration-memory.html), [CloudFront price classes](https://docs.aws.amazon.com/cdk/api/v2/python/aws_cdk.aws_cloudfront/PriceClass.html), [HTTP API access-log variables](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging-variables.html), [DynamoDB transaction semantics](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html).
