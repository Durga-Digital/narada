import type { ApiKey } from "@narada/core/model";
import type { Caller } from "@narada/core/authorization";
import type { SubmissionTiming } from "@narada/core/submission-timing";
export type ApiEnvironment = {
  Variables: {
    apiKey: ApiKey;
    caller: Caller;
    submissionTiming: SubmissionTiming;
    acceptedMessageId: string;
    replayed: boolean;
  };
  Bindings: {
    lambdaContext?: { awsRequestId?: string };
    requestContext?: { requestId?: string };
  };
};
