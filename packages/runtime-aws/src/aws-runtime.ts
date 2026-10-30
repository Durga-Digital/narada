import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { createRuntime, type Runtime } from "./index.js";
let instance: Promise<Runtime> | undefined;
export function awsRuntime() {
  instance ??= (async () => {
    const ssm = new SSMClient({});
    const [result, origin] = await Promise.all([
      ssm.send(
        new GetParameterCommand({
          Name: process.env.AUTH_SECRET_PARAMETER!,
          WithDecryption: true,
        }),
      ),
      process.env.BETTER_AUTH_URL
        ? Promise.resolve(undefined)
        : ssm.send(
            new GetParameterCommand({
              Name: process.env.PUBLIC_URL_PARAMETER!,
            }),
          ),
    ]);
    process.env.BETTER_AUTH_SECRET = result.Parameter!.Value!;
    if (origin) {
      process.env.BETTER_AUTH_URL = origin.Parameter!.Value!;
    }
    return createRuntime();
  })().catch((error) => {
    instance = undefined;
    throw error;
  });
  return instance;
}
