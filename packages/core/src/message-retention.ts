import type { Message, Status } from "./model.js";
import {
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";

// Apply in the same atomic write as the terminal status transition.
export function messageContentPaths(message: Message) {
  return [
    ["input", "html"],
    ["input", "text"],
    ...(message.broadcast ? [["broadcast", "unsubscribeUrl"]] : []),
  ];
}

export const completedMessageStatuses: readonly Status[] = [
  "captured",
  "sent",
  "delivered",
  "delayed",
  "bounced",
  "complained",
  "failed",
  "expired",
  "unknown",
];

/** Paginated migration: project-scoped, no bodies returned or logged, dry run by default. */
export async function purgeCompletedMessageContent(
  client: DynamoDBDocumentClient,
  table: string,
  project: string,
  apply = false,
) {
  const names = {
    "#status": "status",
    "#input": "input",
    "#text": "text",
    "#html": "html",
  };
  const statuses = Object.fromEntries(
    completedMessageStatuses.map((s, i) => [`:s${i}`, s]),
  );
  const condition = `#status IN (${Object.keys(statuses).join(", ")}) AND (attribute_exists(#input.#html) OR attribute_exists(#input.#text) OR attribute_exists(broadcast.unsubscribeUrl))`;
  let eligible = 0,
    purged = 0,
    skipped = 0;
  // Separate records with/without a broadcast map so REMOVE never targets a missing parent.
  // The query returns only keys, including for legacy broadcast maps with no broadcastId.
  for (const hasBroadcast of [false, true]) {
    const broadcastCondition = hasBroadcast
      ? "attribute_exists(broadcast)"
      : "attribute_not_exists(broadcast)";
    const guardedCondition = `${condition} AND ${broadcastCondition}`;
    let cursor: Record<string, unknown> | undefined;
    do {
      const page = await client.send(
        new QueryCommand({
          TableName: table,
          IndexName: "byScope",
          KeyConditionExpression: "#scope = :scope",
          FilterExpression: guardedCondition,
          ProjectionExpression: "pk",
          ExpressionAttributeNames: { ...names, "#scope": "scope" },
          ExpressionAttributeValues: {
            ...statuses,
            ":scope": `messages#${project}`,
          },
          Limit: 100,
          ExclusiveStartKey: cursor,
        }),
      );
      for (const item of page.Items ?? []) {
        eligible++;
        if (!apply) continue;
        try {
          await client.send(
            new UpdateCommand({
              TableName: table,
              Key: { pk: item.pk, sk: "META" },
              ConditionExpression: guardedCondition,
              UpdateExpression:
                "SET contentPurgedAt = if_not_exists(contentPurgedAt, :now) REMOVE #input.#html, #input.#text" +
                (hasBroadcast ? ", broadcast.unsubscribeUrl" : ""),
              ExpressionAttributeNames: names,
              ExpressionAttributeValues: {
                ...statuses,
                ":now": new Date().toISOString(),
              },
            }),
          );
          purged++;
        } catch (error) {
          if (
            !(error instanceof Error) ||
            error.name !== "ConditionalCheckFailedException"
          )
            throw error;
          skipped++;
        }
      }
      cursor = page.LastEvaluatedKey;
    } while (cursor);
  }
  return { eligible, purged, skipped, applied: apply };
}
