import {
  Stack,
  Duration,
  RemovalPolicy,
  CfnOutput,
  aws_dynamodb as db,
  aws_sqs as sqs,
  aws_sns as sns,
  aws_sns_subscriptions as subscriptions,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_lambda_event_sources as sources,
  aws_iam as iam,
  aws_ses as ses,
  aws_apigatewayv2 as gateway,
  aws_apigatewayv2_integrations as integrations,
  aws_s3 as s3,
  aws_s3_deployment as deployment,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_certificatemanager as acm,
  aws_ssm as ssm,
  aws_events as events,
  aws_events_targets as targets,
  aws_logs as logs,
  aws_cloudwatch as cloudwatch,
} from "aws-cdk-lib";
import type { App, StackProps } from "aws-cdk-lib";
import { resolve } from "node:path";
export class NaradaStack extends Stack {
  constructor(
    scope: App,
    id: string,
    props: StackProps & {
      stage: string;
      ownerEmail: string;
      authFrom: string;
      customDomain?: {
        domainName: string;
        certificateArn: string;
        origin: string;
      };
    },
  ) {
    super(scope, id, props);
    const prefix = `/narada/${props.stage}`;
    const table = new db.Table(this, "Application", {
      partitionKey: { name: "pk", type: db.AttributeType.STRING },
      sortKey: { name: "sk", type: db.AttributeType.STRING },
      billingMode: db.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      stream: db.StreamViewType.NEW_IMAGE,
      removalPolicy: RemovalPolicy.RETAIN,
      deletionProtection: true,
    });
    table.addGlobalSecondaryIndex({
      indexName: "byScope",
      partitionKey: { name: "scope", type: db.AttributeType.STRING },
      sortKey: { name: "sort", type: db.AttributeType.STRING },
    });
    table.addGlobalSecondaryIndex({
      indexName: "byState",
      partitionKey: { name: "state", type: db.AttributeType.STRING },
      sortKey: { name: "due", type: db.AttributeType.NUMBER },
    });
    const authTable = new db.Table(this, "Auth", {
      partitionKey: { name: "__ba_pk", type: db.AttributeType.STRING },
      sortKey: { name: "__ba_sk", type: db.AttributeType.STRING },
      billingMode: db.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "__ba_ttl",
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
      deletionProtection: true,
    });
    authTable.addGlobalSecondaryIndex({
      indexName: "byType",
      partitionKey: { name: "__ba_tpk", type: db.AttributeType.STRING },
      sortKey: { name: "__ba_tsk", type: db.AttributeType.STRING },
    });
    for (let i = 1; i <= 6; i++)
      authTable.addGlobalSecondaryIndex({
        indexName: `lookup${i}`,
        partitionKey: { name: `__ba_g${i}pk`, type: db.AttributeType.STRING },
        sortKey: { name: `__ba_g${i}sk`, type: db.AttributeType.STRING },
      });
    const makeQueue = (name: string) => {
      const dead = new sqs.Queue(this, `${name}Dead`, {
        retentionPeriod: Duration.days(14),
        enforceSSL: true,
      });
      const queue = new sqs.Queue(this, name, {
        visibilityTimeout: Duration.seconds(180),
        retentionPeriod: Duration.days(4),
        deadLetterQueue: { queue: dead, maxReceiveCount: 5 },
        enforceSSL: true,
      });
      new cloudwatch.Alarm(this, `${name}DeadAlarm`, {
        metric: dead.metricApproximateNumberOfMessagesVisible(),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      return queue;
    };
    const work = makeQueue("Work"),
      feedback = makeQueue("Feedback");
    const configuration = new ses.ConfigurationSet(this, "SesConfiguration", {
      configurationSetName: `narada-${props.stage}`,
      suppressionReasons: ses.SuppressionReasons.BOUNCES_AND_COMPLAINTS,
    });
    const topic = new sns.Topic(this, "SesFeedback");
    topic.addSubscription(new subscriptions.SqsSubscription(feedback));
    topic.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal("ses.amazonaws.com")],
        actions: ["sns:Publish"],
        resources: [topic.topicArn],
        conditions: { StringEquals: { "AWS:SourceAccount": this.account } },
      }),
    );
    new ses.CfnConfigurationSetEventDestination(this, "SesEvents", {
      configurationSetName: configuration.configurationSetName,
      eventDestination: {
        enabled: true,
        matchingEventTypes: [
          "delivery",
          "bounce",
          "complaint",
          "reject",
          "deliveryDelay",
          "renderingFailure",
        ],
        snsDestination: { topicArn: topic.topicArn },
      },
    });
    const media = new s3.Bucket(this, "Media", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const environment = {
      NARADA_MODE: "aws",
      PUBLICATION_DOMAIN_ENVIRONMENT: props.stage,
      PUBLICATION_DOMAIN_ACCOUNT: this.account,
      APP_TABLE: table.tableName,
      AUTH_TABLE: authTable.tableName,
      WORK_QUEUE_URL: work.queueUrl,
      EVENT_QUEUE_URL: feedback.queueUrl,
      AUTH_SECRET_PARAMETER: `${prefix}/auth-secret`,
      PUBLIC_URL_PARAMETER: `${prefix}/public-url`,
      // A changed environment replaces warm runtimes during a hostname cutover.
      ...(props.customDomain
        ? { BETTER_AUTH_URL: props.customDomain.origin }
        : {}),
      OWNER_EMAIL: props.ownerEmail,
      AUTH_FROM: props.authFrom,
      SES_CONFIGURATION_SET: configuration.configurationSetName,
    };
    const fn = (
      name: string,
      entry: string,
      handler = "handler",
      extra: Record<string, string> = {},
    ) => {
      const f = new nodejs.NodejsFunction(this, name, {
        entry: resolve(entry),
        handler,
        runtime: lambda.Runtime.NODEJS_24_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: name === "Api" ? 1024 : 256,
        timeout: Duration.seconds(25),
        environment: { ...environment, ...extra },
        bundling: { minify: true, sourceMap: true, externalModules: [] },
        logGroup: new logs.LogGroup(this, `${name}Logs`, {
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
      });
      table.grantReadWriteData(f);
      f.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["ssm:GetParameter"],
          resources: [
            this.formatArn({
              service: "ssm",
              resource: "parameter",
              resourceName: `narada/${props.stage}/*`,
            }),
          ],
        }),
      );
      return f;
    };
    const api = fn("Api", "apps/api/src/lambda.ts"),
      worker = fn("Worker", "apps/worker/src/lambda.ts", "handler", {
        WORKER_KIND: "work",
      }),
      eventWorker = fn("EventWorker", "apps/worker/src/lambda.ts", "handler", {
        WORKER_KIND: "events",
      }),
      dispatcher = fn("Dispatcher", "apps/worker/src/lambda.ts", "dispatch"),
      bootstrap = fn("Bootstrap", "apps/api/src/bootstrap.ts");
    const publicSite = fn(
      "PublicationSite",
      "apps/api/src/publication-site-lambda.ts",
    );
    const siteGateway = new gateway.HttpApi(this, "PublicationSiteGateway", {
      defaultIntegration: new integrations.HttpLambdaIntegration(
        "PublicationSiteIntegration",
        publicSite,
      ),
    });
    const siteStage = siteGateway.defaultStage!.node
      .defaultChild as gateway.CfnStage;
    siteStage.defaultRouteSettings = {
      throttlingBurstLimit: 50,
      throttlingRateLimit: 20,
    };
    // No URL/query/header access logging: confirmation tokens must not enter logs.
    const publicHost = new cloudfront.Function(this, "PublicationPublicHost", {
      autoPublish: true,
      code: cloudfront.FunctionCode.fromInline(`function handler(event) {
        var request = event.request;
        request.headers['x-narada-public-host'] = { value: request.headers.host.value.toLowerCase() };
        delete request.headers.authorization;
        delete request.headers.cookie;
        return request;
      }`),
    });
    for (const f of [api, worker]) {
      f.addEnvironment(
        "PUBLICATION_SITE_ORIGIN",
        `https://${siteGateway.apiId}.execute-api.${this.region}.${this.urlSuffix}`,
      );
      f.addEnvironment("PUBLICATION_SITE_FUNCTION_ARN", publicHost.functionArn);
    }
    const managedTags = {
      "aws:ResourceTag/narada:resource": "publication-domain",
      "aws:ResourceTag/narada:environment": props.stage,
    };
    const requestedTags = {
      "aws:RequestTag/narada:resource": "publication-domain",
      "aws:RequestTag/narada:environment": props.stage,
    };
    const certificates = `arn:${this.partition}:acm:us-east-1:${this.account}:certificate/*`;
    const distributions = `arn:${this.partition}:cloudfront::${this.account}:distribution/*`;
    worker.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["acm:RequestCertificate"],
        // Create actions have no resource ARN. Require tags and the CloudFront certificate region.
        resources: ["*"],
        conditions: {
          StringEquals: {
            ...requestedTags,
            "aws:RequestedRegion": "us-east-1",
            "acm:ValidationMethod": "DNS",
            "acm:KeyAlgorithm": "RSA_2048",
          },
        },
      }),
    );
    worker.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateDistribution"],
        resources: ["*"],
        conditions: { StringEquals: requestedTags },
      }),
    );
    worker.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["acm:AddTagsToCertificate"],
        resources: [certificates],
        conditions: { StringEquals: requestedTags },
      }),
    );
    // Tag-on-create permission; no standalone resource tag mutations in the adapter.
    worker.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:TagResource"],
        resources: [distributions],
        conditions: { StringEquals: requestedTags },
      }),
    );
    worker.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["acm:DescribeCertificate", "acm:DeleteCertificate"],
        resources: [certificates],
        conditions: { StringEquals: managedTags },
      }),
    );
    worker.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "cloudfront:GetDistribution",
          "cloudfront:GetDistributionConfig",
          "cloudfront:UpdateDistribution",
          "cloudfront:DeleteDistribution",
        ],
        resources: [distributions],
        conditions: { StringEquals: managedTags },
      }),
    );
    worker.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["acm:ListTagsForCertificate"],
        resources: [certificates],
      }),
    );
    worker.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:ListTagsForResource"],
        resources: [distributions],
      }),
    );
    // Enumeration cannot be resource-scoped. The adapter checks exact connection tags,
    // hostname, caller reference, account and region before using a discovered resource.
    worker.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["acm:ListCertificates", "cloudfront:ListDistributions"],
        resources: ["*"],
      }),
    );
    worker.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:DescribeFunction"],
        resources: [publicHost.functionArn],
      }),
    );
    new cloudwatch.Alarm(this, "PublicationSiteErrors", {
      metric: publicSite.metricErrors(),
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const domainWarnings = new logs.MetricFilter(
      this,
      "PublicationDomainWarnings",
      {
        logGroup: worker.logGroup,
        filterPattern: logs.FilterPattern.any(
          logs.FilterPattern.all(
            logs.FilterPattern.stringValue(
              "$.event",
              "=",
              "publication_domain_transition",
            ),
            logs.FilterPattern.any(
              ...["failed", "degraded", "suspended"].map((state) =>
                logs.FilterPattern.stringValue("$.to", "=", state),
              ),
            ),
          ),
          logs.FilterPattern.stringValue(
            "$.event",
            "=",
            "publication_domain_certificate_expiring",
          ),
        ),
        metricNamespace: `Narada/${props.stage}`,
        metricName: "PublicationDomainWarnings",
        metricValue: "1",
        defaultValue: 0,
      },
    );
    new cloudwatch.Alarm(this, "PublicationDomainWarningAlarm", {
      metric: domainWarnings.metric({
        statistic: "Sum",
        period: Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    new CfnOutput(this, "PublicationSiteOrigin", {
      value: siteGateway.apiEndpoint,
    });
    api.node.addDependency(authTable);
    bootstrap.node.addDependency(authTable);
    api.addEnvironment("MEDIA_BUCKET", media.bucketName);
    media.grantPut(api, "media/*");
    authTable.grantReadWriteData(api);
    authTable.grantReadWriteData(bootstrap);
    for (const f of [api, worker])
      f.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["ses:SendEmail", "ses:SendRawEmail"],
          resources: [
            this.formatArn({
              service: "ses",
              resource: "identity",
              resourceName: "*",
            }),
            this.formatArn({
              service: "ses",
              resource: "configuration-set",
              resourceName: configuration.configurationSetName,
            }),
          ],
        }),
      );
    api.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "ses:CreateEmailIdentity",
          "ses:GetEmailIdentity",
          "ses:PutEmailIdentityMailFromAttributes",
          "ses:PutEmailIdentityDkimAttributes",
        ],
        resources: [
          this.formatArn({
            service: "ses",
            resource: "identity",
            resourceName: "*",
          }),
        ],
      }),
    );
    api.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ses:GetAccount"],
        resources: ["*"], // SES account reads do not support resource-level scoping.
      }),
    );
    api.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ses:GetConfigurationSet"],
        resources: [
          this.formatArn({
            service: "ses",
            resource: "configuration-set",
            resourceName: configuration.configurationSetName,
          }),
        ],
      }),
    );
    work.grantSendMessages(dispatcher);
    work.grantSendMessages(worker);
    work.grantConsumeMessages(worker);
    feedback.grantConsumeMessages(eventWorker);
    worker.addEventSource(
      new sources.SqsEventSource(work, {
        batchSize: 1,
        reportBatchItemFailures: true,
        maxConcurrency: 2,
      }),
    );
    eventWorker.addEventSource(
      new sources.SqsEventSource(feedback, {
        batchSize: 5,
        reportBatchItemFailures: true,
        maxConcurrency: 2,
      }),
    );
    dispatcher.addEventSource(
      new sources.DynamoEventSource(table, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10,
        retryAttempts: 3,
        filters: [
          lambda.FilterCriteria.filter({
            eventName: lambda.FilterRule.isEqual("INSERT"),
            dynamodb: {
              NewImage: {
                state: { S: lambda.FilterRule.isEqual("publication-domain") },
              },
            },
          }),
          lambda.FilterCriteria.filter({
            eventName: lambda.FilterRule.isEqual("INSERT"),
            dynamodb: {
              NewImage: {
                state: { S: lambda.FilterRule.isEqual("publication") },
              },
            },
          }),
          lambda.FilterCriteria.filter({
            dynamodb: {
              NewImage: {
                state: { S: lambda.FilterRule.isEqual("broadcast") },
              },
            },
          }),
          lambda.FilterCriteria.filter({
            eventName: lambda.FilterRule.isEqual("INSERT"),
            dynamodb: {
              NewImage: { state: { S: lambda.FilterRule.isEqual("send") } },
            },
          }),
          lambda.FilterCriteria.filter({
            eventName: lambda.FilterRule.isEqual("INSERT"),
            dynamodb: {
              NewImage: { state: { S: lambda.FilterRule.isEqual("webhook") } },
            },
          }),
        ],
      }),
    );
    new events.Rule(this, "RecoverJobs", {
      schedule: events.Schedule.rate(Duration.minutes(1)),
      targets: [new targets.LambdaFunction(dispatcher)],
    });
    const http = new gateway.HttpApi(this, "HttpApi", {
      defaultIntegration: new integrations.HttpLambdaIntegration(
        "ApiIntegration",
        api,
      ),
    });
    const defaultStage = http.defaultStage!.node
      .defaultChild as gateway.CfnStage;
    defaultStage.defaultRouteSettings = {
      throttlingBurstLimit: 20,
      throttlingRateLimit: 10,
    };
    const accessLogs = new logs.LogGroup(this, "ApiAccessLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    defaultStage.accessLogSettings = {
      destinationArn: accessLogs.logGroupArn,
      // Correlation and latency only. Never log bodies, headers, query strings or source IPs.
      format: JSON.stringify({
        requestId: "$context.requestId",
        awsRequestId: "$context.integration.requestId",
        time: "$context.requestTimeEpoch",
        route: "$context.routeKey",
        status: "$context.status",
        integrationStatus: "$context.integration.status",
        integrationLatencyMs: "$context.integrationLatency",
        responseLatencyMs: "$context.responseLatency",
      }),
    };
    const bucket = new s3.Bucket(this, "Frontend", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const formRouting = new cloudfront.Function(this, "FormRouting", {
      code: cloudfront.FunctionCode.fromInline(`function handler(event) {
        var request = event.request;
        if (/^\\/forms\\/[^/]+\\/?$/.test(request.uri)) request.uri = '/index.html';
        return request;
      }`),
    });
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      ...(props.customDomain
        ? {
            domainNames: [props.customDomain.domainName],
            certificate: acm.Certificate.fromCertificateArn(
              this,
              "CustomDomainCertificate",
              props.customDomain.certificateArn,
            ),
          }
        : {}),
      defaultRootObject: "index.html",
      // This distribution also serves synchronous APIs: retain Australian edge locations.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      defaultBehavior: {
        functionAssociations: [
          {
            function: formRouting,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy:
          cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      },
      additionalBehaviors: {
        "/media/*": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(media),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          responseHeadersPolicy: new cloudfront.ResponseHeadersPolicy(
            this,
            "MediaHeaders",
            {
              customHeadersBehavior: {
                customHeaders: [
                  {
                    header: "Cross-Origin-Resource-Policy",
                    value: "cross-origin",
                    override: true,
                  },
                ],
              },
              securityHeadersBehavior: {
                contentTypeOptions: { override: true },
                contentSecurityPolicy: {
                  contentSecurityPolicy: "default-src 'none'; sandbox",
                  override: true,
                },
              },
            },
          ),
        },
        "/n/*": {
          origin: new origins.HttpOrigin(
            `${http.apiId}.execute-api.${this.region}.${this.urlSuffix}`,
          ),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        },
        "/.well-known/*": {
          origin: new origins.HttpOrigin(
            `${http.apiId}.execute-api.${this.region}.${this.urlSuffix}`,
          ),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        },
        "/oauth/*": {
          origin: new origins.HttpOrigin(
            `${http.apiId}.execute-api.${this.region}.${this.urlSuffix}`,
          ),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        },
        "/api/*": {
          origin: new origins.HttpOrigin(
            `${http.apiId}.execute-api.${this.region}.${this.urlSuffix}`,
          ),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        },
      },
    });
    // Even the tag-on-create grants must never permit adopting dashboard resources.
    worker.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        actions: [
          "cloudfront:TagResource",
          "cloudfront:UpdateDistribution",
          "cloudfront:DeleteDistribution",
        ],
        resources: [distribution.distributionArn],
      }),
    );
    if (props.customDomain)
      worker.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.DENY,
          actions: ["acm:AddTagsToCertificate", "acm:DeleteCertificate"],
          resources: [props.customDomain.certificateArn],
        }),
      );
    const publicUrl =
      props.customDomain?.origin ??
      `https://${distribution.distributionDomainName}`;
    new ssm.StringParameter(this, "PublicUrl", {
      parameterName: `${prefix}/public-url`,
      stringValue: publicUrl,
    });
    new deployment.BucketDeployment(this, "DeployFrontend", {
      sources: [deployment.Source.asset(resolve("apps/web/dist"))],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ["/*"],
    });
    new CfnOutput(this, "Url", {
      value: publicUrl,
    });
    new CfnOutput(this, "CloudFrontDomainName", {
      value: distribution.distributionDomainName,
    });
    new CfnOutput(this, "BootstrapFunction", { value: bootstrap.functionName });
    new CfnOutput(this, "MediaBucket", { value: media.bucketName });
    new CfnOutput(this, "ApplicationTable", { value: table.tableName });
    new CfnOutput(this, "AuthTable", { value: authTable.tableName });
  }
}
